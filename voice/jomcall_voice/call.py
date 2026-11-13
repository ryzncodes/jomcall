"""The per-call state machine.

Ears, brain, voice, clock and audio sink are injected as small protocols, so
this module imports nothing from LiveKit and the tests run on a fake clock.

The worker owns timing only. What to say, which tools to use and what is safe
all live in the brain; this module speaks the brain's sentences and, to hide
latency, a few fixed lines from `fillers`. It never logs transcripts or answers.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import AsyncIterator, Awaitable, Callable, Literal, Protocol

from . import config, fillers
from .turn import STAGE_FIELDS, TurnMixin, _Turn  # noqa: F401  (STAGE_FIELDS is re-exported)
from .voice_out import VoiceError

log = logging.getLogger("jomcall_voice.call")


@dataclass(frozen=True)
class EarEvent:
    # "speech_start" (raw VAD) is informational: only a non-empty "interim"
    # transcript can interrupt the agent, so noise and echo cannot.
    kind: Literal["speech_start", "interim", "transcript"]
    text: str = ""
    heard_at_ms: float = 0.0  # epoch ms when the caller stopped speaking


class Ears(Protocol):
    def events(self) -> AsyncIterator[EarEvent]: ...


class Voice(Protocol):
    def speak(self, text: str) -> AsyncIterator[bytes]: ...
    def opening(self, text: str) -> AsyncIterator[bytes]: ...
    def lookup(self, text: str) -> bytes | None: ...  # cache only, never a request


class Clock(Protocol):
    def now(self) -> float: ...
    async def sleep(self, seconds: float) -> None: ...


class Sink(Protocol):
    async def play(self, chunks: AsyncIterator[bytes]) -> None: ...
    def stop(self) -> None: ...


Brain = Callable[[str, str, str, str, float], AsyncIterator[dict]]


@dataclass
class CallResult:
    end_reason: str
    turns: list[dict]
    fixed_lines_skipped: int = 0


BYTES_PER_SECOND = config.TTS_SAMPLE_RATE * 2


def _log_failure(task: asyncio.Task) -> None:
    # Class name only: an exception message could carry a transcript or a key.
    if not task.cancelled() and task.exception() is not None:
        log.warning("background task failed: %s", type(task.exception()).__name__)


async def _once(data: bytes) -> AsyncIterator[bytes]:
    yield data


class Call(TurnMixin):
    def __init__(
        self, *, session_id: str, token: str, greeting: str, disclosure: str,
        ears: Ears, brain: Brain, voice: Voice, clock: Clock, sink: Sink,
        new_id: Callable[[], str] = lambda: str(uuid.uuid4()),
        wall_ms: Callable[[], float] = lambda: time.time() * 1000,
        stage_log: Callable[[dict], None] | None = None,
    ):
        self._session_id, self._token = session_id, token
        self._greeting, self._disclosure = greeting.strip(), disclosure.strip()
        self._ears, self._brain, self._voice = ears, brain, voice
        self._clock, self._sink = clock, sink
        self._new_id, self._wall_ms = new_id, wall_ms
        self._stage_log = stage_log
        self.turns: list[dict] = []
        self.end_reason: str | None = None
        self._ended = asyncio.Event()
        self._lock = asyncio.Lock()  # one thing plays at a time, in order
        self._playing = 0
        self._turn: _Turn | None = None
        self._bg: set[asyncio.Task] = set()
        # Sticky conversation language: only confident evidence changes it. Starts from
        # the opening text; with no evidence there, Malay.
        self._lang = "ms"
        self._observe(" ".join(x for x in (self._greeting, self._disclosure) if x))
        self._last_filler: str | None = None
        self.fixed_lines_skipped = 0
        # (task, kind, started at, seconds long) of the filler now playing, if any
        # The previous utterance, kept only to join a sentence endpointing cut in two.
        self._prev: tuple[_Turn, str, float] | None = None
        # When the first words of the next piece arrived (interim or final); the join
        # window is measured to this moment, not to when the transcript is delivered.
        self._piece_at: float | None = None
        self._filler_play: tuple[asyncio.Task, str, float, float] | None = None

    def _observe(self, text: str) -> None:
        """Update the call language from text, if it is clear enough. Never logged."""
        language, confident = fillers.guess(text)
        if confident and language:
            self._lang = language

    def hangup(self) -> None:
        self._end("hangup")

    def _end(self, reason: str) -> None:
        if self.end_reason is None:
            self.end_reason = reason
            self._ended.set()

    async def run(self) -> CallResult:
        cap = asyncio.create_task(self._cap_timer())
        main = asyncio.create_task(self._main())
        try:
            await self._ended.wait()
            for task in (cap, main):
                task.cancel()
            self._cancel_turn()
            if self.end_reason in ("cap", "VOICE_EXPIRED", "TURN_LIMIT"):
                await self._say_fixed(fillers.GOODBYE[self._lang])
        finally:
            for task in (cap, main, *self._bg):
                task.cancel()
            self._cancel_turn()
            for part in (self._brain, self._voice):  # close the call's HTTP clients
                close = getattr(part, "aclose", None)
                if close is not None:
                    try:
                        await close()
                    except Exception as error:
                        log.warning("close failed: %s", type(error).__name__)
        log.info(
            "call ended reason=%s turns=%d fixedLinesSkipped=%d",
            self.end_reason, len(self.turns), self.fixed_lines_skipped,
        )
        return CallResult(self.end_reason or "hangup", self.turns, self.fixed_lines_skipped)

    async def _cap_timer(self) -> None:
        await self._clock.sleep(config.CALL_CAP_S)
        self._end("cap")

    async def _main(self) -> None:
        # The AI disclosure comes first, every call. No voice, no call.
        opening = " ".join(x for x in (self._greeting, self._disclosure) if x)
        if not self._disclosure:
            return self._end("opening_failed")
        try:
            await self._speak(opening, opening=True)
        except Exception as error:  # a voice, sink or key failure all mean no call
            log.warning("opening failed: %s", type(error).__name__)
            return self._end("opening_failed")
        try:
            async for event in self._ears.events():
                self._on_ear(event)
        except Exception as error:  # class name only: a message could carry a transcript
            log.warning("ears failed: %s", type(error).__name__)
            return self._end("ears_failed")
        self._end("hangup")

    # --- playback -----------------------------------------------------------

    async def _play(self, chunks: AsyncIterator[bytes]) -> None:
        self._playing += 1
        try:
            await self._sink.play(chunks)
        finally:
            self._playing -= 1

    def _stamp(self, turn: _Turn | None, key: str) -> None:
        if turn is not None and key not in turn.stages:
            turn.stages[key] = self._wall_ms()

    async def _speak(self, text: str, opening: bool = False, turn: _Turn | None = None) -> None:
        """One voice request, started now so audio is ready when the sink is free."""
        queue: asyncio.Queue = asyncio.Queue()

        async def produce() -> None:
            try:
                self._stamp(turn, "ttsRequestAtMs")
                source = self._voice.opening(text) if opening else self._voice.speak(text)
                async for chunk in source:
                    if turn is not None and not opening and "firstTtsByteAtMs" not in turn.stages:
                        self._cut_filler()  # the answer is ready: it never waits for a filler
                    self._stamp(turn, "firstTtsByteAtMs")
                    queue.put_nowait(chunk)
                queue.put_nowait(None)
            except VoiceError as error:
                queue.put_nowait(error)
            except Exception as error:  # e.g. a missing key; the class name only
                log.warning("voice request failed: %s", type(error).__name__)
                queue.put_nowait(VoiceError("unexpected"))

        async def chunks() -> AsyncIterator[bytes]:
            while True:
                item = await queue.get()
                if item is None:
                    return
                if isinstance(item, Exception):
                    raise item
                self._stamp(turn, "firstFrameAtMs")
                yield item

        producer = asyncio.create_task(produce())
        try:
            async with self._lock:
                await self._play(chunks())
        finally:
            producer.cancel()

    async def _say_fixed(
        self, text: str, unless: Callable[[], bool] | None = None,
        turn: _Turn | None = None, kind: str | None = None,
    ) -> None:
        """A fixed line from the cache only. Never synthesized during a call:
        a missing one is skipped and counted (see `prewarm`)."""
        if unless and unless():
            return
        audio = self._voice.lookup(text)
        if audio is None:
            self.fixed_lines_skipped += 1
            if turn is not None:
                turn.skipped += 1
            return

        async def clip() -> AsyncIterator[bytes]:
            if turn is not None and kind and "fillerKind" not in turn.stages:
                turn.stages["fillerKind"] = kind
                turn.stages["fillerAtMs"] = self._wall_ms()
            yield audio

        async with self._lock:
            if unless and unless():
                return
            task = asyncio.current_task()
            if kind and task is not None:
                seconds = len(audio) / (BYTES_PER_SECOND)
                self._filler_play = (task, kind, self._clock.now(), seconds)
            try:
                await self._play(clip())
            finally:
                if self._filler_play and self._filler_play[0] is task:
                    self._filler_play = None

    def _cut_filler(self) -> None:
        """Stop a playing filler so the answer starts now. An action filler is always
        cut; a neutral one that is nearly over is left to finish."""
        if self._filler_play is None:
            return
        task, kind, started, seconds = self._filler_play
        left = seconds - (self._clock.now() - started)
        if kind == "neutral" and left < config.NEUTRAL_FINISH_MS / 1000:
            return
        task.cancel()
        self._sink.stop()

    def _spawn(self, coro: Awaitable, turn: _Turn | None = None) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        group = turn.tasks if turn else self._bg
        group.add(task)
        task.add_done_callback(group.discard)
        task.add_done_callback(_log_failure)
        if turn:
            task.add_done_callback(lambda _t: self._maybe_finish(turn))
        return task

    def _stop_filler(self) -> None:
        """Stop a playing filler whatever it has left, leaving the turn itself running."""
        if self._filler_play is None:
            return
        self._filler_play[0].cancel()
        self._sink.stop()

    def _joinable(self, started: float) -> bool:
        """May words heard at `started` join the last delivered utterance? Yes while the
        window is open and no answer audio has reached the sink, filler or not."""
        if self._prev is None:
            return False
        before, _, delivered = self._prev
        return (
            started - delivered <= config.MERGE_WINDOW_MS / 1000
            and "firstFrameAtMs" not in before.stages
        )

    def _cancel_turn(self) -> None:
        turn, self._turn = self._turn, None
        if turn:
            self._finish(turn)
            for task in (turn.run, *turn.tasks):
                if task and not task.done():
                    task.cancel()
        self._sink.stop()

    # --- hearing ------------------------------------------------------------

    def _on_ear(self, event: EarEvent) -> None:
        if event.kind == "speech_start":
            return
        if event.kind == "interim":
            if not event.text.strip():
                return
            if self._prev is not None and self._piece_at is None:
                self._piece_at = self._clock.now()
            if self._piece_at is not None and self._joinable(self._piece_at):
                # Probably the rest of the last sentence: hush a filler, keep the
                # fragment's turn until the words arrive and join it.
                if self._filler_play is not None:
                    self._stop_filler()
                elif self._playing:
                    self._cancel_turn()
                return
            if self._playing:
                self._cancel_turn()  # barge-in: stop audio, close the brain stream
            return
        text = event.text.strip()
        idle = (self._turn is None or (self._turn.run and self._turn.run.done())) and not self._playing
        started, self._piece_at = self._piece_at, None
        if not text:
            if idle:  # noise with nothing in it: ask once, never over an answer
                self._spawn(self._say_fixed(fillers.REPEAT[self._lang]))
            return
        eos = self._wall_ms()
        if self._prev is not None and self._joinable(
            self._clock.now() if started is None else started
        ):
            text = self._prev[1] + " " + text  # one sentence, cut by endpointing
        self._prev = None
        self._cancel_turn()  # a new turn supersedes a running one
        self._observe(text)
        lang = self._lang
        turn = _Turn(
            id=self._new_id(), lang=lang,
            record={"clientTurnId": "", "voiceRequests": 0, "voiceRefused": False, "voiceFailed": False},
        )
        turn.record["clientTurnId"] = turn.id
        # The caller stopped about EARS_LAG_MS before the end of speech reached us.
        heard = event.heard_at_ms or eos - config.EARS_LAG_MS
        turn.stages.update(eosAtMs=eos, heardAtMs=heard)
        self.turns.append(turn.record)
        self._turn = turn
        self._prev = (turn, text, self._clock.now())
        turn.mark = self._clock.now() - config.EARS_LAG_MS / 1000  # estimated end of speech
        turn.run = asyncio.ensure_future(self._run_turn(turn, text, heard))
        turn.run.add_done_callback(_log_failure)
        turn.run.add_done_callback(lambda _t: self._maybe_finish(turn))

    # --- one turn -----------------------------------------------------------
