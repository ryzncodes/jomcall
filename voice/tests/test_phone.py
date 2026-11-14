"""The worker's phone path: job detection, call start, end, cap and opened hook."""

import json

from fake_http import FakeServer, Reply
from jomcall_voice import brain_client, config, fillers, phone
from jomcall_voice.call import Call
from test_call import BASE_MS, DISCLOSURE, GREETING, OPENING, SESSION, Rig, settle


class PhoneRig(Rig):
    """The browser-test rig with the phone-only Call options (test_call.py unchanged)."""

    def __init__(self, *scripts, **extra):
        super().__init__(*scripts)
        self.call = Call(
            session_id=SESSION,
            token="tok-test",
            greeting=GREETING,
            disclosure=DISCLOSURE,
            ears=self.ears,
            brain=self.brain,
            voice=self.voice,
            clock=self.clock,
            sink=self.sink,
            wall_ms=lambda: BASE_MS + self.clock.now() * 1000,
            stage_log=self.stages.append,
            **extra,
        )

CALL = "33333333-3333-4333-8333-333333333333"
TURN = "22222222-2222-4222-8222-222222222222"


def test_only_the_fixed_phone_metadata_is_a_phone_job():
    assert phone.is_phone_job('{"channel":"phone"}')
    assert not phone.is_phone_job('{"sessionId":"s","voiceToken":"t","disclosure":"d"}')
    assert not phone.is_phone_job("not json")
    assert not phone.is_phone_job('["phone"]')


def test_call_start_builds_one_opening_with_the_disclosure_first():
    start = phone.parse_start(
        {
            "callId": CALL,
            "token": "tok",
            "voice": "Leda",
            "greeting": " Selamat datang. ",
            "disclosure": "Panggilan ini dijawab oleh AI.",
            "recordingDisclosure": "Panggilan ini dirakam.",
            "capSeconds": 600,
            "refusal": None,
        }
    )
    assert start["opening"] == (
        "Panggilan ini dijawab oleh AI. Panggilan ini dirakam. Selamat datang."
    )
    assert start["capSeconds"] == 600.0 and not start["refused"]


def test_no_disclosure_or_no_token_means_no_call():
    base = {"callId": CALL, "token": "tok", "disclosure": "AI here."}
    assert phone.parse_start({**base, "disclosure": "  "}) is None
    assert phone.parse_start({**base, "token": ""}) is None
    assert phone.parse_start("x") is None
    # An out-of-range cap falls back to the 600 s default.
    assert phone.parse_start({**base, "capSeconds": 99999})["capSeconds"] == 600.0


def test_refusals_carry_only_the_busy_flag():
    assert phone.parse_start({"callId": None, "refusal": "UNKNOWN_NUMBER", "busyLine": False}) == {
        "refused": True,
        "busyLine": False,
    }
    assert phone.parse_start({"callId": CALL, "refusal": "LINES_BUSY", "busyLine": True})["busyLine"]


def test_the_busy_line_is_prewarmed_in_every_language():
    lines = fillers.fixed_lines()
    for lang in ("ms", "en", "manglish", "zh"):
        assert fillers.BUSY[lang] in lines


async def test_the_client_starts_and_ends_a_call_with_the_bearer_token():
    async def handler(req):
        if req.path == "/phone/calls":
            return Reply(
                headers={"content-type": "application/json"},
                chunks=[json.dumps({"callId": CALL, "token": "tok", "disclosure": "AI."}).encode()],
            )
        return Reply(headers={"content-type": "application/json"}, chunks=[b"{}"])

    async with FakeServer(handler) as server:
        client = phone.PhoneClient(server.url)
        start = await client.start("call-+60312345678_x", "sip_+60123456789")
        await client.answered(CALL, "tok")
        await client.end(CALL, "tok", "hangup", "ms")
        await client.end(CALL, "tok", "bad reason!", "klingon")
        await client.aclose()
        reqs = server.requests
    assert start["callId"] == CALL
    assert json.loads(reqs[0].body) == {
        "room": "call-+60312345678_x",
        "identity": "sip_+60123456789",
    }
    assert "authorization" not in reqs[0].headers
    assert reqs[1].path == f"/phone/calls/{CALL}/answered"
    assert reqs[1].headers["authorization"] == "Bearer tok"
    assert json.loads(reqs[2].body) == {"reason": "hangup", "language": "ms"}
    assert json.loads(reqs[3].body) == {"reason": "ended"}


async def test_a_refused_start_status_gives_none():
    async def handler(req):
        return Reply(status=403, headers={"content-type": "application/json"}, chunks=[b"{}"])

    async with FakeServer(handler) as server:
        client = phone.PhoneClient(server.url)
        assert await client.start("r", "i") is None
        await client.aclose()


async def test_phone_turns_use_their_own_path_and_id_field():
    async def handler(req):
        return Reply(
            headers={"content-type": "application/x-ndjson"},
            chunks=[b'{"type":"done","turnId":"t","timings":{}}\n'],
        )

    async with FakeServer(handler) as server:
        async for _ in brain_client.stream_turn(
            CALL, "tok", "hello", TURN, 1.0, base_url=server.url,
            path="/phone/turns", id_field="callId",
        ):
            pass
        request = server.requests[0]
    assert request.path == "/phone/turns"
    body = json.loads(request.body)
    assert body["callId"] == CALL and "sessionId" not in body


async def test_a_phone_call_uses_its_own_cap():
    rig = PhoneRig([], cap_s=60.0)
    await rig.start()
    await rig.clock.advance(59_000)
    assert not rig.task.done()
    await rig.clock.advance(1_500)
    assert rig.task.done() and rig.task.result().end_reason == "cap"
    assert 60 < config.CALL_CAP_S


async def test_the_opened_hook_runs_once_after_the_opening():
    calls = []

    async def opened():
        calls.append(True)

    rig = PhoneRig([], on_opened=opened)
    await rig.start()
    await settle()
    assert calls == [True]
    await rig.finish()


async def test_a_failing_opened_hook_does_not_end_the_call():
    async def opened():
        raise RuntimeError("network down")

    rig = PhoneRig([], on_opened=opened)
    await rig.start()
    assert not rig.task.done()
    await rig.finish()


async def test_no_opened_hook_when_the_opening_fails():
    calls = []

    async def opened():
        calls.append(True)

    rig = PhoneRig([], on_opened=opened)
    rig.voice.refuse.add(OPENING)
    await rig.start()
    assert rig.task.result().end_reason == "opening_failed"
    assert calls == []


async def test_a_phone_job_without_speech_keys_never_joins_the_room(monkeypatch):
    from jomcall_voice import worker

    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_CLOUD_API_KEY", "not-a-real-key")

    class Job:
        metadata = '{"channel":"phone"}'

    class Ctx:
        job = Job()
        shutdowns: list[str] = []

        async def connect(self, **_):
            raise AssertionError("the worker joined the room")

        def shutdown(self, reason=""):
            self.shutdowns.append(reason)

    ctx = Ctx()
    await worker.entrypoint(ctx)
    assert ctx.shutdowns == ["voice_keys_missing"]


async def test_a_failure_after_the_start_still_ends_the_call_and_hangs_up(monkeypatch):
    """The server holds the line once a call starts; a worker failure must free it."""
    import asyncio

    from jomcall_voice import worker

    monkeypatch.setenv("DEEPGRAM_API_KEY", "not-a-real-key")
    monkeypatch.setenv("GOOGLE_CLOUD_API_KEY", "not-a-real-key")
    ended: list[tuple] = []

    class FakeClient:
        def __init__(self, *_):
            pass

        async def start(self, room, identity):
            return {"refused": False, "callId": "c1", "token": "t1", "voice": "Kore",
                    "opening": "AI here.", "capSeconds": 600.0}

        async def end(self, call_id, token, reason, language):
            ended.append((call_id, token, reason, language))

        async def aclose(self):
            pass

    class Participant:
        identity = "sip_+60123456789"

    class Room:
        name = "call-+60312345678_ab"

    class Ctx:
        job = type("Job", (), {"metadata": '{"channel":"phone"}'})()
        room = Room()
        deleted = 0
        shutdowns: list[str] = []

        async def wait_for_participant(self, **_):
            return Participant()

        async def delete_room(self):
            self.deleted += 1

        def shutdown(self, reason=""):
            self.shutdowns.append(reason)

    async def no_audio(ctx, participant):
        raise asyncio.TimeoutError

    async def publish(ctx):
        return object()

    monkeypatch.setattr(worker.phone, "PhoneClient", FakeClient)
    monkeypatch.setattr(worker, "_caller_audio", no_audio)
    monkeypatch.setattr(worker, "_publish_voice", publish)
    monkeypatch.setattr(worker, "RoomSink", lambda source: object())
    ctx = Ctx()
    await worker.entrypoint(ctx)
    assert ended == [("c1", "t1", "worker_failed", None)]
    assert ctx.deleted == 1 and ctx.shutdowns == ["worker_failed"]


def test_the_phone_url_follows_the_turn_url_rules(monkeypatch):
    import pytest

    monkeypatch.delenv("JOMCALL_MODE", raising=False)
    monkeypatch.delenv("JOMCALL_PHONE_URL", raising=False)
    assert phone.phone_url() == "http://127.0.0.1:54635"
    monkeypatch.setenv("JOMCALL_PHONE_URL", "http://10.0.0.4:54635")
    with pytest.raises(RuntimeError, match="LOOPBACK_REQUIRED: JOMCALL_PHONE_URL"):
        phone.phone_url()
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    assert phone.phone_url() == "http://10.0.0.4:54635"
    monkeypatch.delenv("JOMCALL_PHONE_URL")
    with pytest.raises(RuntimeError, match="PHONE_URL_REQUIRED"):
        phone.phone_url()


async def test_hosted_mode_sends_the_service_key_on_every_phone_request(monkeypatch):
    secret = "phone-service-secret-".ljust(40, "x")
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    monkeypatch.setenv("JOMCALL_VOICE_SERVICE_SECRET", secret)

    async def handler(req):
        return Reply(headers={"content-type": "application/json"}, chunks=[b"{}"])

    async with FakeServer(handler) as server:
        client = phone.PhoneClient(server.url)
        await client.start("r", "i")
        await client.answered(CALL, "tok")
        await client.end(CALL, "tok", "hangup", None)
        await client.aclose()
        reqs = server.requests
    assert all(r.headers.get(config.SERVICE_KEY_HEADER) == secret for r in reqs)
    assert reqs[1].headers["authorization"] == "Bearer tok"
