from jomcall_voice import config, worker


def test_the_worker_options_bind_loopback_on_the_fixed_port():
    options = worker.build_options()
    assert options.host == "127.0.0.1" == config.WORKER_HOST
    assert options.port == 54634 == config.WORKER_PORT
    assert options.agent_name == "jomcall-voice"


def test_no_second_listener_is_enabled():
    from livekit.agents.types import NOT_GIVEN

    assert worker.build_options().prometheus_port in (None, NOT_GIVEN)
