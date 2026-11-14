"""Pure parts of the fake SIP caller; it is never run against a server here."""

import pytest
from livekit import api

from tools import phone_sim

KEY, SECRET = "APIfake", "s" * 48


def test_only_a_loopback_livekit_is_accepted():
    assert phone_sim.is_loopback("ws://127.0.0.1:54630")
    assert phone_sim.is_loopback("ws://localhost:54630")
    assert not phone_sim.is_loopback("wss://example.livekit.cloud")


def test_room_names_follow_the_callee_rule():
    name = phone_sim.room_name("+60312345678")
    assert name.startswith("call-+60312345678_") and len(name) > len("call-+60312345678_")


def test_the_token_is_a_sip_participant_with_sip_attributes():
    token = phone_sim.caller_token(KEY, SECRET, "call-x", "+60123456789", "+60312345678")
    claims = api.TokenVerifier(KEY, SECRET).verify(token)
    assert claims.identity == "sip_+60123456789"
    assert claims.kind == "sip"
    assert claims.attributes["sip.phoneNumber"] == "+60123456789"
    assert claims.attributes["sip.trunkPhoneNumber"] == "+60312345678"
    assert claims.video.room == "call-x" and claims.video.room_join
    assert not claims.video.room_admin


def test_a_withheld_caller_has_no_phone_number_attribute():
    attrs = phone_sim.sip_attributes(None, "+60312345678")
    assert "sip.phoneNumber" not in attrs
    assert phone_sim.sip_identity(None).startswith("sip_anonymous_")


def test_numbers_must_be_e164(tmp_path):
    clip = tmp_path / "c.pcm"
    clip.write_bytes(b"\0\0")
    ok = phone_sim.parse_args(["--dialled", "+60312345678", "--clip", str(clip)])
    assert ok.caller is None
    with pytest.raises(SystemExit):
        phone_sim.parse_args(["--dialled", "0312345678", "--clip", str(clip)])


def test_frames_are_20_ms():
    pcm = b"\1\0" * (phone_sim.FRAME * 2 + 5)
    out = phone_sim.frames(pcm)
    assert [len(x) for x in out] == [phone_sim.FRAME * 2, phone_sim.FRAME * 2, 10]


async def test_a_remote_livekit_is_refused_before_anything_is_sent(monkeypatch, tmp_path, capsys):
    clip = tmp_path / "c.pcm"
    clip.write_bytes(b"\0\0")
    monkeypatch.setenv("LIVEKIT_URL", "wss://example.livekit.cloud")
    monkeypatch.setenv("LIVEKIT_API_KEY", KEY)
    monkeypatch.setenv("LIVEKIT_API_SECRET", SECRET)
    args = phone_sim.parse_args(["--dialled", "+60312345678", "--clip", str(clip)])
    assert await phone_sim.run(args) == 2
    out = capsys.readouterr().out
    assert "refusing" in out and SECRET not in out
