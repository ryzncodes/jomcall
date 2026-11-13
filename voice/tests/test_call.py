"""The per-call state machine, driven by fakes and a fake clock (no real sleeps)."""

from __future__ import annotations

import asyncio
import heapq
import itertools

import pytest

from jomcall_voice import config, fillers
from jomcall_voice.brain_client import BrainRejected, BrainUnauthorized
from jomcall_voice.call import STAGE_FIELDS, Call, EarEvent
from jomcall_voice.voice_out import VoiceRefused

SESSION = "11111111-1111-4111-8111-111111111111"
GREETING = "Hello, thanks for calling Kedai Contoh."
DISCLOSURE = "This call is answered by an AI assistant and may be recorded."
OPENING = GREETING + " " + DISCLOSURE
BASE_MS = 1_700_000_000_000.0
NEUTRAL_AT = config.NEUTRAL_ACK_MS - config.EARS_LAG_MS  # ms after the transcript arrives


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

    def interim(self, text="hel"):
        self.queue.put_nowait(EarEvent("interim", text))


class FakeVoice:
    """Counts requests the way the real Voice makes them: speak() and an
    uncached opening() are requests; lookup() never is."""

    def __init__(self):
        self.requests: list[str] = []
        self.cached_calls: list[str] = []  # every lookup() of a fixed line
        self.uncached: set[str] = set()
        self.clip_seconds: float | None = None  # pad fixed clips to this length
        self.refuse: set[str] = set()
        self.opening_memory: set[str] = set()

    async def speak(self, text):
        self.requests.append(text)
        if text in self.refuse:
            raise VoiceRefused("429")
        yield ("S:" + text).encode()

    async def opening(self, text):
        if text in self.opening_memory:
            yield ("S:" + text).encode()
            return
        async for chunk in self.speak(text):
            yield chunk
        self.opening_memory.add(text)

    def lookup(self, text):
        self.cached_calls.append(text)
        if text in self.uncached:
            return None
        data = ("C:" + text).encode()
        if self.clip_seconds:
            data = data.ljust(int(self.clip_seconds * 48_000), b"\0")
        return data


class FakeSink:
    def __init__(self):
        self.played: list[str] = []
        self.hold = False
        self.stops = 0
        self.fail = False
        self.clock: FakeClock | None = None
        self.events: list[tuple] = []  # (what, label, seconds) in order
        self._gate = asyncio.Event()

    async def play(self, chunks):
        if self.fail:
            raise RuntimeError("sink broke")
        data = b"".join([c async for c in chunks])
        label = data.rstrip(b"\0").decode()
        t = self.clock.now() if self.clock else 0.0
        self.events.append(("start", label, t))
        try:
            if self.hold:
                await self._gate.wait()
            if self.clock and len(data) > 2000:  # padded clips take their length to play
                await self.clock.sleep(len(data) / 48_000)
        except asyncio.CancelledError:
            self.events.append(("cancelled", label, self.clock.now() if self.clock else 0.0))
            raise
        self.events.append(("end", label, self.clock.now() if self.clock else 0.0))
        self.played.append(label)

    def stop(self):
        self.stops += 1
        self.events.append(("stop", "", self.clock.now() if self.clock else 0.0))

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
        self.sink.clock = self.clock
        self.brain = FakeBrain(self.clock, *scripts)
        self.stages: list[dict] = []
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


async def test_a_sentence_before_the_neutral_deadline_plays_no_filler(make):
    rig = await make([(0, STARTED), (100, sentence("Boleh.")), (0, DONE)])
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
    # 800 ms after the estimated end of speech = 200 ms after the transcript arrives
    await rig.clock.advance(NEUTRAL_AT - 10)
    assert rig.voice.cached_calls == []
    await rig.clock.advance(20)
    assert len(rig.voice.cached_calls) == 1
    assert rig.voice.cached_calls[0] in fillers.NEUTRAL["en"]
    await rig.clock.advance(1000)
    assert rig.spoken[-2:] == ["C:" + rig.voice.cached_calls[0], "S:Okay."]
    await rig.finish()


async def test_a_tool_event_before_the_neutral_deadline_plays_the_action_filler_not_the_neutral(make):
    rig = await make(
        [(0, STARTED), (150, {"type": "tool", "name": "check_availability"}), (1500, sentence("Ada.")), (0, DONE)]
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


async def test_words_during_playback_stop_it_and_close_the_brain_stream(make):
    rig = await make([(0, STARTED), (100, sentence("Panjang.")), (10_000, DONE)])
    rig.sink.hold = True
    rig.ears.say()
    await settle()
    await rig.clock.advance(200)
    assert rig.brain.opened == 1 and rig.brain.closed == 0
    before = rig.sink.stops
    rig.ears.interim()
    await settle()
    assert rig.sink.stops > before
    assert rig.brain.closed == 1
    rig.sink.release()
    await settle()
    assert "S:Panjang." not in rig.spoken


async def test_speech_start_alone_does_not_interrupt(make):
    rig = await make([(0, STARTED), (100, sentence("Panjang.")), (10_000, DONE)])
    rig.sink.hold = True
    rig.ears.say()
    await settle()
    await rig.clock.advance(200)
    before = rig.sink.stops
    rig.ears.speech_start()
    rig.ears.say("   ")  # the empty transcript noise would have produced
    await settle()
    assert rig.sink.stops == before
    assert rig.brain.closed == 0
    assert len(rig.call.turns) == 1
    assert fillers.REPEAT["en"] not in rig.voice.cached_calls
    rig.sink.release()
    await settle()
    assert "S:Panjang." in rig.spoken


async def test_an_empty_interim_does_not_interrupt(make):
    rig = await make([(0, STARTED), (100, sentence("Panjang.")), (10_000, DONE)])
    rig.sink.hold = True
    rig.ears.say()
    await settle()
    await rig.clock.advance(200)
    rig.ears.interim("  ")
    await settle()
    assert rig.brain.closed == 0


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


async def test_a_tool_event_after_the_neutral_still_gets_its_action_filler(make):
    rig = await make(
        [(0, STARTED), (1500, {"type": "tool", "name": "check_availability"}), (10_000, sentence("Ada.")), (0, DONE)]
    )
    rig.ears.say()
    await settle()
    await rig.clock.advance(900)
    assert len(rig.voice.cached_calls) == 1 and rig.voice.cached_calls[0] in fillers.NEUTRAL["en"]
    await rig.clock.advance(700)  # t = 1600
    assert rig.voice.cached_calls[1] in fillers.LINES["check_availability"]["en"]
    # the trouble clock restarted at the tool event (1500): nothing at 4000 ...
    await rig.clock.advance(2500)  # t = 4100
    assert fillers.TROUBLE["en"] not in rig.voice.cached_calls
    # ... and once, 4000 ms after it
    await rig.clock.advance(1500)  # t = 5600
    assert rig.voice.cached_calls.count(fillers.TROUBLE["en"]) == 1


async def test_the_trouble_line_never_plays_once_the_answer_has_started(make):
    rig = await make([(0, STARTED), (4100, sentence("Akhirnya.")), (0, DONE)])
    rig.sink.hold = True  # the neutral filler holds the speaker past 4000 ms
    rig.ears.say()
    await settle()
    await rig.clock.advance(4200)
    rig.sink.release()
    await settle()
    assert "C:" + fillers.TROUBLE["en"] not in rig.spoken
    assert "S:Akhirnya." in rig.spoken


async def test_an_uncached_fixed_line_is_skipped_and_counted_never_synthesized(make):
    rig = await make([(0, STARTED), (1200, sentence("Ok.")), (0, DONE)])
    rig.voice.uncached.update(fillers.NEUTRAL["en"])
    rig.ears.say()
    await settle()
    await rig.clock.advance(2000)
    assert rig.voice.requests == [OPENING, "Ok."]
    assert rig.call.fixed_lines_skipped == 1
    assert rig.call.turns[0]["voiceRequests"] == 1


async def test_four_sentences_still_make_exactly_two_requests(make):
    rig = await make(
        [(0, STARTED)] + [(0, sentence(f"S{i}.")) for i in range(1, 5)] + [(0, DONE)]
    )
    rig.ears.say()
    await settle()
    await rig.clock.advance(100)
    assert rig.turn_requests() == ["S1.", "S2. S3. S4."]
    assert rig.call.turns[0]["voiceRequests"] == config.MAX_VOICE_REQUESTS_PER_TURN


async def test_any_opening_exception_ends_the_call_with_a_reason(make):
    rig = Rig([])
    rig.sink.fail = True
    await rig.start()
    assert rig.task.done()
    assert rig.task.result().end_reason == "opening_failed"
    assert not rig.ears.started


# --- stage times ----------------------------------------------------------

async def test_a_plain_turn_logs_its_stage_times_with_exact_fields(make):
    rig = await make([(0, STARTED), (100, sentence("Rahsia jawapan.")), (0, DONE)])
    await rig.clock.advance(100)
    rig.ears.say("rahsia soalan", at=BASE_MS - 500)
    await settle()
    await rig.clock.advance(1000)
    assert len(rig.stages) == 1
    row = rig.stages[0]
    assert list(row) == list(STAGE_FIELDS)
    assert row["clientTurnId"] == rig.call.turns[0]["clientTurnId"]
    assert row["heardAtMs"] == BASE_MS - 500
    assert row["eosAtMs"] == row["brainSentAtMs"] == BASE_MS + 100
    assert row["firstSentenceAtMs"] == BASE_MS + 200
    assert row["ttsRequestAtMs"] == row["firstTtsByteAtMs"] == row["firstFrameAtMs"] == BASE_MS + 200
    assert row["fillerKind"] is None and row["fillerAtMs"] is None
    assert row["voiceRefused"] is False and row["fixedLinesSkipped"] == 0
    assert "soalan" not in str(row) and "jawapan" not in str(row)


async def test_the_first_filler_is_stamped_and_never_counted_as_the_answer(make):
    rig = await make([(0, STARTED), (1200, sentence("Ok.")), (0, DONE)])
    rig.ears.say()
    await settle()
    await rig.clock.advance(2000)
    row = rig.stages[0]
    assert row["fillerKind"] == "neutral"
    assert row["fillerAtMs"] == BASE_MS + NEUTRAL_AT
    assert row["firstFrameAtMs"] == BASE_MS + 1200 and row["ttsRequestAtMs"] == BASE_MS + 1200


async def test_an_action_filler_is_stamped_as_action(make):
    rig = await make(
        [(0, STARTED), (150, {"type": "tool", "name": "book_slot"}), (3000, sentence("Ok.")), (0, DONE)]
    )
    rig.ears.say()
    await settle()
    await rig.clock.advance(4000)
    assert rig.stages[0]["fillerKind"] == "action"
    assert rig.stages[0]["fillerAtMs"] == BASE_MS + 150


async def test_refused_voice_and_skipped_lines_are_flagged_per_turn(make):
    rig = await make([(0, sentence("No voice.")), (0, DONE)], [(0, sentence("Fine.")), (0, DONE)])
    rig.voice.refuse.add("No voice.")
    rig.voice.uncached.update(fillers.NEUTRAL["en"])
    rig.ears.say("one")
    await settle()
    await rig.clock.advance(100)
    rig.ears.say("two")
    await settle()
    await rig.clock.advance(100)
    assert [(r["voiceRefused"], r["fixedLinesSkipped"]) for r in rig.stages] == [(True, 0), (False, 0)]
    assert rig.stages[0]["firstFrameAtMs"] is None


async def test_a_superseded_turn_is_logged_once_with_unknowns_as_null(make):
    rig = await make([(0, STARTED), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)])
    rig.ears.say("first")
    await settle()
    rig.ears.say("second")
    await settle()
    await rig.clock.advance(100)
    assert len(rig.stages) == 2
    assert rig.stages[0]["firstSentenceAtMs"] is None and rig.stages[0]["firstFrameAtMs"] is None


async def test_heard_at_defaults_to_the_arrival_minus_the_ears_lag(make):
    rig = await make([(0, sentence("Ok.")), (0, DONE)])
    await rig.clock.advance(50)
    rig.ears.queue.put_nowait(EarEvent("transcript", "hello there"))
    await settle()
    assert rig.brain.calls[0][4] == BASE_MS + 50 - config.EARS_LAG_MS
    assert rig.stages[0]["heardAtMs"] == rig.brain.calls[0][4]


async def test_the_trouble_deadline_also_counts_from_the_estimated_end_of_speech(make):
    rig = await make([(0, STARTED), (6000, sentence("Lambat.")), (0, DONE)])
    rig.ears.say()
    await settle()
    await rig.clock.advance(config.TROUBLE_MS - config.EARS_LAG_MS - 100)
    assert fillers.TROUBLE["en"] not in rig.voice.cached_calls
    await rig.clock.advance(200)
    assert fillers.TROUBLE["en"] in rig.voice.cached_calls


# --- an answer never waits behind a filler ---------------------------------

def _no_overlap(events):
    playing = None
    for what, label, t in events:
        if what == "start":
            assert playing is None, f"{label} started while {playing} was playing"
            playing = label
        elif what in ("end", "cancelled"):
            playing = None


async def test_an_answer_cuts_an_action_filler_and_starts_at_once(make):
    rig = await make(
        [(0, STARTED), (150, {"type": "tool", "name": "check_availability"}), (200, sentence("Ada.")), (0, DONE)]
    )
    rig.voice.clip_seconds = 2.0
    rig.ears.say()
    await settle()
    await rig.clock.advance(150)  # the action filler starts
    base = len(rig.sink.events)
    await rig.clock.advance(250)  # the sentence arrives 200 ms into the filler
    kinds = [(w, l.split(":")[0]) for w, l, _ in rig.sink.events[base - 1 :]]
    assert ("cancelled", "C") in kinds and ("stop", "") in kinds
    assert rig.sink.events[-1][:2] == ("end", "S:Ada.") or rig.sink.events[-1][:2] == ("start", "S:Ada.")
    start = [e for e in rig.sink.events if e[:2] == ("start", "S:Ada.")][0]
    assert start[2] == 0.35  # 150 + 200 ms: no waiting for the filler's 2 s
    _no_overlap(rig.sink.events)


async def test_a_neutral_filler_with_little_left_finishes_first(make):
    rig = await make([(0, STARTED), (NEUTRAL_AT + 900, sentence("Ada.")), (0, DONE)])
    rig.voice.clip_seconds = 1.0  # starts at NEUTRAL_AT, ends 1000 ms later
    rig.ears.say()
    await settle()
    await rig.clock.advance(NEUTRAL_AT + 1200)
    first_play = next(i for i, e in enumerate(rig.sink.events) if e[0] == "start" and e[1].startswith("C:"))
    assert not any(e[0] in ("cancelled", "stop") for e in rig.sink.events[first_play:])
    ends = [t for w, l, t in rig.sink.events if w == "end" and l.startswith("C:")]
    starts = [t for w, l, t in rig.sink.events if w == "start" and l == "S:Ada."]
    assert starts and starts[0] >= ends[0]
    _no_overlap(rig.sink.events)


async def test_a_neutral_filler_with_a_lot_left_is_cut(make):
    rig = await make([(0, STARTED), (NEUTRAL_AT + 300, sentence("Ada.")), (0, DONE)])
    rig.voice.clip_seconds = 1.0  # 700 ms still to go when the answer is ready
    rig.ears.say()
    await settle()
    await rig.clock.advance(NEUTRAL_AT + 400)
    assert any(w == "cancelled" for w, _, _ in rig.sink.events)
    start = [t for w, l, t in rig.sink.events if w == "start" and l == "S:Ada."][0]
    assert abs(start - (NEUTRAL_AT + 300) / 1000) < 1e-6
    _no_overlap(rig.sink.events)


async def test_the_trouble_line_is_not_cut_by_an_answer(make):
    rig = await make([(0, STARTED), (config.TROUBLE_MS - config.EARS_LAG_MS + 300, sentence("Ada.")), (0, DONE)])
    rig.voice.clip_seconds = 1.0
    rig.ears.say()
    await settle()
    await rig.clock.advance(config.TROUBLE_MS + 3000)
    assert not any(w == "cancelled" for w, _, _ in rig.sink.events)
    _no_overlap(rig.sink.events)
    assert rig.sink.played[-1] == "S:Ada."


async def test_the_opening_is_never_cut(make):
    rig = await make([])
    assert rig.sink.stops == 0


async def test_the_calls_http_clients_are_closed_when_it_ends(make):
    rig = await make([])
    closed = []

    async def close_brain():
        closed.append("brain")

    async def close_voice():
        closed.append("voice")

    rig.brain.aclose = close_brain
    rig.voice.aclose = close_voice
    rig.call.hangup()
    await settle()
    assert rig.task.done() and sorted(closed) == ["brain", "voice"]


# --- one sentence cut in two by endpointing --------------------------------

async def test_a_transcript_right_after_another_is_joined_into_one_turn(make):
    rig = await make([(0, STARTED), (10_000, DONE)], [(0, STARTED), (100, sentence("Ok.")), (0, DONE)])
    rig.ears.say("book a table")
    await settle()
    await rig.clock.advance(config.MERGE_WINDOW_MS - 100)
    rig.ears.say("for two people")
    await settle()
    await rig.clock.advance(300)
    assert rig.brain.closed >= 1  # the first stream was closed
    assert [c[2] for c in rig.brain.calls] == ["book a table", "book a table for two people"]
    assert rig.spoken[-1] == "S:Ok."


async def test_a_transcript_after_the_window_is_a_normal_new_turn(make):
    rig = await make([(0, STARTED), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)])
    rig.ears.say("book a table")
    await settle()
    await rig.clock.advance(config.MERGE_WINDOW_MS + 100)
    rig.ears.say("for two people")
    await settle()
    assert [c[2] for c in rig.brain.calls] == ["book a table", "for two people"]


async def test_once_an_answer_has_started_the_next_transcript_is_a_new_turn(make):
    rig = await make([(0, STARTED), (50, sentence("Dah.")), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)])
    rig.ears.say("book a table")
    await settle()
    await rig.clock.advance(200)
    assert "S:Dah." in rig.spoken
    rig.ears.say("for two people")
    await settle()
    assert [c[2] for c in rig.brain.calls] == ["book a table", "for two people"]


async def test_three_pieces_in_quick_succession_all_join(make):
    rig = await make(
        [(0, STARTED), (10_000, DONE)], [(0, STARTED), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)]
    )
    for piece in ("one", "two", "three"):
        rig.ears.say(piece)
        await settle()
        await rig.clock.advance(300)
    assert rig.brain.calls[-1][2] == "one two three"


# --- the real event order: an interim always comes before the second transcript ---

async def test_a_split_utterance_joins_while_a_filler_is_playing(make):
    rig = await make([(0, STARTED), (10_000, DONE)], [(0, STARTED), (50, sentence("Ok.")), (0, DONE)])
    rig.voice.clip_seconds = 1.0
    rig.ears.say("first")
    await settle()
    await rig.clock.advance(NEUTRAL_AT + 100)  # the neutral filler is playing
    assert any(w == "start" and l.startswith("C:") for w, l, _ in rig.sink.events)
    rig.ears.interim()
    await settle()
    assert any(w == "cancelled" for w, _, _ in rig.sink.events)  # hushed, not a barge-in
    assert rig.brain.closed == 0  # the first turn is still the held fragment
    await rig.clock.advance(100)
    rig.ears.say("second")
    await settle()
    await rig.clock.advance(200)
    assert [c[2] for c in rig.brain.calls] == ["first", "first second"]
    assert rig.brain.closed >= 1  # the first stream was closed before the joined turn
    assert rig.spoken[-1] == "S:Ok."
    _no_overlap(rig.sink.events)


async def test_the_window_counts_to_the_first_words_of_the_new_piece(make):
    rig = await make([(0, STARTED), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)])
    rig.ears.say("first")
    await settle()
    await rig.clock.advance(config.MERGE_WINDOW_MS - 50)
    rig.ears.interim()
    await settle()
    await rig.clock.advance(400)  # the second transcript is delivered after the window
    rig.ears.say("second")
    await settle()
    assert [c[2] for c in rig.brain.calls] == ["first", "first second"]


async def test_words_after_the_window_are_a_new_turn_even_with_a_filler(make):
    rig = await make([(0, STARTED), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)])
    rig.voice.clip_seconds = 3.0
    rig.ears.say("first")
    await settle()
    await rig.clock.advance(config.MERGE_WINDOW_MS + 100)
    rig.ears.interim()
    await settle()
    rig.ears.say("second")
    await settle()
    assert [c[2] for c in rig.brain.calls] == ["first", "second"]


async def test_after_an_answer_frame_the_interim_is_a_barge_in_and_two_turns(make):
    rig = await make([(0, STARTED), (50, sentence("Dah.")), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)])
    rig.sink.hold = True
    rig.ears.say("first")
    await settle()
    await rig.clock.advance(200)
    before = rig.sink.stops
    rig.ears.interim()
    await settle()
    assert rig.sink.stops > before and rig.brain.closed == 1
    rig.sink.release()
    rig.ears.say("second")
    await settle()
    assert [c[2] for c in rig.brain.calls] == ["first", "second"]


async def test_three_fragments_with_interims_and_a_filler_join_and_reach_the_brain_once(make):
    rig = await make(
        [(0, STARTED), (10_000, DONE)], [(0, STARTED), (10_000, DONE)], [(0, sentence("Ok.")), (0, DONE)]
    )
    rig.voice.clip_seconds = 1.0
    for piece in ("one", "two", "three"):
        rig.ears.say(piece)
        await settle()
        await rig.clock.advance(NEUTRAL_AT + 100)
        if piece != "three":
            rig.ears.interim()
            await settle()
    assert [c[2] for c in rig.brain.calls] == ["one", "one two", "one two three"]
    assert sum(1 for c in rig.brain.calls if "three" in c[2]) == 1


async def test_an_ears_failure_ends_the_call_as_ears_failed_without_a_traceback(caplog):
    async def broken():
        raise RuntimeError("secret words from the caller")
        yield  # pragma: no cover

    rig2 = Rig()
    rig2.ears.events = broken
    with caplog.at_level("DEBUG"):
        rig2.task = asyncio.create_task(rig2.call.run())
        await settle()
        await rig2.clock.advance(100)
    assert rig2.call.end_reason == "ears_failed"
    assert all(r.exc_info is None and "secret" not in r.getMessage() for r in caplog.records)
    await rig2.finish()
