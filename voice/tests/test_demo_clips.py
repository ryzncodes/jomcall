import json

from fake_http import FakeServer, Reply
from jomcall_voice import demo_clips, voice_out
from test_samples import SleepLog, fake_aac
from test_voice_out import sse


def voices(server):
    return lambda preset: voice_out.Voice(preset, api_key="k", url=server.url + "/tts")


def body_text(b):
    return b["contents"][0]["parts"][0]["text"]


def body_voice(b):
    return b["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"]


def test_lines_come_from_the_page_messages():
    lines = demo_clips.demo_lines()
    assert set(lines) == {"manglish", "ms", "en", "zh"}
    assert all(len(texts) == 6 and all(t.strip() for t in texts) for texts in lines.values())
    en = json.loads((demo_clips.MESSAGES / "en.json").read_text())
    assert lines["en"] == en["turnsEnglish"]
    assert lines["manglish"][1] == en["turn1"]


async def test_records_spoken_lines_with_agent_and_caller_voices(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x00\x40" * 2400))

    lines = demo_clips.demo_lines()
    out, manifest = tmp_path / "clips", tmp_path / "list.json"
    async with FakeServer(handler) as server:
        found = await demo_clips.record(
            out, manifest, SleepLog(), lines=lines, convert=fake_aac,
            make_voice=voices(server), say=lambda _: None,
        )
        bodies = [json.loads(r.body) for r in server.requests]
    assert len(bodies) == 4 * 5
    spoken = {(body_text(b), body_voice(b)) for b in bodies}
    for texts in lines.values():
        assert (texts[3], demo_clips.AGENT_VOICE) not in spoken
        assert (texts[1], demo_clips.CALLER_VOICE) in spoken
        assert (texts[0], demo_clips.AGENT_VOICE) in spoken
    assert sorted(found["zh"]) == ["0", "1", "2", "4", "5"]
    assert found["ms"]["2"] == {"file": "ms-2.m4a", "text": lines["ms"][2]}
    assert json.loads(manifest.read_text()) == found
    assert (out / "en-5.m4a").is_file()


async def test_keeps_unchanged_clips_and_records_an_edited_line_again(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x00\x40" * 2400))

    lines = demo_clips.demo_lines()
    out, manifest = tmp_path / "clips", tmp_path / "list.json"
    async with FakeServer(handler) as server:
        await demo_clips.record(
            out, manifest, SleepLog(), lines=lines, convert=fake_aac,
            make_voice=voices(server), say=lambda _: None,
        )
        edited = {k: list(v) for k, v in lines.items()}
        edited["en"][2] = "Let me check that for you."
        server.requests.clear()
        found = await demo_clips.record(
            out, manifest, SleepLog(), lines=edited, convert=fake_aac,
            make_voice=voices(server), say=lambda _: None,
        )
        bodies = [json.loads(r.body) for r in server.requests]
    assert [body_text(b) for b in bodies] == ["Let me check that for you."]
    assert found["en"]["2"]["text"] == "Let me check that for you."


async def test_a_refusal_keeps_what_was_recorded(tmp_path):
    calls = 0

    async def handler(req):
        nonlocal calls
        calls += 1
        if calls == 3:
            return Reply(status=429)
        return Reply(chunks=sse(b"\x00\x40" * 2400))

    out, manifest = tmp_path / "clips", tmp_path / "list.json"
    async with FakeServer(handler) as server:
        found = await demo_clips.record(
            out, manifest, SleepLog(), lines=demo_clips.demo_lines(), convert=fake_aac,
            make_voice=voices(server), say=lambda _: None,
        )
    assert sum(len(v) for v in found.values()) == 2
    assert json.loads(manifest.read_text()) == found
