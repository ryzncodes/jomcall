import json

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


async def test_resumes_after_a_refusal(tmp_path):
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
            out, manifest, SleepLog(), convert=fake_aac, make_voice=voices(server), say=lambda _: None
        )
        assert len(first) == 2
        assert json.loads(manifest.read_text()) == first
        again = await samples.record(
            out, manifest, SleepLog(), convert=fake_aac, make_voice=voices(server), say=lambda _: None
        )
    assert len(again) == len(PRESETS) * 2
    assert calls == 3 + len(PRESETS) * 2 - 2


async def test_force_keeps_old_clips_listed_when_it_stops_early(tmp_path):
    out, manifest = tmp_path / "clips", tmp_path / "list.json"
    out.mkdir()
    for v in PRESETS:
        for l in ("en", "ms"):
            (out / f"{v}-{l}.m4a").write_bytes(b"old")

    async def handler(req):
        return Reply(status=429)

    async with FakeServer(handler) as server:
        found = await samples.record(
            out, manifest, SleepLog(), force=True, convert=fake_aac,
            make_voice=voices(server), say=lambda _: None,
        )
    every = {f"{v}-{l}": f"{v}-{l}.m4a" for v in PRESETS for l in ("en", "ms")}
    assert found == every
    assert json.loads(manifest.read_text()) == every


async def test_failed_conversion_stops_without_writing_wav(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x00\x40" * 2400))

    out, manifest = tmp_path / "clips", tmp_path / "list.json"
    async with FakeServer(handler) as server:
        found = await samples.record(
            out, manifest, SleepLog(), convert=no_aac, make_voice=voices(server), say=lambda _: None
        )
        assert len(server.requests) == 1
    assert found == {}
    assert list(out.iterdir()) == []
    assert json.loads(manifest.read_text()) == {}


def test_refuses_without_afconvert(capsys, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_API_KEY", "k")
    monkeypatch.setattr(samples, "has_aac", lambda: False)
    assert samples.main(["--paid"]) == 2
    assert "afconvert" in capsys.readouterr().err


def test_refuses_without_paid_flag(capsys, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_API_KEY", "k")
    assert samples.main([]) == 2
    assert "--paid" in capsys.readouterr().err


def test_refuses_without_key(capsys, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLOUD_API_KEY", raising=False)
    monkeypatch.setattr(samples, "has_aac", lambda: True)
    assert samples.main(["--paid"]) == 2
    err = capsys.readouterr().err
    assert "GOOGLE_CLOUD_API_KEY" in err
