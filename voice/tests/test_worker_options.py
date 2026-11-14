from jomcall_voice import config, worker


def test_the_worker_options_bind_loopback_on_the_fixed_port():
    options = worker.build_options()
    assert options.host == "127.0.0.1" == config.WORKER_HOST
    assert options.port == 54634 == config.WORKER_PORT
    assert options.agent_name == "jomcall-voice"


def test_no_second_listener_is_enabled():
    from livekit.agents.types import NOT_GIVEN

    assert worker.build_options().prometheus_port in (None, NOT_GIVEN)


class _Job:
    metadata = (
        '{"sessionId": "s", "voiceToken": "t", "disclosure": "This call is answered by AI."}'
    )


class _Ctx:
    """Stands in for JobContext: records the shutdown, fails if the room is joined."""

    def __init__(self):
        self.job = _Job()
        self.shutdowns: list[str] = []
        self.connected = False

    async def connect(self, **_):
        self.connected = True
        raise AssertionError("the worker joined the room")

    def shutdown(self, reason: str = "") -> None:
        self.shutdowns.append(reason)


def test_missing_keys_lists_names_only(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "not-a-real-key")
    monkeypatch.setenv("GOOGLE_CLOUD_API_KEY", "   ")
    assert config.missing_keys() == ["GOOGLE_CLOUD_API_KEY"]
    monkeypatch.delenv("DEEPGRAM_API_KEY")
    assert config.missing_keys() == ["DEEPGRAM_API_KEY", "GOOGLE_CLOUD_API_KEY"]
    monkeypatch.setenv("DEEPGRAM_API_KEY", "a")
    monkeypatch.setenv("GOOGLE_CLOUD_API_KEY", "b")
    assert config.missing_keys() == []


async def test_a_job_without_speech_keys_ends_before_the_room_is_joined(monkeypatch, caplog):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "present-not-real")
    monkeypatch.delenv("GOOGLE_CLOUD_API_KEY", raising=False)
    ctx = _Ctx()
    with caplog.at_level("ERROR"):
        await worker.entrypoint(ctx)
    assert ctx.shutdowns == ["voice_keys_missing"]
    assert ctx.connected is False
    assert "GOOGLE_CLOUD_API_KEY" in caplog.text
    # The name of a missing key is logged; no value ever is.
    assert "present-not-real" not in caplog.text
    assert "DEEPGRAM_API_KEY" not in caplog.text
