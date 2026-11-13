"""Pure parts of the scripted caller: no LiveKit, no network, no clock of its own.

Everything here is driven by timestamps handed in, so tests use synthetic
timelines. `replay.py` wires it to a real room.

How each number is defined (also written into every output file):

* t0: the monotonic moment the last frame of the caller's SPEECH (trailing
  digital silence trimmed) was handed to LiveKit. Silence frames keep flowing
  after t0 so the worker's ears see a live stream, but they do not move t0.
* sound frame: an agent audio frame whose RMS is at or above ENERGY_THRESHOLD
  (16-bit scale). Digital silence and codec noise are below it.
* burst: sound frames separated by at most MERGE_GAP_MS, at least MIN_BURST_MS long.
* firstSoundMs: t0 to the start of the first burst.
* longestSilentGapMs: the longest stretch without a burst from t0 to the end of
  the last burst (the wait for the first sound counts as a gap).
* turn end: END_SILENCE_S (3.5 s) of quiet after a burst, TURN_CEILING_S (40 s)
  after t0, or TURN_TIMEOUT_S (15 s) with no burst at all (a timeout). How a
  turn ended never invalidates its first sound, answer start or the gaps before
  the answer.
* answerMs: the tool cannot tell a filler from an answer by ear. The worker's
  stage log gives the moment the answer's first frame was sent; without it the
  estimate is `skewMs + firstSentenceMs + ANSWER_FLOOR_MS` after t0 (skewMs =
  stored createdAt - transcriptMs - wall-clock t0; the brain's clock starts when
  the worker heard the caller, not at t0). answerMs is the start of the first
  burst at or after that moment minus ANSWER_SLACK_MS; earlier bursts are fillers.
  A burst straddling that moment is filler and answer contiguous: null, never
  a guess.
* flags, each excluding a row only from the statistics it invalidates:
  answerNotObserved (the answer could not be heard before listening stopped:
  answer statistics), tailCut (agent still sounding in the last 200 ms: gaps
  after the answer), contaminated (agent audio in the 200 ms before t0, or a
  first sound under 300 ms: first sound and gaps), unverified (no completed
  stored row or no plausible skew: answer statistics), merged/split (the stored
  input is much longer or shorter than the script line, or its words went to a
  neighbour's row: answer statistics, counted as endpoint errors).
"""

from __future__ import annotations

import asyncio
import json
import math
import time
from array import array
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

ENERGY_THRESHOLD = 120.0  # RMS on the int16 scale, about -48 dBFS
FRAME_MS = 20
MERGE_GAP_MS = 100.0
MIN_BURST_MS = 40.0
END_SILENCE_S = 3.5  # above the 3 s silence goal, so a long gap is seen, not mistaken for the end
TURN_TIMEOUT_S = 15.0  # no sound at all
TURN_CEILING_S = 40.0  # hard limit per turn
PUMP_TIMEOUT_S = 60.0
HELPER_TIMEOUT_S = 60.0
GREETING_TIMEOUT_S = 30.0
# Minimum measured time from the brain's first sentence to its first audible sound:
# the speech request, its first bytes, and framing. Measured live: 932-1207 ms on
# turns where filler and answer were unambiguous, so 550 ms is a safe lower bound.
ANSWER_FLOOR_MS = 550.0
ANSWER_SLACK_MS = 100.0
STRADDLE_TOLERANCE_MS = 500.0  # a burst starting before the earliest answer time and ending within this after it is a filler
FIRST_SOUND_FLOOR_MS = 300.0  # endpointing alone takes 300 ms: an earlier "first sound" is not a reply to this turn
TAIL_MS = 200.0  # agent audio still sounding this close to the end of listening = tail cut
PRE_QUIET_S = 1.0  # agent quiet this long before the next caller turn starts
CALLER_TAIL_MS = 2000.0  # a stored row belongs to a turn up to this long after its speech ends
MERGED_RATIO = 1.45  # stored input longer than this times the script text = merged
SPLIT_RATIO = 0.5
SKEW_PLAUSIBLE_MS = (-300.0, 3000.0)
WINDOW_TOLERANCE_MS = 300.0
CALL_BUDGET_S = 240.0  # stop starting new turns in a call after this; call cap is 300
TURNS_PER_CALL = 7
MAX_CALLS = 6

# Goals from design section 8.
GOAL_FIRST_SOUND_MS = 1500.0
GOAL_PLAIN_ANSWER_MS = 2500.0
GOAL_TOOL_ANSWER_MS = 4000.0
GOAL_MAX_SILENCE_MS = 3000.0

KINDS = ("plain", "booking", "message", "handoff")
EXPECTED_BY_LANGUAGE = {"ms": 8, "manglish": 8, "en": 4}
EXPECTED_BY_KIND = {"plain": 12, "booking": 4, "message": 2, "handoff": 2}
TOOLS = ("book_slot", "take_message", "handoff_to_human", "check_availability", "search_knowledge")

DEFINITIONS = {
    "t0": "monotonic moment the last caller speech frame was sent (trailing silence trimmed); silence frames keep streaming afterwards; the wall clock is taken at the same instant",
    "firstSoundMs": f"t0 to the first agent burst (RMS >= {ENERGY_THRESHOLD:g} on int16, >= {MIN_BURST_MS:g} ms, gaps <= {MERGE_GAP_MS:g} ms merged)",
    "answerMs": f"t0 to the first agent burst starting at or after the earliest answer time minus {ANSWER_SLACK_MS:g} ms; earliest answer time = worker stage log firstFrameAtMs - t0 when present (answerSource stages), else skewMs + brain firstSentenceMs + {ANSWER_FLOOR_MS:g} ms (answerSource estimate); skewMs = (stored createdAt - transcriptMs) - wall-clock t0, or the stage log's heardAtMs - t0; earlier bursts are fillers; null when filler and answer are contiguous or the data is missing",
    "brain": "stored turn timings (transcriptMs, firstSentenceMs, totalMs), measured by the brain from the worker's heardAtMs, not from t0; totalMs is when the brain finished TEXT, speech runs later",
    "longestSilentGapMs": "longest stretch without a burst from t0 to the end of the last burst, including the wait for the first sound; gapBeforeAnswerMs and gapAfterAnswerMs split it at the answer start",
    "turnEnd": f"{END_SILENCE_S:g} s of quiet after a burst, {TURN_CEILING_S:g} s ceiling, or {TURN_TIMEOUT_S:g} s with no burst (timeout); how a turn ended does not invalidate its first sound, answer start or earlier gaps",
    "waitBeforeTurn": f"the next caller turn starts after the agent has been quiet {PRE_QUIET_S:g} s (bounded by the ceiling; bargedIn marks a hit bound)",
    "answerNotObserved": "the earliest answer time is after the tool stopped listening: excluded from answer statistics only",
    "tailCut": f"agent audio sounding in the last {TAIL_MS:g} ms of listening: excludes only the gap after the answer, and blocks a goal 4 pass",
    "contaminated": f"agent audio in the {TAIL_MS:g} ms before t0, or a first sound under {FIRST_SOUND_FLOOR_MS:g} ms: excluded from first-sound and gap statistics",
    "unverified": "no matched completed stored row, no totalMs or no plausible skew: excluded from answer statistics; first sound stays valid",
    "merged/split": f"stored input over {MERGED_RATIO}x or under {SPLIT_RATIO}x the script line, or its words went to a neighbour's row: excluded from answer statistics; counted as endpointErrors, a product defect, not a timeout",
    "turnMatching": f"a stored voice row belongs to the turn whose caller speech start .. speech end + {CALLER_TAIL_MS:g} ms window (wall clock) contains its estimated heard time; the last completed row wins, extras are counted",
    "goals": "pass is true only from all turns of the group, clean; false only on a timeout that is not an endpoint error or a clean value over target; otherwise null with a reason and the partial value, never a verdict",
    "percentile": "nearest rank: the value at ceil(p * n) in sorted order",
    "straddle": f"a burst starting before the earliest answer time and ending within {STRADDLE_TOLERANCE_MS:g} ms after it is treated as a filler; one ending later makes answerMs null",
    "silenceGoal": "true only when every turn also has an observed answer; for a turn whose answer never arrived (suspectDropped) the quiet from the last burst to the end of listening counts as a gap",
    "arrival": "agent frame times are the arrival times of decoded frames at this client, so network and jitter-buffer delay is inside every number",
}


class ScriptError(ValueError):
    pass


# --- audio ------------------------------------------------------------------

def rms(pcm: bytes | memoryview) -> float:
    """RMS of little-endian 16-bit mono samples."""
    raw = pcm.tobytes() if isinstance(pcm, memoryview) else bytes(pcm)  # len(memoryview) counts items, not bytes
    samples = array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if not samples:
        return 0.0
    return math.sqrt(sum(x * x for x in samples) / len(samples))


def trim_silence(pcm: bytes, sample_rate: int, threshold: float = ENERGY_THRESHOLD) -> bytes:
    """Cut quiet 20 ms blocks from both ends so t0 is the end of the speech."""
    block = sample_rate * FRAME_MS // 1000 * 2
    blocks = [pcm[i : i + block] for i in range(0, len(pcm), block)]
    loud = [i for i, b in enumerate(blocks) if rms(b) >= threshold]
    if not loud:
        return b""
    return b"".join(blocks[loud[0] : loud[-1] + 1])


# --- the script ---------------------------------------------------------------

def load_script(path: Path) -> list[dict]:
    turns = json.loads(Path(path).read_text(encoding="utf-8"))["turns"]
    validate_script(turns)
    return turns


def validate_script(turns: list[dict]) -> None:
    if len(turns) != 20:
        raise ScriptError(f"expected 20 turns, found {len(turns)}")
    seen: set[str] = set()
    for t in turns:
        if set(t) != {"id", "language", "kind", "text", "expectTool"}:
            raise ScriptError(f"turn {t.get('id')!r} has the wrong fields")
        if not isinstance(t["id"], str) or not t["id"] or t["id"] in seen:
            raise ScriptError(f"duplicate or empty id {t['id']!r}")
        seen.add(t["id"])
        if t["language"] not in EXPECTED_BY_LANGUAGE:
            raise ScriptError(f"{t['id']}: unknown language {t['language']!r}")
        if t["kind"] not in KINDS:
            raise ScriptError(f"{t['id']}: unknown kind {t['kind']!r}")
        if not isinstance(t["text"], str) or not t["text"].strip():
            raise ScriptError(f"{t['id']}: empty text")
        if (t["kind"] == "plain") != (t["expectTool"] is None):
            raise ScriptError(f"{t['id']}: expectTool must be null exactly for plain turns")
        if t["expectTool"] is not None and t["expectTool"] not in TOOLS:
            raise ScriptError(f"{t['id']}: unknown tool {t['expectTool']!r}")
    for key, want, label in (
        ("language", EXPECTED_BY_LANGUAGE, "language"),
        ("kind", EXPECTED_BY_KIND, "kind"),
    ):
        got = {k: sum(1 for t in turns if t[key] == k) for k in want}
        if got != want:
            raise ScriptError(f"counts by {label} are {got}, expected {want}")


def plan_calls(count: int, per_call: int = TURNS_PER_CALL) -> list[int]:
    """Nominal split of `count` turns into balanced calls of at most `per_call`."""
    if count <= 0 or per_call <= 0:
        return []
    calls = math.ceil(count / per_call)
    base, extra = divmod(count, calls)
    return [base + (1 if i < extra else 0) for i in range(calls)]


# --- one turn's listening -------------------------------------------------------

@dataclass
class Burst:
    start_ms: float
    end_ms: float


@dataclass
class TurnTiming:
    first_sound_ms: float | None
    bursts: list[Burst]
    longest_silent_gap_ms: float | None
    ended_by: str  # "quiet" | "timeout"
    window_ms: float  # t0 to the moment listening stopped
    t0_wall_ms: float | None = None  # wall clock (epoch ms) at the same instant as t0
    speech_start_wall_ms: float | None = None  # wall clock when the caller's first speech frame went out
    pre_sound: bool | None = None  # agent audio in the last TAIL_MS before t0 (None = not observed)
    barged_in: bool = False  # the 1 s of agent quiet before this turn was not reached


class TurnTracker:
    """Folds agent audio frames into bursts. Times are seconds on one monotonic clock."""

    def __init__(
        self,
        t0: float,
        *,
        threshold: float = ENERGY_THRESHOLD,
        merge_gap_ms: float = MERGE_GAP_MS,
        min_burst_ms: float = MIN_BURST_MS,
        end_silence_s: float = END_SILENCE_S,
        timeout_s: float = TURN_TIMEOUT_S,
        ceiling_s: float = TURN_CEILING_S,
    ):
        self._ceiling = ceiling_s
        self.t0 = t0
        self._threshold, self._merge, self._min = threshold, merge_gap_ms, min_burst_ms
        self._end_silence, self._timeout = end_silence_s, timeout_s
        self._frames: list[tuple[float, float]] = []  # sound frames, ms from t0
        self.pre_sound = False  # agent sound in the last TAIL_MS before t0

    def feed(self, t: float, level: float, duration_s: float) -> None:
        if level < self._threshold:
            return
        if t < self.t0:
            if t + duration_s > self.t0 - TAIL_MS / 1000:
                self.pre_sound = True
            return
        start = (t - self.t0) * 1000
        self._frames.append((start, start + duration_s * 1000))

    def bursts(self) -> list[Burst]:
        out: list[Burst] = []
        for start, end in sorted(self._frames):
            if out and start - out[-1].end_ms <= self._merge:
                out[-1].end_ms = max(out[-1].end_ms, end)
            else:
                out.append(Burst(start, end))
        return [b for b in out if b.end_ms - b.start_ms >= self._min]

    def status(self, now: float) -> str | None:
        elapsed_ms = (now - self.t0) * 1000
        bursts = self.bursts()
        if bursts and elapsed_ms >= self._ceiling * 1000:
            return "ceiling"
        if bursts:
            return "quiet" if elapsed_ms - bursts[-1].end_ms >= self._end_silence * 1000 else None
        return "timeout" if elapsed_ms >= self._timeout * 1000 else None

    def result(self, now: float, ended_by: str) -> TurnTiming:
        bursts = self.bursts()
        gap = None
        if bursts:
            gaps = [bursts[0].start_ms] + [b.start_ms - a.end_ms for a, b in zip(bursts, bursts[1:])]
            gap = max(gaps)
        return TurnTiming(
            first_sound_ms=bursts[0].start_ms if bursts else None,
            bursts=bursts,
            longest_silent_gap_ms=gap,
            ended_by=ended_by,
            window_ms=(now - self.t0) * 1000,
            pre_sound=self.pre_sound,
        )


class Clock:
    def now(self) -> float:
        raise NotImplementedError

    async def sleep(self, seconds: float) -> None:
        raise NotImplementedError


async def listen(frames: "asyncio.Queue[tuple[float, float, float]]", clock, tracker: TurnTracker, poll_s: float = 0.02) -> str:
    """Feed frames (arrival time, rms, duration) to the tracker until the turn ends."""
    while True:
        ended = tracker.status(clock.now())
        if ended:
            return ended
        try:
            t, level, duration = await asyncio.wait_for(frames.get(), poll_s)
        except asyncio.TimeoutError:
            continue
        tracker.feed(t, level, duration)


def resolve_answer(bursts: list[Burst], expected_ms: float | None, slack_ms: float = ANSWER_SLACK_MS) -> tuple[float | None, str | None]:
    """The answer is the first burst starting at or after `expected_ms - slack_ms`.

    `expected_ms` is when, after t0, an answer can first be audible: the worker's
    stage log when present, else skew + firstSentenceMs + ANSWER_FLOOR_MS.
    """
    if expected_ms is None:
        return None, "no way to place the brain's first sentence against t0"
    floor = max(0.0, expected_ms - slack_ms)
    for burst in bursts:
        if burst.end_ms <= floor:
            continue  # a filler: it ended before any answer could exist
        if burst.start_ms >= floor:
            return burst.start_ms, None
        if burst.end_ms - floor <= STRADDLE_TOLERANCE_MS:
            continue  # a filler that ran a little past the earliest answer time
        return None, "a burst straddles the earliest answer time (filler and answer may be contiguous); the start of the answer cannot be separated"
    return None, "no agent audio at or after the brain's first sentence"


def estimate_heard_ms(stored: dict) -> float | None:
    """Epoch ms when the worker heard the caller finish: row creation minus transcriptMs."""
    created = stored.get("createdMs")
    if created is None:
        return None
    return created - ((stored.get("timings") or {}).get("transcriptMs") or 0)


def match_rows(windows: list[tuple[float, float] | None], stored: list[dict]) -> tuple[list[dict | None], list[int], int]:
    """Assign stored voice rows to caller turns.

    A window is (speech start, speech end + CALLER_TAIL_MS) in epoch ms; a row
    belongs to the turn whose window contains its estimated heard time (a final
    transcript can land in the middle of the utterance). Returns (row per turn,
    extra rows per turn, rows that fit no window). The last completed row wins.
    """
    buckets: list[list[dict]] = [[] for _ in windows]
    stray = 0
    for row in stored:
        heard = estimate_heard_ms(row)
        placed = False
        if heard is not None:
            for i, w in enumerate(windows):
                if w is not None and w[0] <= heard <= w[1]:
                    buckets[i].append({**row, "heardEstMs": heard})
                    placed = True
                    break
        stray += 0 if placed else 1
    chosen: list[dict | None] = []
    extra: list[int] = []
    for bucket in buckets:
        done = [r for r in bucket if r.get("state") == "completed"]
        chosen.append((done or bucket or [None])[-1])
        extra.append(max(0, len(bucket) - 1))
    return chosen, extra, stray


async def wait_quiet(frames, clock, quiet_s: float = PRE_QUIET_S, ceiling_s: float = TURN_CEILING_S, last_sound_t: float | None = None, threshold: float = ENERGY_THRESHOLD, poll_s: float = 0.02) -> bool:
    """Consume agent frames until none has sounded for `quiet_s`. False if the ceiling hit first."""
    start = clock.now()
    last = last_sound_t
    while True:
        now = clock.now()
        if last is None or now - last >= quiet_s:
            return True
        if now - start >= ceiling_s:
            return False
        try:
            t, level, duration = await asyncio.wait_for(frames.get(), poll_s)
        except asyncio.TimeoutError:
            continue
        if level >= threshold:
            last = max(last, t + duration)


# --- the caller's side: paced frames ---------------------------------------------

class PumpStalled(Exception):
    pass


class Pump:
    """Sends 20 ms frames in real time: queued speech first, silence otherwise."""

    def __init__(self, push: Callable[[bytes], Awaitable[None]], clock, sample_rate: int, wall_ms: Callable[[], float] = lambda: time.time() * 1000):
        self._push, self._clock, self._wall = push, clock, wall_ms
        self.t0_wall_ms: float | None = None  # wall clock at the instant t0 was taken
        self.speech_start_wall_ms: float | None = None  # wall clock when the first speech frame is sent
        self._start_pending = False
        self.frame_bytes = sample_rate * FRAME_MS // 1000 * 2
        self._silence = bytes(self.frame_bytes)
        self._speech: deque[bytes] = deque()
        self._waiting: tuple[int, "asyncio.Future[float]"] | None = None
        self._stop = False
        self.frames_sent = 0

    def say(self, pcm: bytes) -> "asyncio.Future[float]":
        """Queue speech. The future resolves with t0, the moment its last frame was sent."""
        size = self.frame_bytes
        for i in range(0, len(pcm), size):
            self._speech.append(pcm[i : i + size].ljust(size, b"\x00"))
        future: asyncio.Future[float] = asyncio.get_running_loop().create_future()
        self._start_pending = bool(pcm)
        if not self._speech:
            self.t0_wall_ms = self._wall()
            future.set_result(self._clock.now())
        else:
            self._waiting = (len(self._speech), future)
        return future

    async def say_wait(self, pcm: bytes, timeout_s: float = PUMP_TIMEOUT_S) -> float:
        """`say`, failing with PumpStalled if the last frame is not sent in time."""
        try:
            return await asyncio.wait_for(self.say(pcm), timeout_s)
        except asyncio.TimeoutError:
            raise PumpStalled(f"the caller audio was not sent within {timeout_s:g} s") from None

    def stop(self) -> None:
        self._stop = True

    async def run(self) -> None:
        next_at = self._clock.now()
        while not self._stop:
            frame = self._speech.popleft() if self._speech else self._silence
            if self._start_pending and frame is not self._silence:
                self.speech_start_wall_ms = self._wall()
                self._start_pending = False
            await self._push(frame)
            self.frames_sent += 1
            if self._waiting is not None:
                left, future = self._waiting
                left -= 1
                if left <= 0:
                    if not future.done():
                        self.t0_wall_ms = self._wall()
                        future.set_result(self._clock.now())
                    self._waiting = None
                else:
                    self._waiting = (left, future)
            next_at += FRAME_MS / 1000
            await self._clock.sleep(max(0.0, next_at - self._clock.now()))


# --- synthesis of the caller's audio -------------------------------------------------

@dataclass
class PrepareResult:
    synthesized: int
    skipped: int
    remaining: int
    refused: bool


async def prepare(voice, clock, texts: list[str], max_per_min: float, refused_error: type, voice_error: type, say=print) -> PrepareResult:
    """Cache every line; resumable, rate-limited, stops cleanly on a refusal."""
    todo = [x for x in texts if voice.lookup(x) is None]
    skipped = len(texts) - len(todo)
    interval = 60 / max_per_min
    done = 0
    for index, text in enumerate(todo):
        if done:
            await clock.sleep(interval)
        try:
            await voice.cached(text)
        except refused_error:
            left = len(todo) - index
            say(f"Refused by the speech service. {left} lines remain; run again later.")
            return PrepareResult(done, skipped, left, True)
        except voice_error:
            left = len(todo) - index
            say(f"A request failed. {left} lines remain; run again.")
            return PrepareResult(done, skipped, left, False)
        done += 1
        say(f"cached {done}/{len(todo)}")
    return PrepareResult(done, skipped, 0, False)


# --- numbers ------------------------------------------------------------------------

def median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    return s[max(1, math.ceil(p * len(s))) - 1]


def spread(values: list[float]) -> dict:
    return {
        "n": len(values),
        "median": median(values),
        "p90": percentile(values, 0.9),
        "max": max(values) if values else None,
    }


# --- one scored row ------------------------------------------------------------------

PROPOSAL_OF = {"book_slot": "booking", "take_message": "message", "handoff_to_human": "handoff"}
STAGE_FIELDS = ("clientTurnId", "heardAtMs", "eosAtMs", "brainSentAtMs", "firstSentenceAtMs", "ttsRequestAtMs", "firstTtsByteAtMs", "firstFrameAtMs", "fillerKind", "fillerAtMs", "voiceRefused", "fixedLinesSkipped")


def gaps_of(bursts: list[Burst]) -> list[tuple[float, float]]:
    """(start of the burst that ends the gap, gap length) from t0 on."""
    if not bursts:
        return []
    return [(bursts[0].start_ms, bursts[0].start_ms)] + [(b.start_ms, b.start_ms - a.end_ms) for a, b in zip(bursts, bursts[1:])]


def stage_breakdown(stage: dict | None) -> dict | None:
    """Intervals between the worker's stage stamps; a missing stamp leaves its interval null."""
    if not stage:
        return None
    d = lambda a, b: None if stage.get(a) is None or stage.get(b) is None else stage[b] - stage[a]
    return {
        "heardToEos": d("heardAtMs", "eosAtMs"),
        "eosToBrainSent": d("eosAtMs", "brainSentAtMs"),
        "brainSentToFirstSentence": d("brainSentAtMs", "firstSentenceAtMs"),
        "firstSentenceToTtsRequest": d("firstSentenceAtMs", "ttsRequestAtMs"),
        "ttsRequestToFirstByte": d("ttsRequestAtMs", "firstTtsByteAtMs"),
        "firstByteToFirstFrame": d("firstTtsByteAtMs", "firstFrameAtMs"),
        "heardToFiller": d("heardAtMs", "fillerAtMs"),
    }


def read_stages(path: Path) -> list[dict]:
    """The worker's per-turn stage log (JSON lines). A missing file or a bad line gives fewer rows, never an error."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        return []
    out = []
    for line in text.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            out.append({k: row.get(k) for k in STAGE_FIELDS})
    return out


def join_stage(stored: dict | None, stages: list[dict], heard_est_ms: float | None, tolerance_ms: float = 1500.0) -> dict | None:
    """The stage row of a stored turn: by client turn id, else the nearest heardAtMs."""
    if not stages:
        return None
    if stored is not None and stored.get("clientTurnId"):
        for st in stages:
            if st.get("clientTurnId") == stored["clientTurnId"]:
                return st
    if heard_est_ms is None:
        return None
    near = [st for st in stages if st.get("heardAtMs") is not None]
    if not near:
        return None
    best = min(near, key=lambda st: abs(st["heardAtMs"] - heard_est_ms))
    return best if abs(best["heardAtMs"] - heard_est_ms) <= tolerance_ms else None


def score_turn(turn: dict, call_no: int, timing: TurnTiming, stored: dict | None, stored_reason: str | None, extra_rows: int = 0, stage: dict | None = None, skew_override: float | None = None) -> dict:
    """One row: client-side audio timings joined with the stored row and the stage log.

    Each flag excludes the row only from the statistics it invalidates (see summarize).
    """
    not_measured: dict[str, str] = {}
    t0w = timing.t0_wall_ms
    brain = None
    if stored is not None:
        t = stored.get("timings") or {}
        brain = {k: t.get(k) for k in ("transcriptMs", "firstSentenceMs", "totalMs")}
    skew, skew_source = None, None
    if skew_override is not None:
        skew, skew_source = skew_override, "saved"
    elif stage is not None and stage.get("heardAtMs") is not None and t0w is not None:
        skew, skew_source = stage["heardAtMs"] - t0w, "stages"
    elif stored is not None and stored.get("heardEstMs") is not None and t0w is not None:
        skew, skew_source = stored["heardEstMs"] - t0w, "stored"
    low, high = SKEW_PLAUSIBLE_MS
    if stored is None:
        unverified = stored_reason or "no stored voice turn matched"
    elif stored.get("state") != "completed":
        unverified = f"stored turn state is {stored.get('state')}"
    elif brain["totalMs"] is None:
        unverified = "stored turn has no totalMs"
    elif skew is None:
        unverified = "no wall-clock t0 or creation time to place the brain's clock"
    elif not low <= skew <= high:
        unverified = f"implausible skew ({skew:.0f} ms)"
    else:
        unverified = None
    # When can an answer first be audible, after t0?
    expected, source = None, None
    if stage is not None and stage.get("firstFrameAtMs") is not None and t0w is not None:
        expected, source = stage["firstFrameAtMs"] - t0w, "stages"
    elif brain is not None and brain["firstSentenceMs"] is not None and skew is not None and low <= skew <= high:
        expected, source = skew + brain["firstSentenceMs"] + ANSWER_FLOOR_MS, "estimate"
    not_observed = expected is not None and expected > timing.window_ms
    if timing.first_sound_ms is None:
        answer_ms, answer_reason = None, "no agent sound before the turn timed out"
    elif not_observed:
        answer_ms, answer_reason = None, "the answer could not have been heard before listening stopped"
    else:
        answer_ms, answer_reason = resolve_answer(timing.bursts, expected)
    bursts = timing.bursts
    tail_cut = bool(bursts) and bursts[-1].end_ms >= timing.window_ms - TAIL_MS
    gaps = gaps_of(bursts)
    before = after = None
    if answer_ms is not None:
        pre = [g for start, g in gaps if start <= answer_ms]
        post = [g for start, g in gaps if start > answer_ms]
        before, after = (max(pre) if pre else None), (max(post) if post else None)
    longest = max((g for _, g in gaps), default=None)
    contaminated_by = None
    if timing.pre_sound:
        contaminated_by = "agent audio in the last 200 ms before t0"
    elif timing.first_sound_ms is not None and timing.first_sound_ms < FIRST_SOUND_FLOOR_MS:
        contaminated_by = f"first sound under {FIRST_SOUND_FLOOR_MS:g} ms cannot be a reply to this turn"
    input_chars = None if stored is None else stored.get("inputChars")
    merged = split = False
    endpoint_reason = None
    if input_chars is not None:
        own = len(turn["text"])
        if input_chars > MERGED_RATIO * own:
            merged, endpoint_reason = True, f"stored input is {input_chars} chars for a {own}-char script line"
        elif input_chars < SPLIT_RATIO * own:
            split, endpoint_reason = True, f"stored input is {input_chars} chars for a {own}-char script line"
    tools = stored["tools"] if stored else None
    proposals = stored["proposals"] if stored else None
    expected_used = None
    if stored is not None and turn["expectTool"] is not None:
        expected_used = turn["expectTool"] in tools or PROPOSAL_OF.get(turn["expectTool"]) in proposals
    suspect = bool(
        stored is not None and stored.get("state") == "completed" and brain["firstSentenceMs"] is not None
        and not not_observed and (timing.first_sound_ms is None or (answer_reason or "").startswith("no agent audio at or after"))
    )
    if brain is None:
        not_measured["brain"] = stored_reason or "no stored turn row"
    if answer_ms is None:
        not_measured["answerMs"] = answer_reason or "unknown"
    if timing.first_sound_ms is None:
        not_measured["firstSoundMs"] = f"no agent sound within {TURN_TIMEOUT_S:g} s of t0 (timeout)"
    if timing.pre_sound is None:
        not_measured["contaminated"] = "agent audio before t0 was not observed in this data"
    not_measured["readBackBeforeProposal"] = (
        "the stored turn keeps the whole answer, not the order of spoken text and tool calls; "
        "the 48-case voice test (npm run check:voice-model) is the brain-side check"
    )
    not_measured["replyLanguage"] = "not judged here: the stored answer text is deliberately not read or kept"
    return {
        "id": turn["id"], "call": call_no, "language": turn["language"], "kind": turn["kind"], "expectTool": turn["expectTool"],
        "firstSoundMs": timing.first_sound_ms,
        "answerMs": answer_ms,
        "answerSource": source,
        "answerExpectedMs": expected,
        "longestSilentGapMs": longest,
        "gapBeforeAnswerMs": before,
        "gapAfterAnswerMs": after,
        "timedOut": timing.ended_by == "timeout",
        "endedBy": timing.ended_by,
        "windowMs": timing.window_ms,
        "bursts": [{"startMs": b.start_ms, "endMs": b.end_ms} for b in bursts],
        "answerNotObserved": not_observed,
        "tailCut": tail_cut,
        "trailingQuietMs": (timing.window_ms - bursts[-1].end_ms) if bursts else None,
        "contaminated": contaminated_by is not None,
        "contaminatedBy": contaminated_by,
        "unverified": unverified is not None,
        "unverifiedReason": unverified,
        "merged": merged,
        "split": split,
        "endpointReason": endpoint_reason,
        "bargedIn": timing.barged_in,
        "skewMs": skew,
        "skewSource": skew_source,
        "brain": brain,
        "inputChars": input_chars,
        "extraStoredRows": extra_rows,
        "fastServed": None if stored is None else bool((stored.get("timings") or {}).get("fastLane")),
        "answerChars": None if stored is None else stored.get("answerChars"),
        "state": None if stored is None else stored.get("state"),
        "errorCode": None if stored is None else stored.get("errorCode"),
        "tools": tools,
        "proposals": proposals,
        "expectedToolUsed": expected_used,
        "suspectDropped": suspect,
        "stages": stage_breakdown(stage),
        "fillerKind": None if stage is None else stage.get("fillerKind"),
        "voiceRefused": None if stage is None else stage.get("voiceRefused"),
        "readBackBeforeProposal": None,
        "notMeasured": not_measured,
    }


def link_endpoint_errors(rows: list[dict]) -> None:
    """Find the turns whose words went to a neighbour's stored row (merged) or never got one (split)."""
    no_row = lambda r: r["unverified"] and r["brain"] is None
    for r, n in zip(rows, rows[1:]):
        if r["call"] != n["call"]:
            continue
        used = set(n["tools"] or []) | set(n["proposals"] or [])
        wants = {r["expectTool"], PROPOSAL_OF.get(r["expectTool"])} - {None}
        n_own = {n["expectTool"], PROPOSAL_OF.get(n["expectTool"])} - {None}
        by_tools = bool(wants & used) and not (wants & n_own) and n["inputChars"] is None
        if no_row(r) and n["brain"] is not None and (n["merged"] or by_tools):
            r["split"], n["merged"] = True, True
            r["endpointReason"] = r["endpointReason"] or "its words were stored with the next turn"
            n["endpointReason"] = n["endpointReason"] or "also holds the previous turn's words (tools of both)"
        elif r["merged"] and no_row(n):
            n["split"] = True
            n["endpointReason"] = n["endpointReason"] or "its words were stored with the previous turn"


# --- summary ------------------------------------------------------------------------------

def _first_valid(r: dict) -> bool:
    return r.get("firstSoundMs") is not None and not r.get("contaminated")


def _answer_valid(r: dict) -> bool:
    return r.get("answerMs") is not None and not any(r.get(k) for k in ("answerNotObserved", "unverified", "merged", "split", "timedOut"))


def _endpoint(r: dict) -> bool:
    return bool(r.get("merged") or r.get("split"))


def _gap_for_stats(r: dict) -> float | None:
    if r.get("contaminated"):
        return None
    gap = r.get("gapBeforeAnswerMs") if r.get("tailCut") else r.get("longestSilentGapMs")
    if r.get("suspectDropped") and not r.get("tailCut") and r.get("trailingQuietMs") is not None and not _endpoint(r):
        gap = max(gap or 0.0, r["trailingQuietMs"])  # the answer never came: that silence is real
    return gap


def _observed_answer(r: dict) -> bool:
    return r.get("answerMs") is not None and not (r.get("suspectDropped") or r.get("answerNotObserved") or _endpoint(r))


def _goal(target: float, value: float | None, ok: bool | None, reason: str | None = None, partial: dict | None = None) -> dict:
    out: dict = {"targetMs": target, "valueMs": value, "pass": ok}
    if ok is None:
        out["reason"] = reason or "not enough measured turns"
        out["partial"] = partial
    return out


def _median_goal(target: float, group: list[dict], run_complete: bool) -> dict:
    good = [r["answerMs"] for r in group if _answer_valid(r)]
    mid = median(good)
    if not run_complete:
        return _goal(target, None, None, "not every turn was run", {"n": len(good), "of": len(group), "value": mid})
    if not group:
        return _goal(target, None, None, "no turns in this group", {"n": 0, "of": 0, "value": None})
    if len(good) != len(group):
        return _goal(target, None, None, f"{len(group) - len(good)} of {len(group)} turns have no observed, verified, non-merged answer start", {"n": len(good), "of": len(group), "value": mid})
    return _goal(target, mid, mid <= target)


def summarize(rows: list[dict], expected_turns: int = 20, end_silence_s: float = END_SILENCE_S) -> dict:
    """Per-turn rows to a summary. Statistics use only the turns each flag leaves valid.

    A goal is true only from complete clean data. It is false only on a timeout
    that is not an endpoint error, or on a clean value over target.
    """
    complete = len(rows) == expected_turns
    plain = [r for r in rows if r["expectTool"] is None]
    tool = [r for r in rows if r["expectTool"] is not None]
    got = lambda rs, f, k: [r[k] for r in rs if f(r) and r.get(k) is not None]
    real_timeouts = [r for r in rows if r["timedOut"] and not _endpoint(r)]
    firsts = got(rows, _first_valid, "firstSoundMs")
    if real_timeouts:
        first = _goal(GOAL_FIRST_SOUND_MS, None, False)
        first["note"] = f"{len(real_timeouts)} turn(s) timed out with no sound"
    elif firsts and max(firsts) > GOAL_FIRST_SOUND_MS:
        first = _goal(GOAL_FIRST_SOUND_MS, max(firsts), False)
        first["note"] = "a clean turn's first sound is over target"
    elif complete and len(firsts) == len(rows):
        first = _goal(GOAL_FIRST_SOUND_MS, max(firsts), True)
    else:
        first = _goal(GOAL_FIRST_SOUND_MS, None, None, f"{len(rows) - len(firsts)} of {len(rows)} turns have no valid first sound (contaminated, endpoint error or none)" if complete else "not every turn was run", {"n": len(firsts), "of": expected_turns, "value": max(firsts) if firsts else None})
    gaps = [g for r in rows if (g := _gap_for_stats(r)) is not None]
    top_gap = max(gaps) if gaps else None
    if end_silence_s <= GOAL_MAX_SILENCE_MS / 1000:
        silence = _goal(GOAL_MAX_SILENCE_MS, None, None, f"a turn ends after {end_silence_s:g} s of quiet, so a longer gap cannot be seen; run with --end-silence above 3", {"value": top_gap})
    elif real_timeouts:
        silence = _goal(GOAL_MAX_SILENCE_MS, None, False)
        silence["note"] = "a turn had no sound for the whole timeout"
    elif top_gap is not None and top_gap > GOAL_MAX_SILENCE_MS:
        silence = _goal(GOAL_MAX_SILENCE_MS, top_gap, False)
        silence["note"] = "a clean gap is over target"
    elif complete and len(gaps) == len(rows) and not any(r["tailCut"] for r in rows) and all(_observed_answer(r) for r in rows):
        silence = _goal(GOAL_MAX_SILENCE_MS, top_gap, True)
    else:
        silence = _goal(GOAL_MAX_SILENCE_MS, None, None, "some turns are contaminated, tail-cut, not run or have no observed answer, so gaps after the answer are not fully seen", {"n": len(gaps), "of": expected_turns, "value": top_gap})
    stage_rows = [r["stages"] for r in rows if r.get("stages")]
    stage_names = ("heardToEos", "eosToBrainSent", "brainSentToFirstSentence", "firstSentenceToTtsRequest", "ttsRequestToFirstByte", "firstByteToFirstFrame", "heardToFiller")
    stages = None
    if stage_rows:
        stages = {"turns": len(stage_rows), "medianMs": {n: median([x[n] for x in stage_rows if x.get(n) is not None]) for n in stage_names}}
    refused = None
    if any(r.get("voiceRefused") is not None for r in rows):
        refused = {"value": sum(1 for r in rows if r.get("voiceRefused")), "source": "worker stage log"}
    else:
        refused = {"value": None, "notMeasured": "no worker stage log for this run; refusals are otherwise not observable (see suspectedDroppedAnswerTurns)"}
    ids = lambda f: [r["id"] for r in rows if f(r)]
    return {
        "turnsPlanned": expected_turns,
        "turnsRun": len(rows),
        "endSilenceS": end_silence_s,
        "timeouts": sum(1 for r in rows if r["timedOut"]),
        "timedOutTurns": ids(lambda r: r["timedOut"]),
        "contaminatedTurns": [{"id": r["id"], "reason": r.get("contaminatedBy")} for r in rows if r.get("contaminated")],
        "unverifiedTurns": [{"id": r["id"], "reason": r.get("unverifiedReason")} for r in rows if r.get("unverified")],
        "answerNotObservedTurns": ids(lambda r: r.get("answerNotObserved")),
        "tailCutTurns": ids(lambda r: r.get("tailCut")),
        "bargedInTurns": ids(lambda r: r.get("bargedIn")),
        "endpointErrors": {
            "merged": ids(lambda r: r.get("merged")),
            "split": ids(lambda r: r.get("split")),
            "count": sum(1 for r in rows if _endpoint(r)),
            "note": "a product defect (the caller's words were stored with another turn), not a timeout",
        },
        "refusedVoiceRequests": refused,
        "suspectedDroppedAnswerTurns": ids(lambda r: r.get("suspectDropped")),
        "answerSources": {k: sum(1 for r in rows if r.get("answerSource") == k) for k in ("stages", "estimate")},
        "stages": stages,
        "fastLaneTurns": sum(1 for r in rows if r.get("fastServed")),
        "turnsWithStoredRow": sum(1 for r in rows if r.get("brain") is not None),
        "extraStoredRows": sum(r.get("extraStoredRows") or 0 for r in rows),
        "statisticsOver": "first sound: turns with a valid first sound; answer: observed, verified, non-merged turns; gap: not contaminated, post-answer tail excluded when cut",
        "firstSoundMs": {"all": spread(firsts), "plain": spread(got(plain, _first_valid, "firstSoundMs")), "tool": spread(got(tool, _first_valid, "firstSoundMs"))},
        "answerMs": {"plain": spread(got(plain, _answer_valid, "answerMs")), "tool": spread(got(tool, _answer_valid, "answerMs"))},
        "longestSilentGapMs": top_gap,
        "goals": {
            "firstSoundWithin1500OnEveryTurn": first,
            "plainAnswerMedianWithin2500": _median_goal(GOAL_PLAIN_ANSWER_MS, plain, complete),
            "toolAnswerMedianWithin4000": _median_goal(GOAL_TOOL_ANSWER_MS, tool, complete),
            "noSilenceOver3000": silence,
        },
        "answerNotMeasuredTurns": ids(lambda r: r.get("answerMs") is None),
    }


def rescore(saved: dict, script: list[dict], end_silence_s: float | None = None) -> dict:
    """Recompute flags and summary from a saved run's raw rows. No network.

    Uses: bursts, window, first sound, stored timings, skew, tools, proposals.
    Not in the saved data (reported, never guessed): wall-clock t0 and speech
    start, agent audio before t0, stored input length, the worker's stage log,
    barge-in waits.
    """
    by_id = {t["id"]: t for t in script}
    rows = []
    for old in saved["rows"]:
        bursts = [Burst(b["startMs"], b["endMs"]) for b in old["bursts"]]
        timing = TurnTiming(old.get("firstSoundMs"), bursts, old.get("longestSilentGapMs"), old.get("endedBy", "quiet"), old["windowMs"])
        stored = None
        if old.get("brain") is not None:
            stored = {
                "state": old.get("state"), "timings": {**old["brain"], **({"fastLane": True} if old.get("fastServed") else {})},
                "tools": old.get("tools") or [], "proposals": old.get("proposals") or [], "answerChars": old.get("answerChars"),
                "errorCode": old.get("errorCode"),
            }
        rows.append(score_turn(by_id[old["id"]], old["call"], timing, stored, old.get("unverifiedReason"), old.get("extraStoredRows") or 0, skew_override=old.get("skewMs")))
    link_endpoint_errors(rows)
    summary = summarize(rows, end_silence_s=end_silence_s if end_silence_s is not None else saved.get("endSilenceS", END_SILENCE_S))
    return {
        "rescoredFrom": saved.get("generatedAtUtc"),
        "rows": rows,
        "summary": summary,
        "notRecomputable": {
            "contaminatedByPreSound": "agent audio before t0 was not saved; only the implausibly early first sound rule applies",
            "mergedBySplitByLength": "stored input length was not saved; merged/split come from tools credited to the wrong turn",
            "rowMatchingWindows": "wall-clock t0 and speech start were not saved; the saved matches are kept",
            "stages": "no worker stage log in the saved run: every answer uses the estimate",
            "bargedIn": "not recorded in the saved run",
        },
    }


def _partial_text(partial: dict | None) -> str:
    if not partial:
        return ""
    value = partial.get("value")
    shown = "no value" if value is None else f"{value:.0f} ms"
    count = "" if partial.get("n") is None else f"{partial.get('n')} of {partial.get('of')} turns, "
    return f"; partial, not a verdict: {count}{shown}"


def _cell(value, width: int) -> str:
    text = "-" if value is None else (f"{value:.0f}" if isinstance(value, float) else str(value))
    return text.rjust(width)


def render_table(rows: list[dict], summary: dict) -> str:
    head = f"{'id':<4} {'call':>4} {'lang':<8} {'kind':<8} {'first':>6} {'answer':>6} {'gap':>6}  note"
    lines = [head, "-" * len(head)]
    flags = (("timedOut", "timeout"), ("fastServed", "fast"), ("answerNotObserved", "answer-unseen"), ("tailCut", "tail-cut"),
             ("contaminated", "contaminated"), ("unverified", "unverified"), ("merged", "merged"), ("split", "split"), ("bargedIn", "barged-in"))
    for r in rows:
        notes = [label for key, label in flags if r.get(key)]
        if r.get("expectedToolUsed") is False:
            notes.append(f"no {r['expectTool']}")
        lines.append(
            f"{r['id']:<4} {r['call']:>4} {r['language']:<8} {r['kind']:<8} "
            f"{_cell(r.get('firstSoundMs'), 6)} {_cell(r.get('answerMs'), 6)} {_cell(_gap_for_stats(r), 6)}  {' '.join(notes)}"
        )
    s = summary
    f, a = s["firstSoundMs"], s["answerMs"]
    fmt = lambda x: "-" if x is None else f"{x:.0f}"
    lines += [
        "",
        f"first sound ms  all: median {fmt(f['all']['median'])} p90 {fmt(f['all']['p90'])} max {fmt(f['all']['max'])} (n={f['all']['n']})",
        f"answer ms     plain: median {fmt(a['plain']['median'])} p90 {fmt(a['plain']['p90'])} (n={a['plain']['n']})",
        f"answer ms      tool: median {fmt(a['tool']['median'])} p90 {fmt(a['tool']['p90'])} (n={a['tool']['n']})",
        f"longest silent gap ms: {fmt(s['longestSilentGapMs'])}; timeouts {s['timeouts']}; endpoint errors {s['endpointErrors']['count']}; fast lane {s['fastLaneTurns']}; turns run {s['turnsRun']}/{s['turnsPlanned']}",
    ]
    r = s["refusedVoiceRequests"]
    lines.append(f"refused voice requests: {r['value']} (worker stage log)" if r.get("source") else f"refused voice requests: not observable; suspected dropped answers: {', '.join(s['suspectedDroppedAnswerTurns']) or 'none'}")
    if s.get("stages"):
        lines.append("stage medians ms: " + ", ".join(f"{k} {fmt(v)}" for k, v in s["stages"]["medianMs"].items()))
    for name, g in s["goals"].items():
        verdict = "not decided" if g["pass"] is None else ("PASS" if g["pass"] else "MISS")
        why = f" - {g['reason']}{_partial_text(g.get('partial'))}" if g.get("reason") else (f" - {g['note']}" if g.get("note") else "")
        lines.append(f"goal {name}: {verdict} (target {g['targetMs']:.0f}, value {fmt(g['valueMs'])}){why}")
    lines.append("answer ms = first agent burst at/after the estimated earliest answer time; see 'definitions' in the output file")
    return "\n".join(lines)
