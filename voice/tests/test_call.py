"""The per-call state machine, driven by fakes and a fake clock (no real sleeps)."""

from __future__ import annotations

import asyncio
import heapq
import itertools

import pytest

from jomcall_voice import config, fillers
from jomcall_voice.brain_client import BrainRejected, BrainUnauthorized
from jomcall_voice.call import Call, EarEvent
from jomcall_voice.voice_out import VoiceRefused

SESSION = "11111111-1111-4111-8111-111111111111"
GREETING = "Hello, thanks for calling Kedai Contoh."
DISCLOSURE = "This call is answered by an AI assistant and may be recorded."
OPENING = GREETING + " " + DISCLOSURE


async def settle():
    for _ in range(40):
        await asyncio.sleep(0)


class FakeClock:
    def __init__(self):
        self.t = 0.0
        self._waiters: list = []
        self._seq = itertools.count()

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        if seconds <= 0:
            await asyncio.sleep(0)
            return
        fut = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiters, (self.t + seconds, next(self._seq), fut))
        await fut

    async def advance(self, ms: float) -> None:
        target = self.t + ms / 1000
        while self._waiters and self._waiters[0][0] <= target:
            when, _, fut = heapq.heappop(self._waiters)
            self.t = when
            if not fut.done():
                fut.set_result(None)
            await settle()
        self.t = target
        await settle()


class FakeEars:
    def __init__(self):
        self.queue: asyncio.Queue[EarEvent] = asyncio.Queue()
        self.started = False

    async def events(self):
        self.started = True
        while True:
            yield await self.queue.get()

    def say(self, text="hello there", at=1000.0):
        self.queue.put_nowait(EarEvent("transcript", text, at))

    def speech_start(self):
        self.queue.put_nowait(EarEvent("speech_start"))


class FakeVoice:
    def __init__(self):
        self.requests: list[str] = []
        self.cached_calls: list[str] = []
        self.refuse: set[str] = set()

    async def speak(self, text):
        self.requests.append(text)
        if text in self.refuse:
            raise VoiceRefused("429")
        yield ("S:" + text).encode()

    async def cached(self, text):
        self.cached_calls.append(text)
        return ("C:" + text).encode()


class FakeSink:
    def __init__(self):
        self.played: list[str] = []
        self.hold = False
        self.stops = 0
        self._gate = asyncio.Event()

    async def play(self, chunks):
        data = b"".join([c async for c in chunks])
        if self.hold:
            await self._gate.wait()
        self.played.append(data.decode())

    def stop(self):
        self.stops += 1

    def release(self):
        self._gate.set()


class FakeBrain:
    """script: list of (delay_ms_after_previous, event | Exception)."""

    def __init__(self, clock, *scripts):
        self.clock = clock
        self.scripts = list(scripts)
        self.opened = 0
        self.closed = 0
        self.calls: list[tuple] = []

    def __call__(self, session_id, token, transcript, client_turn_id, heard_at_ms):
        self.calls.append((session_id, token, transcript, client_turn_id, heard_at_ms))
        return self._run(self.scripts.pop(0))

    async def _run(self, script):
        self.opened += 1
        try:
            for delay, event in script:
                await self.clock.sleep(delay / 1000)
                if isinstance(event, Exception):
                    raise event
                yield event
        finally:
            self.closed += 1


def sentence(text):
    return {"type": "sentence", "text": text}


STARTED = {"type": "started", "turnId": "t1"}
DONE = {"type": "done", "turnId": "t1", "timings": {}}


class Rig:
    def __init__(self, *scripts):
        self.clock = FakeClock()
        self.ears = FakeEars()
        self.voice = FakeVoice()
        self.sink = FakeSink()
        self.brain = FakeBrain(self.clock, *scripts)
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
        )
        self.task: asyncio.Task | None = None

    async def start(self):
        self.task = asyncio.create_task(self.call.run())
        await settle()

    async def finish(self):
        assert self.task is not None
        if not self.task.done():
            self.task.cancel()
        await asyncio.gather(self.task, return_exceptions=True)

    @property
    def spoken(self):
        return self.sink.played

    def turn_requests(self):
        return [r for r in self.voice.requests if r != OPENING]


@pytest.fixture
async def make():
    rigs: list[Rig] = []

    async def build(*scripts):
        rig = Rig(*scripts)
        rigs.append(rig)
        await rig.start()
        return rig

    yield build
    for rig in rigs:
        await rig.finish()


async def test_the_disclosure_is_spoken_before_listening(make):
    rig = await make([])
    assert rig.voice.requests == [OPENING]
    assert rig.spoken == ["S:" + OPENING]
    assert rig.ears.started
    await rig.finish()


async def test_without_a_spoken_disclosure_the_call_does_not_proceed(make):
    rig = Rig([])
    rig.voice.refuse.add(OPENING)
    await rig.start()
    assert rig.task.done()
    assert rig.task.result().end_reason == "opening_failed"
    assert not rig.ears.started


async def test_sentence_at_300ms_plays_no_filler(make):
    rig = await make([(0, STARTED), (300, sentence("Boleh.")), (0, DONE)])
    rig.ears.say()
    await settle()
    await rig.clock.advance(1000)
    assert rig.voice.cached_calls == []
    assert rig.spoken[-1] == "S:Boleh."
    await rig.finish()


async def test_a_fast_event_is_spoken_and_no_filler_plays(make):
    rig = await make(
        [(0, STARTED), (100, {"type": "fast", "text": "Sekejap ya."}), (2000, sentence("Ada.")), (0, DONE)]
    )
    rig.ears.say()
    await settle()
    await rig.clock.advance(1500)
    assert rig.voice.cached_calls == []
    assert "S:Sekejap ya." in rig.spoken
    await rig.finish()


async def test_no_sentence_by_800ms_plays_one_neutral_then_the_answer(make):
    rig = await make([(0, STARTED), (1200, sentence("Okay.")), (0, DONE)])
    rig.ears.say()
    await settle()
    await rig.clock.advance(790)
    assert rig.voice.cached_calls == []
    await rig.clock.advance(20)
    assert len(rig.voice.cached_calls) == 1
    assert rig.voice.cached_calls[0] in fillers.NEUTRAL["en"]
    await rig.clock.advance(1000)
    assert rig.spoken[-2:] == ["C:" + rig.voice.cached_calls[0], "S:Okay."]
    await rig.finish()


async def test_tool_event_at_500ms_plays_the_action_filler_not_the_neutral(make):
    rig = await make(
        [(0, STARTED), (500, {"type": "tool", "name": "check_availability"}), (1500, sentence("Ada.")), (0, DONE)]
    )
    rig.ears.say()
    await settle()
    await rig.clock.advance(1000)
    assert len(rig.voice.cached_calls) == 1
    assert rig.voice.cached_calls[0] in [
        l for l in fillers.LINES["check_availability"]["en"]
    ]
    await rig.finish()


async def test_an_unknown_tool_name_falls_back_to_the_neutral_line(make):
    rig = await make(
        [(0, {"type": "tool", "name": "something_new"}), (3000, sentence("Ada.")), (0, DONE)]
    )
    rig.ears.say()
    await settle()
    await rig.clock.advance(1000)
    assert rig.voice.cached_calls[0] in fillers.NEUTRAL["en"]
    await rig.finish()


async def test_no_sentence_by_4000ms_plays_the_trouble_line_once(make):
    rig = await make([(0, STARTED), (6000, sentence("Maaf lambat.")), (0, DONE)])
    rig.ears.say()
    await settle()
    await rig.clock.advance(4100)
    trouble = [c for c in rig.voice.cached_calls if c == fillers.TROUBLE["en"]]
    assert len(trouble) == 1
    await rig.clock.advance(1500)
    assert len([c for c in rig.voice.cached_calls if c == fillers.TROUBLE["en"]]) == 1
    await rig.finish()


async def test_empty_transcript_asks_to_repeat_and_skips_the_brain(make):
    rig = await make()
    rig.ears.say("   ")
    await settle()
    assert rig.voice.cached_calls == [fillers.REPEAT["en"]]
    assert rig.brain.opened == 0
    await rig.finish()


async def test_caller_speech_during_playback_stops_it_and_closes_the_brain_stream(make):
    rig = await make([(0, STARTED), (100, sentence("Panjang.")), (10_000, DONE)])
    rig.sink.hold = True
    rig.ears.say()
    await settle()
    await rig.clock.advance(200)
    assert rig.brain.opened == 1 and rig.brain.closed == 0
    rig.ears.speech_start()
    await settle()
    assert rig.sink.stops >= 1
    assert rig.brain.closed == 1
    await rig.finish()


async def test_a_new_transcript_supersedes_the_running_turn(make):
    rig = await make(
        [(0, STARTED), (10_000, DONE)],
        [(0, STARTED), (100, sentence("Baru.")), (0, DONE)],
    )
    rig.ears.say("first")
    await settle()
    rig.ears.say("second")
    await settle()
    await rig.clock.advance(500)
    assert rig.brain.closed == 2
    assert rig.spoken[-1] == "S:Baru."
    await rig.finish()


async def test_voice_refused_marks_the_turn_and_the_call_continues(make):
    rig = await make(
        [(0, sentence("Refused one.")), (0, DONE)],
        [(0, sentence("Fine now.")), (0, DONE)],
    )
    rig.voice.refuse.add("Refused one.")
    rig.ears.say("one")
    await settle()
    await rig.clock.advance(100)
    assert not any("Refused one." in s for s in rig.spoken)
    assert rig.call.turns[0]["voiceRefused"] is True
    rig.ears.say("two")
    await settle()
    await rig.clock.advance(100)
    assert rig.spoken[-1] == "S:Fine now."
    assert rig.call.turns[1]["voiceRefused"] is False
    assert not rig.task.done()
    await rig.finish()


@pytest.mark.parametrize("code", ["VOICE_EXPIRED", "VOICE_UNAUTHORIZED", "TURN_LIMIT"])
async def test_fatal_brain_errors_end_the_call(make, code):
    rig = await make([(0, STARTED), (0, {"type": "error", "code": code})])
    rig.ears.say()
    await settle()
    await rig.clock.advance(10)
    assert rig.task.done()
    assert rig.task.result().end_reason == code


async def test_http_401_ends_the_call(make):
    rig = await make([(0, BrainUnauthorized("401"))])
    rig.ears.say()
    await settle()
    assert rig.task.done()
    assert rig.task.result().end_reason == "VOICE_UNAUTHORIZED"


async def test_other_brain_errors_speak_the_trouble_line_and_continue(make):
    rig = await make([(0, STARTED), (0, {"type": "error", "code": "MODEL_FAILED"})])
    rig.ears.say()
    await settle()
    await rig.clock.advance(10)
    assert fillers.TROUBLE["en"] in rig.voice.cached_calls
    assert not rig.task.done()
    await rig.finish()


async def test_a_rejected_request_speaks_the_trouble_line_and_continues(make):
    rig = await make([(0, BrainRejected("413"))])
    rig.ears.say()
    await settle()
    assert fillers.TROUBLE["en"] in rig.voice.cached_calls
    assert not rig.task.done()
    await rig.finish()


async def test_events_from_a_superseded_turn_are_ignored(make):
    rig = await make(
        [(0, STARTED), (50, {"type": "error", "code": "TURN_CANCELLED"})],
        [(0, STARTED), (100, sentence("Jawapan.")), (0, DONE)],
    )
    rig.ears.say("first")
    await settle()
    rig.ears.say("second")
    await settle()
    await rig.clock.advance(500)
    assert fillers.TROUBLE["en"] not in rig.voice.cached_calls
    assert rig.spoken[-1] == "S:Jawapan."
    assert not rig.task.done()


async def test_three_sentences_make_exactly_two_voice_requests(make):
    rig = await make(
        [(0, STARTED), (0, sentence("One.")), (0, sentence("Two.")), (0, sentence("Three.")), (0, DONE)]
    )
    rig.ears.say()
    await settle()
    await rig.clock.advance(100)
    assert rig.turn_requests() == ["One.", "Two. Three."]
    assert rig.spoken[-2:] == ["S:One.", "S:Two. Three."]
    await rig.finish()


async def test_language_of_the_transcript_picks_the_filler_language(make):
    rig = await make([(0, STARTED), (1000, sentence("Ok.")), (0, DONE)])
    rig.ears.say("boleh saya tempah esok")
    await settle()
    await rig.clock.advance(900)
    assert rig.voice.cached_calls[0] in fillers.NEUTRAL["ms"]
    await rig.finish()


async def test_the_brain_receives_the_wire_arguments(make):
    rig = await make([(0, sentence("Ok.")), (0, DONE)])
    rig.ears.say("hello there", at=5555.0)
    await settle()
    session_id, token, transcript, turn_id, heard = rig.brain.calls[0]
    assert (session_id, token, transcript, heard) == (SESSION, "tok-test", "hello there", 5555.0)
    assert len(turn_id) == 36
    await rig.finish()


async def test_at_300_seconds_the_call_says_goodbye_and_ends(make):
    rig = await make()
    await rig.clock.advance(config.CALL_CAP_S * 1000 - 1000)
    assert not rig.task.done()
    await rig.clock.advance(1500)
    assert rig.task.done()
    assert rig.task.result().end_reason == "cap"
    assert rig.voice.cached_calls[-1] == fillers.GOODBYE["en"]
    assert rig.spoken[-1] == "C:" + fillers.GOODBYE["en"]
