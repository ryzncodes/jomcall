import json

import pytest

from fake_http import FakeServer, Reply
from jomcall_voice import brain_client

SESSION = "11111111-1111-4111-8111-111111111111"
TURN = "22222222-2222-4222-8222-222222222222"


def ndjson(*events):
    return [(json.dumps(e) + "\n").encode() for e in events]


async def collect(server, **kw):
    out = []
    async for event in brain_client.stream_turn(
        SESSION, "tok-abc", kw.get("transcript", "hello"), TURN, 1234.0,
        base_url=server.url,
    ):
        out.append(event)
    return out


async def test_yields_each_event_in_order_with_the_wire_format():
    events = [
        {"type": "started", "turnId": "t1"},
        {"type": "sentence", "text": "Hi."},
        {"type": "done", "turnId": "t1", "timings": {}},
    ]

    async def handler(req):
        return Reply(headers={"content-type": "application/x-ndjson"}, chunks=ndjson(*events))

    async with FakeServer(handler) as server:
        got = await collect(server)
        request = server.requests[0]
    assert got == events
    assert request.method == "POST" and request.path == "/voice/turns"
    assert request.headers["authorization"] == "Bearer tok-abc"
    assert json.loads(request.body) == {
        "sessionId": SESSION,
        "transcript": "hello",
        "clientTurnId": TURN,
        "heardAtMs": 1234.0,
    }


async def test_a_line_split_across_chunks_is_reassembled():
    line = (json.dumps({"type": "sentence", "text": "Split."}) + "\n").encode()

    async def handler(req):
        return Reply(chunks=[line[:7], line[7:]])

    async with FakeServer(handler) as server:
        assert await collect(server) == [{"type": "sentence", "text": "Split."}]


async def test_closing_the_iterator_closes_the_http_request():
    async def handler(req):
        return Reply(chunks=ndjson({"type": "started", "turnId": "t"}), hold_open=True)

    async with FakeServer(handler) as server:
        stream = brain_client.stream_turn(
            SESSION, "tok", "hi", TURN, 1.0, base_url=server.url
        )
        assert (await stream.__anext__())["type"] == "started"
        await stream.aclose()
        import asyncio

        await asyncio.wait_for(server.client_gone.wait(), 2)


async def test_401_raises_unauthorized():
    async def handler(req):
        return Reply(status=401, chunks=[b'{"error":"VOICE_UNAUTHORIZED"}'])

    async with FakeServer(handler) as server:
        with pytest.raises(brain_client.BrainUnauthorized):
            await collect(server)


@pytest.mark.parametrize("status", [400, 413])
async def test_our_own_bad_request_raises_rejected(status):
    async def handler(req):
        return Reply(status=status, chunks=[b"{}"])

    async with FakeServer(handler) as server:
        with pytest.raises(brain_client.BrainRejected):
            await collect(server)


async def test_server_error_raises_unavailable():
    async def handler(req):
        return Reply(status=500, chunks=[b"{}"])

    async with FakeServer(handler) as server:
        with pytest.raises(brain_client.BrainUnavailable):
            await collect(server)


async def test_nothing_listening_raises_unavailable():
    with pytest.raises(brain_client.BrainUnavailable):
        async for _ in brain_client.stream_turn(
            SESSION, "t", "hi", TURN, 1.0, base_url="http://127.0.0.1:1"
        ):
            pass


async def test_a_long_transcript_is_cut_to_fit_the_body_limit():
    async def handler(req):
        return Reply(chunks=[])

    async with FakeServer(handler) as server:
        await collect(server, transcript="你好" * 3000)
        body = server.requests[0].body
    assert len(body) < 8 * 1024
    assert json.loads(body)["transcript"].startswith("你好")
