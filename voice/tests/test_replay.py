import asyncio
import json
import struct
from pathlib import Path

import pytest

from fake_http import FakeServer, Reply
from jomcall_voice import config, voice_out
from test_voice_out import sse
from tools import replay_core as core
from tools.replay import attach

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


# --- numbers --------------------------------------------------------------------------------

def test_median_and_nearest_rank_percentile():
    assert core.median([]) is None and core.median([3, 1, 2]) == 2 and core.median([4, 1, 2, 3]) == 2.5
    assert core.percentile(list(range(1, 11)), 0.9) == 9
    assert core.percentile([5.0], 0.9) == 5.0 and core.percentile([], 0.9) is None
    assert core.percentile(list(range(1, 13)), 0.9) == 11  # ceil(10.8) = 11th of 12


# --- rows from stored turns --------------------------------------------------------------------

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


# --- answer versus filler ---------------------------------------------------------------------

B = core.Burst


def test_answer_is_the_first_burst_at_or_after_the_expected_time_minus_slack():
    assert core.resolve_answer([B(600, 1000), B(2600, 3600)], 2000) == (2600, None)
    assert core.resolve_answer([B(2600, 3600)], 2000) == (2600, None)  # no filler at all
    assert core.resolve_answer([B(100, 500)], None)[0] is None


def test_a_filler_that_runs_a_little_past_the_expected_time_is_still_a_filler():
    # expected 2517, floor 2417: the filler ends at 2464, the answer starts at 2985
    assert core.resolve_answer([B(2114, 2464), B(2985, 5404)], 2517) == (2985, None)
    value, why = core.resolve_answer([B(600, 3500)], 2000)  # far past: contiguous
    assert value is None and "contiguous" in why
    assert "no agent audio" in core.resolve_answer([B(100, 500)], 2000)[1]


def test_neutral_ack_before_the_synthesis_allowance_is_not_taken_for_the_answer():
    skew, first_sentence = 500, 1400
    expected = skew + first_sentence + core.ANSWER_FLOOR_MS  # 2450
    ack = B(skew + 800, skew + 1200)
    answer = B(skew + first_sentence + 900, skew + first_sentence + 3000)  # 2800: a ~900 ms sentence-to-audio lag
    assert core.resolve_answer([ack, answer], expected) == (2800, None)
    # A burst starting inside the synthesis allowance (the old, too early floor) is still a filler:
    early = B(skew + first_sentence + 100, skew + first_sentence + 400)
    assert core.resolve_answer([early, answer], expected) == (2800, None)


def test_stored_rows_are_matched_by_caller_speech_window():
    windows = [(1_000_000.0, 1_006_000.0), (1_020_000.0, 1_026_000.0), None]

    def stored(heard, state="completed", transcript=400):
        return {"createdMs": heard + transcript, "timings": {"transcriptMs": transcript}, "state": state, "tag": heard}

    rows = [
        stored(1_002_500),  # finalised in the middle of the utterance: inside the window
        stored(1_004_000, state="failed"),  # a second final in the same window
        stored(1_025_900),  # up to 2 s after the speech ends
        stored(999_000),  # before everything
    ]
    chosen, extra, stray = core.match_rows(windows, rows)
    assert chosen[0]["tag"] == 1_002_500 and extra[0] == 1  # last COMPLETED row wins
    assert chosen[1]["tag"] == 1_025_900 and extra[1] == 0
    assert chosen[2] is None and stray == 1
    assert chosen[0]["heardEstMs"] == 1_002_500


async def test_wait_quiet_waits_for_the_agent_and_reports_a_hit_ceiling():
    class Real:
        def now(self):
            return asyncio.get_running_loop().time()

    clock, q = Real(), asyncio.Queue()
    assert await core.wait_quiet(q, clock, quiet_s=0.1, last_sound_t=None) is True
    t = clock.now()
    q.put_nowait((t, 3000.0, 0.02))
    started = clock.now()
    assert await core.wait_quiet(q, clock, quiet_s=0.1, ceiling_s=1.0, last_sound_t=t) is True
    assert clock.now() - started >= 0.09

    async def keep_talking():
        while True:
            q.put_nowait((clock.now(), 3000.0, 0.02))
            await asyncio.sleep(0.02)

    task = asyncio.ensure_future(keep_talking())
    assert await core.wait_quiet(q, clock, quiet_s=0.1, ceiling_s=0.3, last_sound_t=clock.now()) is False
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


def test_agent_audio_just_before_t0_marks_the_turn_contaminated():
    tr = core.TurnTracker(10.0)
    tr.feed(9.9, 3000.0, 0.02)  # 100 ms before t0
    tr.feed(10.9, 3000.0, 0.5)
    assert tr.result(14.0, "quiet").pre_sound is True
    early = core.TurnTracker(10.0)
    early.feed(9.0, 3000.0, 0.02)  # a second before: not contaminated
    assert early.result(14.0, "quiet").pre_sound is False


# --- numbers --------------------------------------------------------------------------------

def timing(first=2000.0, bursts=None, window=12000.0, ended="quiet", wall=1_000_000.0, pre=False, start=995_000.0):
    bursts = [B(2000, 2400), B(3200, 6000)] if bursts is None else bursts
    gap = max((g for _, g in core.gaps_of(bursts)), default=None)
    return core.TurnTiming(first, bursts, gap, ended, window, wall, start, pre)


def turn(kind="plain", tool=None, text="x" * 40, tid="t01"):
    return {"id": tid, "language": "en", "kind": kind, "text": text, "expectTool": tool}


def stored(heard=1_000_300, **over):
    base = {"channel": "voice", "state": "completed", "errorCode": None, "answerChars": 120, "inputChars": 40,
            "createdMs": heard + 500, "clientTurnId": "c1",
            "timings": {"transcriptMs": 500, "firstSentenceMs": 1500, "totalMs": 3000}, "tools": [], "proposals": []}
    base.update(over)
    return base


def scored(t=None, tm=None, st="default", **kw):
    st = stored() if st == "default" else st
    row = None if st is None else {**st, "heardEstMs": core.estimate_heard_ms(st)}
    return core.score_turn(t or turn(), 1, tm or timing(), row, "no stored voice turn matched", **kw)


def test_row_flags_answer_from_the_estimate_and_keeps_no_text():
    r = scored()
    # heard 300 ms after t0, first sentence 1500 later, +550: the 2000 filler is skipped, 3200 is the answer
    assert r["skewMs"] == 300 and r["answerExpectedMs"] == 2350 and r["answerMs"] == 3200 and r["answerSource"] == "estimate"
    assert r["answerNotObserved"] is False and r["tailCut"] is False and r["contaminated"] is False and r["unverified"] is False
    assert r["gapBeforeAnswerMs"] == 2000 and r["gapAfterAnswerMs"] is None and r["longestSilentGapMs"] == 2000
    assert "text" not in r and "answer" not in r and "input" not in r and r["inputChars"] == 40
    assert "readBackBeforeProposal" in r["notMeasured"]


def test_how_a_turn_ended_does_not_invalidate_first_sound_or_answer_start():
    r = scored(tm=timing(ended="ceiling", window=40000.0, bursts=[B(2000, 2400), B(3200, 39900)]))
    assert r["firstSoundMs"] == 2000 and r["answerMs"] == 3200 and r["tailCut"] is True
    assert r["endedBy"] == "ceiling" and "truncated" not in r
    # tail-cut only takes the gap after the answer out of the statistics
    s = core.summarize([r] * 20, end_silence_s=3.5)
    assert s["goals"]["noSilenceOver3000"]["pass"] is None and s["firstSoundMs"]["all"]["n"] == 20


def test_answer_not_observed_excludes_only_answer_statistics():
    r = scored(tm=timing(bursts=[B(2000, 2400)], window=2900.0))  # expected 2350 + ... listening stopped too early?
    assert r["answerNotObserved"] is False  # 2350 < 2900
    late = scored(tm=timing(bursts=[B(2000, 2400)], window=2300.0))
    assert late["answerNotObserved"] is True and late["answerMs"] is None and late["firstSoundMs"] == 2000
    assert late["suspectDropped"] is False


def test_contaminated_by_pre_t0_audio_or_an_implausible_first_sound():
    assert scored(tm=timing(pre=True))["contaminated"] is True
    early = scored(tm=timing(first=4.0, bursts=[B(4, 400), B(3200, 6000)]))
    assert early["contaminated"] and "300" in early["contaminatedBy"]
    assert scored(tm=timing(pre=None))["notMeasured"]["contaminated"]


def test_unverified_causes_and_skew_range():
    assert "no stored" in scored(st=None)["unverifiedReason"]
    assert scored(st=stored(state="failed"))["unverified"]
    assert "totalMs" in scored(st=stored(timings={"transcriptMs": 500, "firstSentenceMs": 1500}))["unverifiedReason"]
    assert "wall-clock" in scored(tm=timing(wall=None))["unverifiedReason"]
    far = scored(st=stored(heard=1_009_000))
    assert far["unverified"] and "implausible" in far["unverifiedReason"] and far["firstSoundMs"] == 2000


def test_stage_log_replaces_the_estimate_and_gives_a_breakdown():
    stage = {"clientTurnId": "c1", "heardAtMs": 1_000_400.0, "eosAtMs": 1_000_420.0, "brainSentAtMs": 1_000_430.0,
             "firstSentenceAtMs": 1_001_900.0, "ttsRequestAtMs": 1_001_910.0, "firstTtsByteAtMs": 1_002_600.0,
             "firstFrameAtMs": 1_002_700.0, "fillerKind": "neutral", "fillerAtMs": 1_001_200.0, "voiceRefused": False}
    r = scored(stage=stage)
    assert r["answerSource"] == "stages" and r["answerExpectedMs"] == 2700 and r["skewMs"] == 400 and r["skewSource"] == "stages"
    assert r["answerMs"] == 3200 and r["stages"]["ttsRequestToFirstByte"] == 690 and r["fillerKind"] == "neutral"
    assert scored()["stages"] is None and scored()["answerSource"] == "estimate"


def test_stage_reader_and_join(tmp_path):
    f = tmp_path / "stages-room.jsonl"
    f.write_text(json.dumps({"clientTurnId": "c1", "heardAtMs": 5.0, "voiceRefused": True, "extra": 1}) + "\nnot json\n"
                 + json.dumps({"clientTurnId": "c2", "heardAtMs": 50_000.0}) + "\n")
    rows = core.read_stages(f)
    assert len(rows) == 2 and "extra" not in rows[0] and rows[0]["firstFrameAtMs"] is None
    assert core.read_stages(tmp_path / "missing.jsonl") == []
    assert core.join_stage({"clientTurnId": "c2"}, rows, None)["heardAtMs"] == 50_000.0
    assert core.join_stage({"clientTurnId": "zz"}, rows, 49_000.0)["clientTurnId"] == "c2"  # nearest heardAtMs
    assert core.join_stage(None, rows, 20_000.0) is None


def test_merged_and_split_by_stored_input_length_and_by_neighbour():
    long = scored(t=turn(text="x" * 50), st=stored(inputChars=107))
    assert long["merged"] and "107" in long["endpointReason"]
    short = scored(t=turn(text="x" * 50), st=stored(inputChars=10))
    assert short["split"] and not short["merged"]
    a = {**scored(t=turn("booking", "book_slot", tid="t12"), st=None), "call": 1}
    b = {**scored(t=turn(tid="t13"), st=stored(tools=["check_availability", "book_slot"], proposals=["booking"], inputChars=None)), "call": 1}
    rows = [a, b]
    core.link_endpoint_errors(rows)
    assert rows[0]["split"] and rows[1]["merged"]
    c = {**scored(t=turn(text="x" * 50, tid="t01"), st=stored(inputChars=107)), "call": 1}
    d = {**scored(t=turn(tid="t02"), st=None), "call": 1}
    core.link_endpoint_errors([c, d])
    assert d["split"]
    e = {**scored(t=turn(tid="t05"), st=stored()), "call": 2}  # a neighbour in another call is never linked
    core.link_endpoint_errors([a, e])
    assert not e["merged"]


# --- goals --------------------------------------------------------------------------------------

def good(i, kind="plain", first=1000.0, answer=1800.0, gap=900.0):
    return {"id": f"t{i:02d}", "call": 1, "language": "en", "kind": kind, "expectTool": None if kind == "plain" else "book_slot",
            "firstSoundMs": first, "answerMs": answer, "longestSilentGapMs": gap, "gapBeforeAnswerMs": gap, "timedOut": False,
            "answerNotObserved": False, "tailCut": False, "contaminated": False, "unverified": False, "merged": False, "split": False,
            "bargedIn": False, "suspectDropped": False, "fastServed": False, "brain": {"firstSentenceMs": 1000}, "stages": None,
            "voiceRefused": None, "extraStoredRows": 0, "expectedToolUsed": None}


def clean_rows():
    return [good(i) for i in range(12)] + [good(12 + i, "booking", answer=3000.0) for i in range(8)]


def test_clean_run_gives_true_and_false_verdicts():
    s = core.summarize(clean_rows(), end_silence_s=3.5)
    assert all(g["pass"] is True for g in s["goals"].values())
    rows = clean_rows()
    rows[0]["firstSoundMs"] = 1600.0
    for r in rows[:12]:
        r["answerMs"] = 2700.0
    for r in rows[12:]:
        r["answerMs"] = 4100.0
    rows[5]["longestSilentGapMs"] = 3200.0
    assert [g["pass"] for g in core.summarize(rows, end_silence_s=3.5)["goals"].values()] == [False] * 4


def test_silence_goal_needs_an_end_silence_above_three_seconds():
    g = core.summarize(clean_rows(), end_silence_s=1.5)["goals"]["noSilenceOver3000"]
    assert g["pass"] is None and "--end-silence" in g["reason"] and core.END_SILENCE_S == 3.5


def test_one_timeout_makes_goal_one_false_and_leaves_answer_goals_undecided():
    rows = clean_rows()
    rows[3].update(firstSoundMs=None, answerMs=None, longestSilentGapMs=None, gapBeforeAnswerMs=None, timedOut=True)
    s = core.summarize(rows, end_silence_s=3.5)
    g = s["goals"]
    assert g["firstSoundWithin1500OnEveryTurn"]["pass"] is False
    assert g["plainAnswerMedianWithin2500"]["pass"] is None and g["plainAnswerMedianWithin2500"]["partial"]["n"] == 11
    assert g["toolAnswerMedianWithin4000"]["pass"] is True
    assert s["timedOutTurns"] == ["t03"]
    partial = core.summarize(clean_rows()[:7], end_silence_s=3.5)
    assert all(g["pass"] is None for g in partial["goals"].values())
    partial_rows = clean_rows()[:7]
    partial_rows[2].update(firstSoundMs=None, timedOut=True)
    assert core.summarize(partial_rows, end_silence_s=3.5)["goals"]["firstSoundWithin1500OnEveryTurn"]["pass"] is False


def test_each_flag_excludes_only_what_it_invalidates():
    rows = clean_rows()
    rows[0]["contaminated"] = True  # first sound and gaps out, answer stays
    rows[1]["unverified"] = True  # answer out, first sound stays
    rows[2]["answerNotObserved"] = True
    rows[2]["answerMs"] = None
    s = core.summarize(rows, end_silence_s=3.5)
    assert s["firstSoundMs"]["all"]["n"] == 19
    assert s["answerMs"]["plain"]["n"] == 10  # 12 plain minus the unverified and the unobserved turn
    assert s["goals"]["firstSoundWithin1500OnEveryTurn"]["pass"] is None
    assert s["goals"]["plainAnswerMedianWithin2500"]["pass"] is None
    assert s["goals"]["toolAnswerMedianWithin4000"]["pass"] is True
    assert s["contaminatedTurns"][0]["id"] == "t00" and s["answerNotObservedTurns"] == ["t02"]


def test_certain_misses_survive_exclusions_but_excluded_values_are_not_evidence():
    rows = clean_rows()
    rows[0]["firstSoundMs"] = 1700.0
    for i in (5, 6, 7):
        rows[i]["contaminated"] = True
    assert core.summarize(rows, end_silence_s=3.5)["goals"]["firstSoundWithin1500OnEveryTurn"]["pass"] is False
    rows2 = clean_rows()
    rows2[0].update(firstSoundMs=1700.0, contaminated=True)
    assert core.summarize(rows2, end_silence_s=3.5)["goals"]["firstSoundWithin1500OnEveryTurn"]["pass"] is None


def test_merged_turns_are_endpoint_errors_not_timeouts_and_not_answer_evidence():
    rows = clean_rows()
    rows[4].update(merged=True)
    rows[3].update(firstSoundMs=None, answerMs=None, longestSilentGapMs=None, gapBeforeAnswerMs=None, timedOut=True, split=True)
    s = core.summarize(rows, end_silence_s=3.5)
    assert s["endpointErrors"]["count"] == 2 and s["endpointErrors"]["merged"] == ["t04"] and s["endpointErrors"]["split"] == ["t03"]
    assert s["goals"]["firstSoundWithin1500OnEveryTurn"]["pass"] is None  # not a "false" from a timeout
    assert s["goals"]["plainAnswerMedianWithin2500"]["pass"] is None


def test_refused_requests_come_from_the_stage_log_when_present():
    rows = clean_rows()
    assert core.summarize(rows)["refusedVoiceRequests"]["value"] is None
    rows[0]["voiceRefused"], rows[1]["voiceRefused"] = True, False
    rows[0]["stages"] = {"ttsRequestToFirstByte": 700}
    rows[1]["stages"] = {"ttsRequestToFirstByte": 900}
    s = core.summarize(rows)
    assert s["refusedVoiceRequests"] == {"value": 1, "source": "worker stage log"}
    assert s["stages"]["medianMs"]["ttsRequestToFirstByte"] == 800 and s["stages"]["turns"] == 2


def test_table_prints_partial_statistics_as_plain_text():
    rows = clean_rows()
    for r in rows:
        r.update(firstSoundMs=None, answerMs=None, longestSilentGapMs=None, gapBeforeAnswerMs=None, timedOut=True)
    text = core.render_table(rows, core.summarize(rows, end_silence_s=3.5))
    assert "{" not in text and "partial, not a verdict: 0 of 12 turns, no value" in text and "timeout" in text


# --- the saved run 2, rescored --------------------------------------------------------------------

def test_rescoring_saved_run_two_gives_the_corrected_numbers():
    saved = json.loads((Path(__file__).parent / "fixtures" / "replay_run2.json").read_text())
    script = core.load_script(SCRIPT)
    result = core.rescore(saved, script)
    rows = {r["id"]: r for r in result["rows"]}
    s = result["summary"]
    assert "truncatedTurns" not in s and all("truncated" not in r for r in rows.values())
    assert 2050 <= s["firstSoundMs"]["all"]["median"] <= 2130 and s["firstSoundMs"]["all"]["n"] == 18
    # the turns the old rule called clean: plain answers start at least 2.9 s after the caller stopped
    for tid in ("t01", "t02", "t08", "t16", "t18"):
        assert rows[tid]["answerMs"] >= 2900, tid
    assert s["endpointErrors"]["merged"] == ["t13"] and s["endpointErrors"]["split"] == ["t12"]
    assert [x["id"] for x in s["unverifiedTurns"]] == ["t12", "t15"]
    assert [x["id"] for x in s["contaminatedTurns"]] == ["t15"]
    assert rows["t12"]["timedOut"] and s["goals"]["firstSoundWithin1500OnEveryTurn"]["pass"] is False  # a clean first sound over 1.5 s
    assert s["goals"]["plainAnswerMedianWithin2500"]["pass"] is None
    assert set(result["notRecomputable"]) >= {"contaminatedByPreSound", "mergedBySplitByLength", "stages", "bargedIn"}
    assert all(r["answerSource"] in ("estimate", None) for r in rows.values())
