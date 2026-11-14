import json

from jomcall_voice import stages
from jomcall_voice.call import STAGE_FIELDS


def test_the_writer_appends_exact_fields_and_creates_the_directory(tmp_path):
    writer = stages.StageWriter("voice-abc/../x y", tmp_path / "deep" / "dir")
    writer({"clientTurnId": "t1", "eosAtMs": 5, "transcript": "must not appear", "voiceRefused": False})
    writer({"clientTurnId": "t2"})
    assert writer.path.name == "stages-voice-abc_.._x_y.jsonl"
    rows = [json.loads(x) for x in writer.path.read_text().splitlines()]
    assert [list(r) for r in rows] == [list(STAGE_FIELDS)] * 2
    assert rows[0]["eosAtMs"] == 5 and rows[0]["firstFrameAtMs"] is None
    assert "must not appear" not in writer.path.read_text()


def test_the_directory_comes_from_the_environment_or_the_repo_output(monkeypatch, tmp_path):
    monkeypatch.setenv("JOMCALL_VOICE_STAGES_DIR", str(tmp_path))
    assert stages.stages_dir() == tmp_path
    monkeypatch.delenv("JOMCALL_VOICE_STAGES_DIR")
    assert stages.stages_dir().parts[-2:] == ("output", "voice")
