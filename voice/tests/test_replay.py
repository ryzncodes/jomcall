import asyncio
import json
import struct
from pathlib import Path

import pytest

from fake_http import FakeServer, Reply
from jomcall_voice import config, voice_out
from test_voice_out import sse
from tools import replay_core as core
from tools.replay import attach, build_row

SCRIPT = Path(__file__).resolve().parent.parent / "tools" / "script.json"


class FakeClock:
    def __init__(self):
        self.t = 100.0
        self.sleeps: list[float] = []

    def now(self):
        return self.t

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.t += seconds
        await asyncio.sleep(0)


def pcm(level: int, samples: int) -> bytes:
    return struct.pack(f"<{samples}h", *([level] * samples))


# --- script ---------------------------------------------------------------------------

def test_shipped_script_is_valid_and_has_the_design_mix():
    turns = core.load_script(SCRIPT)
    assert len(turns) == 20
    langs = [t["language"] for t in turns]
    kinds = [t["kind"] for t in turns]
    assert (langs.count("ms"), langs.count("manglish"), langs.count("en")) == (8, 8, 4)
    assert [kinds.count(k) for k in ("plain", "booking", "message", "handoff")] == [12, 4, 2, 2]


def test_validation_rejects_wrong_counts_and_bad_fields():
    turns = json.loads(SCRIPT.read_text())["turns"]
    with pytest.raises(core.ScriptError, match="expected 20"):
        core.validate_script(turns[:19])
    swapped = json.loads(json.dumps(turns))
    swapped[0]["language"] = "en"  # 7 BM, 5 English
    with pytest.raises(core.ScriptError, match="language"):
        core.validate_script(swapped)
    wrong_tool = json.loads(json.dumps(turns))
    next(t for t in wrong_tool if t["kind"] == "plain")["expectTool"] = "book_slot"
    with pytest.raises(core.ScriptError, match="expectTool"):
        core.validate_script(wrong_tool)
    dup = json.loads(json.dumps(turns))
    dup[1]["id"] = dup[0]["id"]
    with pytest.raises(core.ScriptError, match="duplicate"):
        core.validate_script(dup)
    extra = json.loads(json.dumps(turns))
    extra[0]["note"] = "x"
    with pytest.raises(core.ScriptError, match="fields"):
        core.validate_script(extra)


def test_split_of_twenty_turns_is_balanced_and_complete():
    assert core.plan_calls(20, 7) == [7, 7, 6]
    assert core.plan_calls(20, 20) == [20]
    assert core.plan_calls(20, 1) == [1] * 20
    assert sum(core.plan_calls(13, 7)) == 13 and core.plan_calls(0, 7) == []
    assert all(x <= 7 for x in core.plan_calls(20, 7))


# --- energy ----------------------------------------------------------------------------

def test_rms_and_silence_trim():
    assert core.rms(pcm(0, 480)) == 0.0
    assert core.rms(pcm(1000, 480)) == pytest.approx(1000)
    assert core.rms(b"") == 0.0
    block = 480  # 20 ms at 24 kHz
    audio = pcm(0, block * 3) + pcm(2000, block * 2) + pcm(0, block * 4) + pcm(2000, block) + pcm(0, block * 5)
    trimmed = core.trim_silence(audio, 24_000)
    assert len(trimmed) == block * 2 * 7  # from first to last loud block, inner silence kept
    assert core.trim_silence(pcm(0, block * 4), 24_000) == b""


# --- bursts, first sound, silent gap -------------------------------------------------------

def feed(tracker, spans, step=0.02, level=2000.0):
    """spans: (start_s, end_s) of sound relative to t0."""
    for a, b in spans:
        t = a
        while t < b - 1e-9:
            tracker.feed(tracker.t0 + t, level, step)
            t += step


def test_first_sound_and_longest_gap_from_a_synthetic_timeline():
    tr = core.TurnTracker(10.0)
    feed(tr, [(0.9, 1.4), (1.5, 2.0), (4.2, 5.0)])  # filler, answer after a 2.2 s gap
    tr.feed(10.0 + 0.1, 5.0, 0.02)  # a click below the minimum burst length
    result = tr.result(10.0 + 6.5, "quiet")
    assert result.first_sound_ms == pytest.approx(900)
    assert [round(b.start_ms) for b in result.bursts] == [900, 4200]  # 1.4 -> 1.5 merges
    assert result.longest_silent_gap_ms == pytest.approx(2200)


def test_waiting_for_the_first_sound_counts_as_a_gap():
    tr = core.TurnTracker(0.0)
    feed(tr, [(3.5, 4.0)])
    r = tr.result(5.5, "quiet")
    assert r.first_sound_ms == pytest.approx(3500) and r.longest_silent_gap_ms == pytest.approx(3500)


def test_digital_silence_and_frames_before_t0_are_not_sound():
    tr = core.TurnTracker(5.0)
    feed(tr, [(0.5, 1.0)], level=3.0)  # codec noise
    tr.feed(4.0, 4000.0, 0.02)  # arrived before t0
    assert tr.bursts() == [] and tr.result(6.0, "timeout").first_sound_ms is None


def test_turn_end_rules():
    tr = core.TurnTracker(0.0, end_silence_s=1.5, timeout_s=15.0)
    assert tr.status(14.9) is None
    assert tr.status(15.0) == "timeout"
    feed(tr, [(1.0, 2.0)])
    assert tr.status(3.4) is None  # 1.4 s of quiet
    assert tr.status(3.51) == "quiet"
    t = core.TurnTracker(0.0)
    assert t.result(15.0, "timeout").longest_silent_gap_ms is None


async def test_listen_ends_a_turn_with_real_queue_and_clock_scaled_down():
    class Real:
        def now(self):
            return asyncio.get_running_loop().time()

    clock, q = Real(), asyncio.Queue()
    t0 = clock.now()
    tr = core.TurnTracker(t0, end_silence_s=0.15, timeout_s=0.5)
    for i in range(5):
        q.put_nowait((t0 + 0.05 + i * 0.02, 3000.0, 0.02))
    assert await core.listen(q, clock, tr) == "quiet"
    tr2 = core.TurnTracker(clock.now(), end_silence_s=0.15, timeout_s=0.2)
    assert await core.listen(asyncio.Queue(), clock, tr2) == "timeout"


# --- answer versus filler ----------------------------------------------------------------------

B = core.Burst


def test_answer_is_the_first_burst_at_or_after_skew_plus_brain_first_sentence():
    bursts = [B(600, 1000), B(2600, 3600)]  # a filler, then the answer
    assert core.resolve_answer(bursts, 2000, 0) == (2600, None)
    assert core.resolve_answer([B(2600, 3600)], 2000, 0) == (2600, None)  # no filler at all


def test_neutral_ack_at_heard_at_plus_800_is_not_taken_for_the_answer():
    # The worker heard the caller finish 500 ms after t0; the brain's first sentence
    # came 1400 ms after that. The neutral ack plays at about heardAt + 800.
    skew, first_sentence = 500, 1400
    ack = B(skew + 800, skew + 1200)  # 1300..1700 after t0, before the answer exists
    answer = B(skew + first_sentence + 400, skew + first_sentence + 2000)  # 2300.. after TTS
    assert core.resolve_answer([ack, answer], first_sentence, skew) == (2300, None)
    # With the brain's clock wrongly taken as t0 the floor (1350) falls inside the ack
    # and the answer start is lost rather than misreported.
    assert core.resolve_answer([ack, answer], first_sentence, 0)[0] != 2300


def test_contiguous_filler_and_answer_is_not_guessed():
    value, why = core.resolve_answer([B(600, 3500)], 2000, 0)
    assert value is None and "contiguous" in why


def test_answer_missing_without_brain_time_skew_or_audio():
    assert core.resolve_answer([B(100, 500)], None, 0)[0] is None
    assert "wall-clock" in core.resolve_answer([B(100, 500)], 2000, None)[1]
    value, why = core.resolve_answer([B(100, 500)], 2000, 0)
    assert value is None and "no agent audio" in why


def test_implausible_clock_skew_gives_no_answer_time():
    for skew in (-1000, 5000):
        value, why = core.resolve_answer([B(6000, 7000)], 1000, skew)
        assert value is None and "implausible" in why


def test_stored_rows_are_matched_to_turns_by_time_window():
    walls = [1_000_000.0, 1_020_000.0, 1_040_000.0]

    def stored(heard, state="completed", transcript=400):
        return {"createdMs": heard + transcript, "timings": {"transcriptMs": transcript}, "state": state, "tag": heard}

    rows = [
        stored(1_000_500),
        stored(1_001_000, state="failed"),  # an extra row in window 0 (two finals)
        stored(1_020_600),
        stored(1_039_600),  # window 1 reaches 300 ms before the next t0
        stored(1_039_900),  # past that: it belongs to turn 2 (heard a little before its t0)
        stored(900_000),  # before everything
    ]
    chosen, extra, stray = core.match_rows(walls, rows)
    assert chosen[0]["tag"] == 1_000_500 and extra[0] == 1  # last COMPLETED row wins
    assert chosen[1]["tag"] == 1_039_600 and extra[1] == 1  # window 1 is [t0-300, next t0-300)
    assert chosen[2]["tag"] == 1_039_900 and extra[2] == 0 and stray == 1
    assert chosen[0]["heardEstMs"] == 1_000_500
    assert core.match_rows([None, 5.0], [stored(5.0)])[0][0] is None  # a turn that never got a t0


# --- numbers --------------------------------------------------------------------------------

def test_median_and_nearest_rank_percentile():
    assert core.median([]) is None and core.median([3, 1, 2]) == 2 and core.median([4, 1, 2, 3]) == 2.5
    assert core.percentile(list(range(1, 11)), 0.9) == 9
    assert core.percentile([5.0], 0.9) == 5.0 and core.percentile([], 0.9) is None
    assert core.percentile(list(range(1, 13)), 0.9) == 11  # ceil(10.8) = 11th of 12


def row(i, expect, first, answer, gap=500.0, timed_out=False, fast=False):
    return {
        "id": f"t{i:02d}", "call": 1, "language": "en", "kind": "plain" if expect is None else "booking",
        "expectTool": expect, "firstSoundMs": first, "answerMs": answer, "longestSilentGapMs": gap,
        "timedOut": timed_out, "fastServed": fast, "brain": {"firstSentenceMs": 1000}, "possiblyTruncated": False,
        "expectedToolUsed": None if expect is None else True, "suspectDropped": False, "extraStoredRows": 0,
    }


def passing_rows():
    return [row(i, None, 900.0, 1800.0) for i in range(12)] + [row(12 + i, "book_slot", 1000.0, 3000.0) for i in range(8)]


def test_summary_passes_when_all_goals_met():
    s = core.summarize(passing_rows(), end_silence_s=3.5)
    assert all(g["pass"] is True for g in s["goals"].values())
    assert s["answerMs"]["plain"]["median"] == 1800 and s["answerMs"]["tool"]["n"] == 8
    assert s["timeouts"] == 0 and s["turnsRun"] == 20 and s["longestSilentGapMs"] == 500
    assert s["refusedVoiceRequests"]["value"] is None and s["refusedVoiceRequests"]["notMeasured"]


def test_silence_goal_cannot_pass_while_a_turn_ends_after_three_seconds_or_less():
    g = core.summarize(passing_rows(), end_silence_s=1.5)["goals"]["noSilenceOver3000"]
    assert g["pass"] is None and "--end-silence" in g["reason"]
    assert core.summarize(passing_rows(), end_silence_s=3.0)["goals"]["noSilenceOver3000"]["pass"] is None
    assert core.END_SILENCE_S == 3.5


def test_clean_run_gives_true_and_false_verdicts():
    rows = passing_rows()
    rows[0]["firstSoundMs"] = 1600.0
    for r in rows[:12]:
        r["answerMs"] = 2700.0
    for r in rows[12:]:
        r["answerMs"] = 4100.0
    rows[5]["longestSilentGapMs"] = 3200.0
    s = core.summarize(rows, end_silence_s=3.5)
    assert [g["pass"] for g in s["goals"].values()] == [False, False, False, False]


def test_one_timeout_makes_goal_one_false_and_goals_two_three_unmeasured():
    rows = passing_rows()
    rows[3].update(firstSoundMs=None, answerMs=None, longestSilentGapMs=None, timedOut=True)
    rows[14].update(firstSoundMs=None, answerMs=None, longestSilentGapMs=None, timedOut=True)
    s = core.summarize(rows, end_silence_s=3.5)
    g = s["goals"]
    assert g["firstSoundWithin1500OnEveryTurn"]["pass"] is False
    assert g["plainAnswerMedianWithin2500"]["pass"] is None and "1 of 12" in g["plainAnswerMedianWithin2500"]["reason"]
    assert g["toolAnswerMedianWithin4000"]["pass"] is None and g["toolAnswerMedianWithin4000"]["partial"]["n"] == 7
    assert g["noSilenceOver3000"]["pass"] is None
    assert s["timedOutTurns"] == ["t03", "t14"] and s["answerNotMeasuredTurns"] == ["t03", "t14"]


def test_truncated_turn_and_the_contaminated_next_turn_are_excluded_and_goals_are_null():
    rows = passing_rows()
    rows[12]["truncated"] = True  # the late answer of t12 ...
    rows[13]["contaminated"] = True
    rows[13]["firstSoundMs"] = 40.0  # ... shows up as a tiny first sound of t13
    s = core.summarize(rows, end_silence_s=3.5)
    assert s["truncatedTurns"] == ["t12"] and s["contaminatedTurns"] == ["t13"]
    assert s["firstSoundMs"]["all"]["n"] == 18 and s["firstSoundMs"]["all"]["max"] == 1000.0
    assert s["answerMs"]["tool"]["n"] == 6
    for name in ("firstSoundWithin1500OnEveryTurn", "toolAnswerMedianWithin4000", "noSilenceOver3000"):
        g = s["goals"][name]
        assert g["pass"] is None and "truncated" in g["reason"], name
    assert s["goals"]["toolAnswerMedianWithin4000"]["partial"] == {"n": 6, "of": 8, "value": 3000.0}
    assert s["goals"]["plainAnswerMedianWithin2500"]["pass"] is True  # plain group is fully clean


def test_dropped_answers_also_block_a_verdict():
    rows = passing_rows()
    rows[2]["suspectDropped"] = True
    assert core.summarize(rows, end_silence_s=3.5)["goals"]["firstSoundWithin1500OnEveryTurn"]["pass"] is None


def test_summary_of_a_partial_run_is_not_a_pass():
    s = core.summarize(passing_rows()[:7], end_silence_s=3.5)
    assert all(g["pass"] is None for g in s["goals"].values())
    assert s["turnsRun"] == 7 and s["turnsPlanned"] == 20


def test_table_has_no_text_of_turns_and_names_goals():
    rows = passing_rows()
    rows[2]["fastServed"] = True
    rows[3]["suspectDropped"] = True
    text = core.render_table(rows, core.summarize(rows, end_silence_s=3.5))
    assert "fast" in text and "PASS" in text and "not observable" in text and "t03" in text
    assert text.count("\n") > 20


# --- rows from stored turns --------------------------------------------------------------------

def timing(first=900.0, bursts=None, window=6000.0, ended="quiet", gap=900.0, wall=1_000_000.0):
    return core.TurnTiming(first, bursts if bursts is not None else [B(900, 1400), B(2600, 4000)], gap, ended, window, wall)


TURN = {"id": "t12", "language": "en", "kind": "booking", "text": "x", "expectTool": "book_slot"}


def stored(heard=1_000_300, **over):
    base = {"channel": "voice", "state": "completed", "errorCode": None, "answerChars": 120,
            "createdMs": heard + 500, "timings": {"transcriptMs": 500, "firstSentenceMs": 2000, "totalMs": 3500},
            "tools": ["check_availability", "book_slot"], "proposals": ["booking"]}
    base.update(over)
    return base


def test_row_combines_client_and_stored_evidence_and_keeps_no_text():
    chosen, extra, _ = core.match_rows([1_000_000.0], [stored()])
    r = build_row(TURN, 2, timing(), chosen[0], None, extra[0])
    # heard 300 ms after t0, first sentence 2000 ms later: the 900 filler is skipped, the 2600 burst is the answer
    assert r["skewMs"] == 300 and r["firstSoundMs"] == 900 and r["answerMs"] == 2600
    assert r["brain"]["firstSentenceMs"] == 2000 and r["expectedToolUsed"] is True and r["fastServed"] is False
    assert r["answerChars"] == 120 and r["proposals"] == ["booking"] and r["readBackBeforeProposal"] is None
    assert "readBackBeforeProposal" in r["notMeasured"] and r["suspectDropped"] is False
    assert "text" not in r and "answer" not in r and "input" not in r


def test_row_without_stored_turn_says_why():
    r = build_row(TURN, 1, timing(), None, "no stored voice turn in this turn's window")
    assert r["brain"] is None and r["answerMs"] is None and r["expectedToolUsed"] is None
    assert "window" in r["notMeasured"]["brain"] and "answerMs" in r["notMeasured"]


def test_row_for_timeout_truncation_and_dropped_answer():
    chosen = core.match_rows([1_000_000.0], [stored()])[0][0]
    r = build_row(TURN, 1, timing(first=None, bursts=[], gap=None, ended="timeout", window=15000.0), chosen, None)
    assert r["timedOut"] and r["firstSoundMs"] is None and "firstSoundMs" in r["notMeasured"]
    assert r["suspectDropped"] is True  # the brain finished a turn nobody heard
    cut = build_row(TURN, 1, timing(window=2500.0), chosen, None)
    assert cut["truncated"] is True  # the brain finished after listening stopped
    quiet_after = build_row(TURN, 1, timing(bursts=[B(900, 1400)]), chosen, None)
    assert quiet_after["answerMs"] is None and quiet_after["suspectDropped"] is True


def test_attach_matches_by_window_ignores_text_rows_and_flags_fast_lane():
    sent = [(TURN, timing(wall=1_000_000.0)), (TURN, timing(wall=1_020_000.0))]
    fast = stored(1_020_300, timings={"transcriptMs": 500, "firstSentenceMs": 100, "totalMs": 200, "fastLane": True})
    ok = attach(sent, [stored(), fast, stored(1_000_350, channel="text")], 1)
    assert [r["fastServed"] for r in ok] == [False, True] and [r["extraStoredRows"] for r in ok] == [0, 0]
    split = attach(sent, [stored(1_000_300), stored(1_001_100), fast], 1)  # two finals in turn 0
    assert split[0]["extraStoredRows"] == 1 and split[0]["brain"] is not None and split[1]["fastServed"] is True
    missing = attach(sent, [stored()], 1)
    assert missing[1]["brain"] is None and "window" in missing[1]["notMeasured"]["brain"]


# --- pacing of the caller's audio -----------------------------------------------------------------

async def test_pump_sends_speech_in_real_time_then_silence_and_reports_t0():
    clock, sent = FakeClock(), []

    async def push(data):
        sent.append((clock.now(), data))

    pump = core.Pump(push, clock, 24_000, wall_ms=lambda: 5_000_000 + clock.now() * 1000)
    task = asyncio.ensure_future(pump.run())
    await asyncio.sleep(0)
    speech = pcm(1000, 480 * 2 + 100)  # 2 full frames and a partial one
    started = clock.now()
    t0 = await pump.say(speech)
    # three speech frames, the last padded; t0 is when the last one was sent
    assert t0 == pytest.approx(started + 0.04, abs=0.021)
    assert pump.t0_wall_ms == pytest.approx(5_000_000 + t0 * 1000)  # wall and monotonic taken together
    while pump.frames_sent < 12:
        await asyncio.sleep(0)
    pump.stop()
    await task
    frames = [d for _, d in sent]
    assert all(len(d) == 960 for d in frames)
    loud = [i for i, d in enumerate(frames) if core.rms(d) > 0]
    assert len(loud) == 3 and loud == list(range(loud[0], loud[0] + 3))
    assert core.rms(frames[loud[-1]]) < 1000  # padded tail
    gaps = [round(b - a, 3) for (a, _), (b, _) in zip(sent, sent[1:])]
    assert all(g == pytest.approx(0.02, abs=0.005) for g in gaps)  # paced at 20 ms
    assert any(core.rms(d) == 0 for d in frames[loud[-1] + 1 :])  # silence keeps flowing


async def test_pump_with_empty_speech_resolves_immediately():
    clock = FakeClock()
    pump = core.Pump(lambda d: asyncio.sleep(0), clock, 24_000)
    assert await pump.say(b"") == clock.now()


# --- rate-limited, resumable synthesis ---------------------------------------------------------------

def voice(server, tmp_path):
    return voice_out.Voice("Puck", api_key="k", url=server.url + "/tts", cache_dir=tmp_path)


async def test_prepare_is_rate_limited_resumable_and_stops_on_429(tmp_path):
    texts = [f"line {i}" for i in range(6)]
    count = 0

    async def handler(req):
        nonlocal count
        count += 1
        if count == 4:
            return Reply(status=429, chunks=[b"{}"])
        return Reply(chunks=sse(b"\x01\x00"))

    out, clock = [], FakeClock()
    async with FakeServer(handler) as server:
        first = await core.prepare(voice(server, tmp_path), clock, texts, config.PREWARM_MAX_PER_MIN,
                                   voice_out.VoiceRefused, voice_out.VoiceError, say=out.append)
        assert (first.synthesized, first.remaining, first.refused) == (3, 3, True)
        assert len(server.requests) == 4  # no retry after the refusal
        assert min(clock.sleeps) >= 60 / config.PREWARM_MAX_PER_MIN and len(clock.sleeps) == 3  # a wait before each request after the first
        assert any("3 lines remain" in m for m in out)
        before = len(server.requests)
        second = await core.prepare(voice(server, tmp_path), FakeClock(), texts, config.PREWARM_MAX_PER_MIN,
                                    voice_out.VoiceRefused, voice_out.VoiceError, say=lambda _: None)
        assert (second.skipped, second.synthesized, second.remaining) == (3, 3, 0)
        assert len(server.requests) - before == 3


def test_attach_marks_the_turn_after_a_truncated_one_contaminated():
    sent = [(TURN, timing(window=2500.0, wall=1_000_000.0)), (TURN, timing(wall=1_020_000.0)), (TURN, timing(wall=1_040_000.0))]
    rows = attach(sent, [stored(1_000_300), stored(1_020_300), stored(1_040_300)], 1)
    assert [r["truncated"] for r in rows] == [True, False, False]
    assert [r["contaminated"] for r in rows] == [False, True, False]


def test_rms_of_an_int16_memoryview_equals_rms_of_the_same_bytes():
    data = struct.pack("<6h", 100, -200, 300, -400, 500, -600)
    view = memoryview(bytearray(data)).cast("h")
    assert len(view) == 6 and core.rms(view) == core.rms(data) > 0
    assert core.rms(memoryview(data)) == core.rms(data)


def test_ceiling_ends_a_turn_that_never_goes_quiet():
    tr = core.TurnTracker(0.0, end_silence_s=3.5, ceiling_s=20.0)
    feed(tr, [(1.0, 19.9)])
    assert tr.status(19.0) is None and tr.status(20.0) == "ceiling"


async def test_pump_say_wait_fails_clearly_when_frames_never_go_out():
    async def stuck(data):
        await asyncio.sleep(10)

    pump = core.Pump(stuck, FakeClock(), 24_000)
    task = asyncio.ensure_future(pump.run())
    await asyncio.sleep(0)
    with pytest.raises(core.PumpStalled, match="not sent within"):
        await pump.say_wait(pcm(1000, 480), timeout_s=0.05)
    pump.stop()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
