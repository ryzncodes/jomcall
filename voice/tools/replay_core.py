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
* turn end: END_SILENCE_S of quiet after a burst, or TURN_TIMEOUT_S after t0
  with no burst at all (recorded as a timeout).
* answerMs: the tool cannot tell a filler from an answer by ear. The brain's
  `firstSentenceMs` is measured from the worker's `heardAtMs`, which is NOT t0:
  it comes after the caller's endpointing wait and the final transcript. The
  stored row gives it away: heardAt is about `createdAt - transcriptMs`. With
  the wall-clock time of t0 recorded at the same instant as the monotonic one,
  skewMs = heardAt - t0 (both on this machine's clock) and the earliest an
  answer can exist is `skewMs + firstSentenceMs` after t0. answerMs is the start
  of the first burst at or after that point minus ANSWER_SLACK_MS. Earlier
  bursts are fillers (the neutral acknowledgement plays at about heardAt + 800 ms,
  so it lands before that point). A burst that straddles the point means filler
  and answer are contiguous: null with a reason, never a guess. A skew outside
  SKEW_PLAUSIBLE_MS also gives null (clock disagreement).
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
END_SILENCE_S = 1.5
TURN_TIMEOUT_S = 15.0
GREETING_TIMEOUT_S = 30.0
ANSWER_SLACK_MS = 50.0
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
    "t0": "monotonic moment the last caller speech frame was sent (trailing silence trimmed); silence frames keep streaming afterwards",
    "firstSoundMs": f"t0 to the first agent burst (RMS >= {ENERGY_THRESHOLD:g} on int16, >= {MIN_BURST_MS:g} ms, gaps <= {MERGE_GAP_MS:g} ms merged)",
    "answerMs": f"t0 to the first agent burst starting at or after skewMs + brain firstSentenceMs - {ANSWER_SLACK_MS:g} ms, where skewMs = (stored createdAt - transcriptMs) - wall-clock t0 estimates when the worker heard the caller finish; earlier bursts are fillers; null when filler and answer are contiguous, the skew is outside {SKEW_PLAUSIBLE_MS[0]:g}..{SKEW_PLAUSIBLE_MS[1]:g} ms, or the brain row is missing",
    "turnMatching": f"each stored voice row is assigned to the caller turn whose t0 window (wall clock, {WINDOW_TOLERANCE_MS:g} ms early tolerance) contains its estimated heardAt; the last completed row in a window is used and extra rows are counted",
    "brain": "stored turn timings (transcriptMs, firstSentenceMs, totalMs), measured by the brain from the worker's heardAtMs, not from t0",
    "longestSilentGapMs": "longest stretch without a burst between t0 and the end of the last burst, including the wait for the first sound",
    "turnEnd": f"{END_SILENCE_S:g} s of quiet after a burst, or {TURN_TIMEOUT_S:g} s with no burst (timeout)",
    "percentile": "nearest rank: the value at ceil(p * n) in sorted order",
    "arrival": "agent frame times are the arrival times of decoded frames at this client, so network and jitter-buffer delay is inside every number",
}


class ScriptError(ValueError):
    pass


# --- audio ------------------------------------------------------------------

def rms(pcm: bytes | memoryview) -> float:
    """RMS of little-endian 16-bit mono samples."""
    samples = array("h")
    samples.frombytes(bytes(pcm)[: len(pcm) - (len(pcm) % 2)])
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
    ):
        self.t0 = t0
        self._threshold, self._merge, self._min = threshold, merge_gap_ms, min_burst_ms
        self._end_silence, self._timeout = end_silence_s, timeout_s
        self._frames: list[tuple[float, float]] = []  # sound frames, ms from t0

    def feed(self, t: float, level: float, duration_s: float) -> None:
        if t < self.t0 or level < self._threshold:
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


def resolve_answer(bursts: list[Burst], first_sentence_ms: float | None, skew_ms: float | None, slack_ms: float = ANSWER_SLACK_MS) -> tuple[float | None, str | None]:
    if first_sentence_ms is None:
        return None, "the brain stored no first-sentence time for this turn"
    if skew_ms is None:
        return None, "no wall-clock t0 or stored creation time to place the brain's clock against t0"
    low, high = SKEW_PLAUSIBLE_MS
    if not low <= skew_ms <= high:
        return None, f"implausible skew between t0 and the brain's heard-at time ({skew_ms:.0f} ms): clocks disagree"
    floor = max(0.0, skew_ms + first_sentence_ms - slack_ms)
    for burst in bursts:
        if burst.end_ms <= floor:
            continue  # a filler: it ended before any answer could exist
        if burst.start_ms >= floor:
            return burst.start_ms, None
        return None, "filler and answer audio are contiguous; the start of the answer cannot be separated"
    return None, "no agent audio at or after the brain's first sentence"


def estimate_heard_ms(stored: dict) -> float | None:
    """Epoch ms when the worker heard the caller finish: row creation minus transcriptMs."""
    created = stored.get("createdMs")
    if created is None:
        return None
    return created - ((stored.get("timings") or {}).get("transcriptMs") or 0)


def match_rows(t0_walls: list[float | None], stored: list[dict]) -> tuple[list[dict | None], list[int], int]:
    """Assign stored voice rows to caller turns by time window.

    Returns (row per turn or None, extra rows per turn, rows that fit no window).
    The last completed row in a window wins; rows carry `heardEstMs` afterwards.
    """
    buckets: list[list[dict]] = [[] for _ in t0_walls]
    stray = 0
    for row in stored:
        heard = estimate_heard_ms(row)
        placed = False
        if heard is not None:
            for i, start in enumerate(t0_walls):
                if start is None:
                    continue
                nxt = next((x for x in t0_walls[i + 1 :] if x is not None), math.inf)
                if start - WINDOW_TOLERANCE_MS <= heard < nxt - WINDOW_TOLERANCE_MS:
                    buckets[i].append({**row, "heardEstMs": heard})
                    placed = True
                    break
        stray += 0 if placed else 1
    chosen: list[dict | None] = []
    extra: list[int] = []
    for bucket in buckets:
        done = [r for r in bucket if r.get("state") == "completed"]
        pick = (done or bucket or [None])[-1]
        chosen.append(pick)
        extra.append(max(0, len(bucket) - 1))
    return chosen, extra, stray


# --- the caller's side: paced frames ---------------------------------------------

class Pump:
    """Sends 20 ms frames in real time: queued speech first, silence otherwise."""

    def __init__(self, push: Callable[[bytes], Awaitable[None]], clock, sample_rate: int, wall_ms: Callable[[], float] = lambda: time.time() * 1000):
        self._push, self._clock, self._wall = push, clock, wall_ms
        self.t0_wall_ms: float | None = None  # wall clock at the instant t0 was taken
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
        if not self._speech:
            self.t0_wall_ms = self._wall()
            future.set_result(self._clock.now())
        else:
            self._waiting = (len(self._speech), future)
        return future

    def stop(self) -> None:
        self._stop = True

    async def run(self) -> None:
        next_at = self._clock.now()
        while not self._stop:
            frame = self._speech.popleft() if self._speech else self._silence
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


def _goal(target: float, value: float | None, ok: bool | None, reason: str | None = None) -> dict:
    out = {"targetMs": target, "valueMs": value, "pass": ok}
    if ok is None:
        out["notDecided"] = reason or "not enough measured turns"
    return out


def _group_goal(target: float, rows: list[dict], key: str) -> dict:
    """A median goal. True only when every turn of the group has a value."""
    values = [r[key] for r in rows if r.get(key) is not None]
    mid = median(values)
    if mid is None:
        return _goal(target, None, None, f"none of {len(rows)} turns has an answer start")
    if mid > target:
        return _goal(target, mid, False)  # the measured turns already miss
    if len(values) < len(rows):
        return _goal(target, mid, None, f"{len(rows) - len(values)} of {len(rows)} turns have no answer start, so the median may be understated")
    return _goal(target, mid, True)


def summarize(rows: list[dict], expected_turns: int = 20, end_silence_s: float = END_SILENCE_S) -> dict:
    """Per-turn rows to a summary. A row is a dict as built by `replay.build_row`."""
    plain = [r for r in rows if r["expectTool"] is None]
    tool = [r for r in rows if r["expectTool"] is not None]
    got = lambda rs, k: [r[k] for r in rs if r.get(k) is not None]
    timeouts = [r for r in rows if r["timedOut"]]
    first_all = got(rows, "firstSoundMs")
    gaps = got(rows, "longestSilentGapMs")
    complete = len(rows) == expected_turns
    first_ok = None if not complete else (not timeouts and len(first_all) == expected_turns and max(first_all) <= GOAL_FIRST_SOUND_MS)
    top_gap = max(gaps) if gaps else None
    if end_silence_s <= GOAL_MAX_SILENCE_MS / 1000:
        silence = _goal(GOAL_MAX_SILENCE_MS, top_gap, None, f"a turn ends after {end_silence_s:g} s of quiet, so a longer gap cannot be seen; run with --end-silence above 3")
    elif timeouts:
        silence = _goal(GOAL_MAX_SILENCE_MS, top_gap, False)
    elif not gaps or not complete:
        silence = _goal(GOAL_MAX_SILENCE_MS, top_gap, None, "not every turn was run")
    else:
        silence = _goal(GOAL_MAX_SILENCE_MS, top_gap, top_gap <= GOAL_MAX_SILENCE_MS)
    return {
        "turnsPlanned": expected_turns,
        "turnsRun": len(rows),
        "endSilenceS": end_silence_s,
        "timeouts": len(timeouts),
        "refusedVoiceRequests": {
            "value": None,
            "notMeasured": "the worker keeps refusals only in memory (voiceRefused) and logs nothing about them, so they cannot be observed from outside; see suspectedDroppedAnswerTurns",
        },
        "suspectedDroppedAnswerTurns": [r["id"] for r in rows if r.get("suspectDropped")],
        "fastLaneTurns": sum(1 for r in rows if r.get("fastServed")),
        "turnsWithStoredRow": sum(1 for r in rows if r.get("brain") is not None),
        "extraStoredRows": sum(r.get("extraStoredRows") or 0 for r in rows),
        "firstSoundMs": {"all": spread(first_all), "plain": spread(got(plain, "firstSoundMs")), "tool": spread(got(tool, "firstSoundMs"))},
        "answerMs": {"plain": spread(got(plain, "answerMs")), "tool": spread(got(tool, "answerMs"))},
        "longestSilentGapMs": top_gap,
        "goals": {
            "firstSoundWithin1500OnEveryTurn": _goal(GOAL_FIRST_SOUND_MS, max(first_all) if first_all else None, first_ok),
            "plainAnswerMedianWithin2500": _group_goal(GOAL_PLAIN_ANSWER_MS, plain, "answerMs"),
            "toolAnswerMedianWithin4000": _group_goal(GOAL_TOOL_ANSWER_MS, tool, "answerMs"),
            "noSilenceOver3000": silence,
        },
        "answerNotMeasuredTurns": [r["id"] for r in rows if r.get("answerMs") is None],
        "possiblyTruncatedTurns": [r["id"] for r in rows if r.get("possiblyTruncated")],
    }


def _cell(value, width: int) -> str:
    text = "-" if value is None else (f"{value:.0f}" if isinstance(value, float) else str(value))
    return text.rjust(width)


def render_table(rows: list[dict], summary: dict) -> str:
    head = f"{'id':<4} {'call':>4} {'lang':<8} {'kind':<8} {'first':>6} {'answer':>6} {'brain1':>6} {'gap':>6}  note"
    lines = [head, "-" * len(head)]
    for r in rows:
        brain = (r.get("brain") or {}).get("firstSentenceMs")
        notes = []
        if r["timedOut"]:
            notes.append("timeout")
        if r.get("fastServed"):
            notes.append("fast")
        if r.get("possiblyTruncated"):
            notes.append("maybe-cut")
        if r.get("expectedToolUsed") is False:
            notes.append(f"no {r['expectTool']}")
        lines.append(
            f"{r['id']:<4} {r['call']:>4} {r['language']:<8} {r['kind']:<8} "
            f"{_cell(r.get('firstSoundMs'), 6)} {_cell(r.get('answerMs'), 6)} {_cell(brain, 6)} {_cell(r.get('longestSilentGapMs'), 6)}  {' '.join(notes)}"
        )
    s = summary
    f, a = s["firstSoundMs"], s["answerMs"]
    fmt = lambda x: "-" if x is None else f"{x:.0f}"
    lines += [
        "",
        f"first sound ms  all: median {fmt(f['all']['median'])} p90 {fmt(f['all']['p90'])} max {fmt(f['all']['max'])}",
        f"answer ms     plain: median {fmt(a['plain']['median'])} p90 {fmt(a['plain']['p90'])} (n={a['plain']['n']})",
        f"answer ms      tool: median {fmt(a['tool']['median'])} p90 {fmt(a['tool']['p90'])} (n={a['tool']['n']})",
        f"longest silent gap ms: {fmt(s['longestSilentGapMs'])}; timeouts {s['timeouts']}; fast lane {s['fastLaneTurns']}; turns run {s['turnsRun']}/{s['turnsPlanned']}",
        f"refused voice requests: not observable; suspected dropped answers: {', '.join(s['suspectedDroppedAnswerTurns']) or 'none'}",
    ]
    for name, g in s["goals"].items():
        verdict = "not measurable" if g["pass"] is None else ("PASS" if g["pass"] else "MISS")
        why = f" - {g['notDecided']}" if g.get("notDecided") else ""
        lines.append(f"goal {name}: {verdict} (target {g['targetMs']:.0f}, value {fmt(g['valueMs'])}){why}")
    lines.append("answer ms = first agent burst at/after the brain's first sentence; see 'definitions' in the output file")
    return "\n".join(lines)
