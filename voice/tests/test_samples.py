import json
import wave

from fake_http import FakeServer, Reply
from jomcall_voice import config, samples, voice_out
from jomcall_voice.worker import PRESETS
from test_voice_out import sse


class SleepLog:
    def __init__(self):
        self.sleeps: list[float] = []

    async def sleep(self, seconds):
        self.sleeps.append(seconds)


def no_aac(wav, m4a):
    return False


def fake_aac(wav, m4a):
    m4a.write_bytes(b"aac")
    return True


def voices(server):
    return lambda preset: voice_out.Voice(preset, api_key="k", url=server.url + "/tts")


async def test_records_every_voice_in_both_languages_with_fixed_text(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x00\x40" * 2400))

    out, manifest, clock = tmp_path / "clips", tmp_path / "list.json", SleepLog()
    async with FakeServer(handler) as server:
        found = await samples.record(
            out, manifest, clock, convert=fake_aac, make_voice=voices(server), say=lambda _: None
        )
        bodies = [json.loads(r.body) for r in server.requests]
    assert len(bodies) == len(PRESETS) * 2
    texts = {b["contents"][0]["parts"][0]["text"] for b in bodies}
    assert texts == set(samples.SENTENCES.values())
    names = {
        b["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"]
        for b in bodies
    }
    assert names == set(PRESETS)
    assert found == {f"{v}-{l}": f"{v}-{l}.m4a" for v in PRESETS for l in ("en", "ms")}
    assert json.loads(manifest.read_text()) == found
    assert min(clock.sleeps) >= 60 / config.PREWARM_MAX_PER_MIN


async def test_falls_back_to_wav_and_resumes(tmp_path):
    calls = 0

    async def handler(req):
        nonlocal calls
        calls += 1
        if calls == 3:
            return Reply(status=429)
        return Reply(chunks=sse(b"\x00\x40" * 2400))

    out, manifest = tmp_path / "clips", tmp_path / "list.json"
    async with FakeServer(handler) as server:
        first = await samples.record(
            out, manifest, SleepLog(), convert=no_aac, make_voice=voices(server), say=lambda _: None
        )
        assert len(first) == 2
        with wave.open(str(out / f"{PRESETS[0]}-en.wav")) as clip:
            assert clip.getframerate() == config.TTS_SAMPLE_RATE
        assert json.loads(manifest.read_text()) == first
        again = await samples.record(
            out, manifest, SleepLog(), convert=no_aac, make_voice=voices(server), say=lambda _: None
        )
    assert len(again) == len(PRESETS) * 2
    assert calls == 3 + len(PRESETS) * 2 - 2


def test_refuses_without_paid_flag(capsys, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_API_KEY", "k")
    assert samples.main([]) == 2
    assert "--paid" in capsys.readouterr().err


def test_refuses_without_key(capsys, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLOUD_API_KEY", raising=False)
    assert samples.main(["--paid"]) == 2
    err = capsys.readouterr().err
    assert "GOOGLE_CLOUD_API_KEY" in err
