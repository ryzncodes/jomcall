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
