"""Hosted mode for the voice worker's side of the turn endpoint."""

import json

import pytest

from fake_http import FakeServer, Reply
from jomcall_voice import brain_client, config

SECRET = "k" * 40
SESSION = "11111111-1111-4111-8111-111111111111"
TURN = "22222222-2222-4222-8222-222222222222"


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for name in ("JOMCALL_MODE", "JOMCALL_VOICE_TURN_URL", "JOMCALL_VOICE_SERVICE_SECRET"):
        monkeypatch.delenv(name, raising=False)


def test_local_default_is_unchanged():
    assert config.turn_url() == "http://127.0.0.1:54633"
    assert config.service_headers() == {}


@pytest.mark.parametrize("mode", [None, "local", "mock"])
@pytest.mark.parametrize(
    "url",
    ["http://10.0.0.5:54633", "http://agent:54633", "https://brain.example.test",
     "http://localhost:54633", "http://0.0.0.0:54633", "ftp://127.0.0.1:54633"],
)
def test_local_mode_refuses_a_non_loopback_turn_url(monkeypatch, mode, url):
    if mode:
        monkeypatch.setenv("JOMCALL_MODE", mode)
    monkeypatch.setenv("JOMCALL_VOICE_TURN_URL", url)
    with pytest.raises(RuntimeError, match="LOOPBACK_REQUIRED: JOMCALL_VOICE_TURN_URL"):
        config.turn_url()


def test_local_mode_accepts_loopback_and_ignores_a_secret(monkeypatch):
    monkeypatch.setenv("JOMCALL_VOICE_TURN_URL", "http://127.0.0.1:60000")
    monkeypatch.setenv("JOMCALL_VOICE_SERVICE_SECRET", SECRET)
    assert config.turn_url() == "http://127.0.0.1:60000"
    assert config.service_headers() == {}


def test_hosted_mode_needs_an_explicit_turn_url(monkeypatch):
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    with pytest.raises(RuntimeError, match="VOICE_TURN_URL_REQUIRED: JOMCALL_VOICE_TURN_URL"):
        config.turn_url()


@pytest.mark.parametrize(
    "url", ["http://172.30.0.10:54633", "http://10.1.2.3:54633", "https://brain.example.test"]
)
def test_hosted_mode_accepts_private_http_or_public_https(monkeypatch, url):
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    monkeypatch.setenv("JOMCALL_VOICE_TURN_URL", url)
    assert config.turn_url() == url


@pytest.mark.parametrize(
    "url",
    ["http://brain.example.test", "http://8.8.8.8:54633", "http://agent:54633",
     "https://127.0.0.1", "http://0.0.0.0:54633", "not a url"],
)
def test_hosted_mode_refuses_public_plain_http_and_loopback_https(monkeypatch, url):
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    monkeypatch.setenv("JOMCALL_VOICE_TURN_URL", url)
    with pytest.raises(RuntimeError, match="JOMCALL_VOICE_TURN_URL"):
        config.turn_url()


@pytest.mark.parametrize("secret", [None, "", "short", "k" * 31, "has space " * 5])
def test_hosted_mode_needs_a_service_secret_and_never_echoes_it(monkeypatch, secret):
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    if secret is not None:
        monkeypatch.setenv("JOMCALL_VOICE_SERVICE_SECRET", secret)
    with pytest.raises(RuntimeError) as error:
        config.service_headers()
    assert "VOICE_SERVICE_SECRET_REQUIRED: JOMCALL_VOICE_SERVICE_SECRET" in str(error.value)
    if secret:
        assert secret not in str(error.value)


async def test_hosted_requests_carry_the_service_key(monkeypatch):
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    monkeypatch.setenv("JOMCALL_VOICE_SERVICE_SECRET", SECRET)

    async def handler(req):
        return Reply(chunks=[(json.dumps({"type": "done"}) + "\n").encode()])

    async with FakeServer(handler) as server:
        # The fake listens on loopback, which hosted mode allows as a private address.
        monkeypatch.setenv("JOMCALL_VOICE_TURN_URL", server.url)
        events = [e async for e in brain_client.stream_turn(SESSION, "tok", "hi", TURN, 1.0)]
        request = server.requests[0]
    assert events == [{"type": "done"}]
    assert request.headers[config.SERVICE_KEY_HEADER] == SECRET
    assert request.headers["authorization"] == "Bearer tok"


async def test_local_requests_carry_no_service_key(monkeypatch):
    monkeypatch.setenv("JOMCALL_VOICE_SERVICE_SECRET", SECRET)

    async def handler(req):
        return Reply(chunks=[(json.dumps({"type": "done"}) + "\n").encode()])

    async with FakeServer(handler) as server:
        events = [e async for e in brain_client.stream_turn(
            SESSION, "tok", "hi", TURN, 1.0, base_url=server.url)]
        request = server.requests[0]
    assert events == [{"type": "done"}]
    assert config.SERVICE_KEY_HEADER not in request.headers


async def test_an_explicit_base_url_is_checked_too(monkeypatch):
    with pytest.raises(RuntimeError, match="LOOPBACK_REQUIRED"):
        async for _ in brain_client.stream_turn(
            SESSION, "tok", "hi", TURN, 1.0, base_url="http://10.0.0.5:54633"
        ):
            pass


def test_startup_check_passes_locally_and_stops_a_half_configured_hosted_worker(monkeypatch):
    config.startup_check()
    monkeypatch.setenv("JOMCALL_MODE", "hosted")
    monkeypatch.setenv("JOMCALL_VOICE_TURN_URL", "http://172.30.0.10:54633")
    with pytest.raises(RuntimeError, match="VOICE_SERVICE_SECRET_REQUIRED"):
        config.startup_check()
    monkeypatch.setenv("JOMCALL_VOICE_SERVICE_SECRET", SECRET)
    config.startup_check()
