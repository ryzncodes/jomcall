from fake_http import FakeServer, Reply
from jomcall_voice import config, fillers, prewarm, voice_out
from test_voice_out import sse


class SleepLog:
    def __init__(self):
        self.sleeps: list[float] = []

    async def sleep(self, seconds):
        self.sleeps.append(seconds)


def voice(server, tmp_path):
    return voice_out.Voice("Kore", api_key="k", url=server.url + "/tts", cache_dir=tmp_path)


async def test_prewarm_caches_every_fixed_line_within_the_rate_limit(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00"))

    clock, out = SleepLog(), []
    wanted = fillers.fixed_lines(("en",))
    async with FakeServer(handler) as server:
        result = await prewarm.prewarm(voice(server, tmp_path), clock, ("en",), say=out.append)
        assert len(server.requests) == len(wanted)
    assert (result.synthesized, result.remaining, result.refused) == (len(wanted), 0, False)
    # one wait between requests, each at least 60 / PREWARM_MAX_PER_MIN seconds
    assert len(clock.sleeps) == len(wanted) - 1
    assert min(clock.sleeps) >= 60 / config.PREWARM_MAX_PER_MIN
    assert all("{detail}" not in x for x in wanted)


async def test_prewarm_resumes_and_skips_cached_lines(tmp_path):
    async def handler(req):
        return Reply(chunks=sse(b"\x01\x00"))

    wanted = fillers.fixed_lines(("en",))
    async with FakeServer(handler) as server:
        v = voice(server, tmp_path)
        for line in wanted[:5]:
            await v.cached(line)
        before = len(server.requests)
        result = await prewarm.prewarm(voice(server, tmp_path), SleepLog(), ("en",), say=lambda _: None)
        assert len(server.requests) - before == len(wanted) - 5
    assert result.skipped == 5


async def test_prewarm_stops_on_429_and_says_how_many_remain(tmp_path):
    count = 0

    async def handler(req):
        nonlocal count
        count += 1
        if count > 3:
            return Reply(status=429, chunks=[b"{}"])
        return Reply(chunks=sse(b"\x01\x00"))

    out = []
    wanted = fillers.fixed_lines(("en",))
    async with FakeServer(handler) as server:
        result = await prewarm.prewarm(voice(server, tmp_path), SleepLog(), ("en",), say=out.append)
        assert len(server.requests) == 4  # no retry after the refusal
    assert result.refused and result.synthesized == 3
    assert result.remaining == len(wanted) - 3
    assert any(f"{len(wanted) - 3} lines remain" in m for m in out)
