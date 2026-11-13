"""Per-turn logic of a call: talking to the brain, fillers, and stage times.

Split out of `call.py` mechanically; `Call` inherits these methods and owns the
state they use (`_turn`, `_clock`, `_voice`, the playback lock, and so on).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from . import config, fillers
from .brain_client import BrainRejected, BrainUnauthorized, BrainUnavailable
from .voice_out import VoiceError, VoiceRefused

log = logging.getLogger("jomcall_voice.call")

STAGE_FIELDS = (
    "clientTurnId", "heardAtMs", "eosAtMs", "brainSentAtMs", "firstSentenceAtMs",
    "ttsRequestAtMs", "firstTtsByteAtMs", "firstFrameAtMs", "fillerKind", "fillerAtMs",
    "voiceRefused", "fixedLinesSkipped",
)


@dataclass
class _Turn:
    id: str
    lang: str
    record: dict
    sentence_seen: bool = False
    neutral_done: bool = False
    action_done: bool = False
    mark: float = 0.0  # latest of turn start and last tool event
    stages: dict = field(default_factory=dict)  # wall-clock stage stamps (epoch ms)
    skipped: int = 0  # fixed lines skipped in this turn
    logged: bool = False
    trouble_done: bool = False
    rest: list[str] = field(default_factory=list)
    tasks: set[asyncio.Task] = field(default_factory=set)
    run: asyncio.Task | None = None


class TurnMixin:
    def _maybe_finish(self, turn: _Turn) -> None:
        if turn.run is not None and turn.run.done() and not turn.tasks:
            self._finish(turn)

    def _finish(self, turn: _Turn) -> None:
        """Write the turn's stage times once. Timestamps and flags only."""
        if turn.logged or self._stage_log is None:
            return
        turn.logged = True
        stages = turn.stages
        record = {
            "clientTurnId": turn.id,
            "heardAtMs": stages.get("heardAtMs"),
            "eosAtMs": stages.get("eosAtMs"),
            "brainSentAtMs": stages.get("brainSentAtMs"),
            "firstSentenceAtMs": stages.get("firstSentenceAtMs"),
            "ttsRequestAtMs": stages.get("ttsRequestAtMs"),
            "firstTtsByteAtMs": stages.get("firstTtsByteAtMs"),
            "firstFrameAtMs": stages.get("firstFrameAtMs"),
            "fillerKind": stages.get("fillerKind"),
            "fillerAtMs": stages.get("fillerAtMs"),
            "voiceRefused": bool(turn.record.get("voiceRefused")),
            "fixedLinesSkipped": turn.skipped,
        }
        try:
            self._stage_log(record)
        except Exception as error:
            log.warning("stage log failed: %s", type(error).__name__)

    def _current(self, turn: _Turn) -> bool:
        return self._turn is turn

    async def _run_turn(self, turn: _Turn, transcript: str, heard_at_ms: float) -> None:
        stream = self._brain(self._session_id, self._token, transcript, turn.id, heard_at_ms)
        timer = asyncio.ensure_future(self._timers(turn))
        self._stamp(turn, "brainSentAtMs")
        try:
            async for event in stream:
                if not self._current(turn):
                    return  # superseded: ignore whatever it still says
                if await self._on_brain_event(turn, event):
                    break
            self._flush_rest(turn)
            if not turn.sentence_seen:
                self._trouble(turn)
        except BrainUnauthorized:
            self._end("VOICE_UNAUTHORIZED")
        except (BrainRejected, BrainUnavailable):
            if self._current(turn):
                self._trouble(turn)
        except Exception as error:
            log.warning("turn failed: %s", type(error).__name__)
            if self._current(turn):
                self._trouble(turn)
        finally:
            timer.cancel()
            await stream.aclose()

    async def _on_brain_event(self, turn: _Turn, event: dict) -> bool:
        """Handle one event. Returns True when the turn is over."""
        kind = event.get("type")
        if kind == "started":
            turn.record["brainTurnId"] = event.get("turnId")
        elif kind in ("fast", "sentence"):
            text = str(event.get("text", "")).strip()
            if not text:
                return False
            self._stamp(turn, "firstSentenceAtMs")
            if turn.sentence_seen:
                turn.rest.append(text)
            else:
                turn.sentence_seen = True
                self._spawn(self._speak_sentence(turn, text), turn)
        elif kind == "tool":
            if not turn.sentence_seen:
                turn.mark = self._clock.now()  # the trouble clock restarts
                if not turn.action_done:
                    action = event.get("name")
                    self._filler(turn, action if action in fillers.LINES else None)
        elif kind == "done":
            turn.record["timings"] = event.get("timings")
            return True
        elif kind == "error":
            code = event.get("code")
            if code == "TURN_CANCELLED":
                return False
            if code in config.FATAL_BRAIN_CODES:
                self._end(str(code))
                return True
            self._trouble(turn)
            return True
        return False

    def _flush_rest(self, turn: _Turn) -> None:
        if turn.rest and self._current(turn):
            text, turn.rest = " ".join(turn.rest), []
            self._spawn(self._speak_sentence(turn, text), turn)

    async def _speak_sentence(self, turn: _Turn, text: str) -> None:
        if turn.record["voiceRequests"] >= config.MAX_VOICE_REQUESTS_PER_TURN:
            return
        turn.record["voiceRequests"] += 1
        try:
            await self._speak(text, turn=turn)
        except VoiceRefused:
            turn.record["voiceRefused"] = True  # say nothing; the call goes on
        except VoiceError:
            turn.record["voiceFailed"] = True

    def _filler(self, turn: _Turn, action: str | None) -> None:
        if action is None:
            turn.neutral_done = True
        else:
            turn.action_done = True
        line = fillers.choose(action, turn.lang, self._last_filler, None)
        if line:
            self._last_filler = line
            self._spawn(
                self._say_fixed(
                    line, unless=lambda: turn.sentence_seen, turn=turn,
                    kind="neutral" if action is None else "action",
                ),
                turn,
            )

    def _trouble(self, turn: _Turn) -> None:
        if turn.trouble_done:
            return
        turn.trouble_done = True
        line = fillers.TROUBLE[turn.lang]
        self._spawn(self._say_fixed(line, unless=lambda: turn.sentence_seen, turn=turn), turn)

    async def _timers(self, turn: _Turn) -> None:
        # Deadlines count from the estimated end of speech (`mark`), not from arrival.
        await self._clock.sleep(max(0.0, turn.mark + config.NEUTRAL_ACK_MS / 1000 - self._clock.now()))
        if not turn.sentence_seen and not turn.neutral_done and not turn.action_done:
            self._filler(turn, None)
        # The trouble clock runs from the latest of turn start and last tool event.
        while not turn.sentence_seen and not turn.trouble_done:
            wait = turn.mark + config.TROUBLE_MS / 1000 - self._clock.now()
            if wait <= 0:
                self._trouble(turn)
                return
            await self._clock.sleep(wait)
