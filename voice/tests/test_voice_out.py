import base64
import json

import pytest

from fake_http import FakeServer, Reply
from jomcall_voice import voice_out


def sse(*pcm_chunks: bytes) -> list[bytes]:
    out = []
    for pcm in pcm_chunks:
        event = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "audio/L16;codec=pcm;rate=24000",
                                    "data": base64.b64encode(pcm).decode(),
                                }
                            }
                        ]
                    }
                }
            ]
        }
        out.append(f"data: {json.dumps(event)}\r\n\r\n".encode())
    return out


def make(server, tmp_path, preset="Kore"):
    return voice_out.Voice(
        preset, api_key="test-key", url=server.url + "/tts", cache_dir=tmp_path
    )


async def test_speak_streams_pcm_and_sends_the_pinned_request(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00\x02\x00", b"\x03\x00"))

    async with FakeServer(handler) as server:
        voice = make(server, tmp_path)
        audio = b"".join([c async for c in voice.speak("Selamat pagi.")])
        request = server.requests[0]
    assert audio == b"\x01\x00\x02\x00\x03\x00"
    assert request.headers["x-goog-api-key"] == "test-key"
    body = json.loads(request.body)
    assert body["contents"][0]["parts"][0]["text"] == "Selamat pagi."
    cfg = body["generationConfig"]
    assert cfg["responseModalities"] == ["AUDIO"]
    assert cfg["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Kore"


async def test_chunks_are_kept_sample_aligned(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00\x02", b"\x00\x03\x00"))

    async with FakeServer(handler) as server:
        chunks = [c async for c in make(server, tmp_path).speak("x")]
    assert all(len(c) % 2 == 0 for c in chunks)
    assert b"".join(chunks) == b"\x01\x00\x02\x00\x03\x00"


async def test_second_cached_call_makes_no_http_request(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00" * 10))

    async with FakeServer(handler) as server:
        voice = make(server, tmp_path)
        first = await voice.cached("Baik.")
        second = await voice.cached("Baik.")
        assert len(server.requests) == 1
        # A new Voice for the same preset reads the disk cache instead.
        third = await make(server, tmp_path).cached("Baik.")
        assert len(server.requests) == 1
    assert first == second == third == b"\x01\x00" * 10


async def test_cache_is_per_preset(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00"))

    async with FakeServer(handler) as server:
        await make(server, tmp_path, "Kore").cached("Baik.")
        await make(server, tmp_path, "Leda").cached("Baik.")
        assert len(server.requests) == 2


async def test_429_raises_refused_and_is_not_retried(tmp_path):
    async def handler(req):
        return Reply(status=429, chunks=[b"{}"])

    async with FakeServer(handler) as server:
        voice = make(server, tmp_path)
        with pytest.raises(voice_out.VoiceRefused):
            async for _ in voice.speak("Hello."):
                pass
        assert len(server.requests) == 1
        with pytest.raises(voice_out.VoiceRefused):
            await voice.cached("Baik.")
        assert len(server.requests) == 2  # one more call, still no retry


async def test_other_failures_raise_voice_failed(tmp_path):
    async def handler(req):
        return Reply(status=500, chunks=[b"{}"])

    async with FakeServer(handler) as server:
        with pytest.raises(voice_out.VoiceFailed):
            await make(server, tmp_path).cached("Baik.")
        assert len(server.requests) == 1


async def test_a_failed_synthesis_is_not_cached(tmp_path):
    async def handler(req):
        return Reply(chunks=[])

    async with FakeServer(handler) as server:
        with pytest.raises(voice_out.VoiceFailed):
            await make(server, tmp_path).cached("Baik.")
    assert list(tmp_path.rglob("*.pcm")) == []


def test_the_key_never_shows_in_the_repr(tmp_path):
    voice = voice_out.Voice("Kore", api_key="secret-key", url="http://x", cache_dir=tmp_path)
    assert "secret-key" not in repr(voice)


async def test_lookup_never_makes_a_request_and_sees_the_cache(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00"))

    async with FakeServer(handler) as server:
        voice = make(server, tmp_path)
        assert voice.lookup("Baik.") is None
        assert server.requests == []
        await voice.cached("Baik.")
        assert make(server, tmp_path).lookup("Baik.") == b"\x01\x00"
        assert len(server.requests) == 1


async def test_the_opening_is_cached_by_model_preset_and_text(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00", b"\x02\x00"))

    async with FakeServer(handler) as server:
        first = b"".join([c async for c in make(server, tmp_path).opening("Hello. AI.")])
        second = b"".join([c async for c in make(server, tmp_path).opening("Hello. AI.")])
        assert len(server.requests) == 1
        assert first == second == b"\x01\x00\x02\x00"
        await make(server, tmp_path, "Leda").cached("Hello. AI.")
        assert len(server.requests) == 2  # another preset is another entry


async def test_an_interrupted_opening_is_not_cached(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00", b"\x02\x00"))

    async with FakeServer(handler) as server:
        stream = make(server, tmp_path).opening("Hello.")
        await stream.__anext__()
        await stream.aclose()
        assert make(server, tmp_path).lookup("Hello.") is None


def _pcm(n, amp):
    import math
    import struct

    return struct.pack(f"<{n}h", *[int(amp * math.sin(i / 5)) for i in range(n)])


async def test_streamed_answers_lose_their_leading_silence(tmp_path):
    clip = b"\x00\x00" * 7200 + _pcm(4800, 8000)  # 300 ms of silence, then 200 ms of voice

    async def handler(req):
        return Reply(chunks=sse(clip[:5000], clip[5000:]))

    async with FakeServer(handler) as server:
        out = b"".join([c async for c in make(server, tmp_path).speak("x")])
    assert len(out) < len(clip) - 2 * 4000
    assert out.endswith(_pcm(4800, 8000))


async def test_fixed_clips_are_trimmed_when_stored_and_when_loaded_from_old_cache(tmp_path):
    clip = b"\x00\x00" * 7200 + _pcm(4800, 8000) + b"\x00\x00" * 7200

    async def handler(req):
        return Reply(chunks=sse(clip))

    async with FakeServer(handler) as server:
        stored = await make(server, tmp_path).cached("Baik.")
    assert len(stored) < len(clip) // 2
    # An untrimmed file left by an earlier version is trimmed in memory on load.
    old = voice_out.Voice("Kore", api_key="k", url="http://x/tts", cache_dir=tmp_path)
    old._path("Lama.").parent.mkdir(parents=True, exist_ok=True)
    old._path("Lama.").write_bytes(clip)
    assert len(old.lookup("Lama.")) == len(stored)
    assert old._path("Lama.").read_bytes() == clip  # the file itself is not rewritten


async def test_one_client_serves_every_request_of_a_voice_and_aclose_ends_it(tmp_path, monkeypatch):
    import httpx

    created = []
    real = httpx.AsyncClient

    class Counting(real):
        def __init__(self, *a, **kw):
            created.append(kw.get("limits"))
            super().__init__(*a, **kw)

    monkeypatch.setattr(httpx, "AsyncClient", Counting)

    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00"))

    async with FakeServer(handler) as server:
        voice = make(server, tmp_path)
        for text in ("a", "b", "c"):
            [c async for c in voice.speak(text)]
        assert len(created) == 1 and created[0].keepalive_expiry >= 30
        client = voice._client
        await voice.aclose()
        assert client.is_closed and voice._client is None
