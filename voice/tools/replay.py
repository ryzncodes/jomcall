"""Scripted caller: plays the 20 turns of `script.json` into real voice calls and
measures how fast the agent answers. Definitions of every number: `replay_core.py`.

    npm run check:voice-speed -- --prepare   # once: synthesize the caller's audio (rate limited)
    npm run check:voice-speed                # the measured run

The run needs the local stack, LiveKit, the agent (JOMCALL_VOICE_PROVIDER=hosted)
and the voice worker already running. It starts each call through the same API
command the web app uses (see `session.mts`), joins the room as the caller, and
writes `output/voice/replay-<UTC timestamp>.json`. Keys come from the environment
only; no key, room token or voice token is printed or written, and no transcript
or answer text is logged or stored (answers are reported as a length only).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from jomcall_voice import config
from jomcall_voice.voice_out import Voice, VoiceError, VoiceRefused

from tools import replay_core as core

ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = Path(__file__).resolve().parent
CACHE = config.CACHE_DIR / "replay"
OUTPUT_DIR = ROOT / "output" / "voice"
RATE = config.TTS_SAMPLE_RATE
PROPOSAL_OF = {"book_slot": "booking", "take_message": "message", "handoff_to_human": "handoff"}
DEFAULT_LIVEKIT = "http://127.0.0.1:54630"


class CannotRun(Exception):
    """The run could not be performed. Exit code 2, one line on stderr."""


class RealClock:
    def now(self) -> float:
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


# --- the Node helper -----------------------------------------------------------------

async def helper(*args: str) -> dict:
    env = {**os.environ, "JOMCALL_VOICE_PROVIDER": "hosted"}
    process = await asyncio.create_subprocess_exec(
        "node", "--conditions=react-server", "--import", "tsx", str(TOOLS_DIR / "session.mts"), *args,
        cwd=ROOT, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(process.communicate(), core.HELPER_TIMEOUT_S)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise CannotRun(f"session helper '{args[0]}' did not finish within {core.HELPER_TIMEOUT_S:g} s") from None
    if process.returncode != 0:
        lines = err.decode(errors="replace").strip().splitlines()
        raise CannotRun(lines[-1][:300] if lines else f"session helper exited {process.returncode}")
    try:
        return json.loads(out.decode().strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise CannotRun("session helper printed no JSON") from None


# --- preflight ---------------------------------------------------------------------------

def _up(url: str, ok_only: bool = False) -> bool:
    try:
        r = httpx.get(url, timeout=2.0)
    except httpx.HTTPError:
        return False
    return r.status_code == 200 if ok_only else True


async def preflight() -> None:
    livekit = os.environ.get("LIVEKIT_URL", "").strip().replace("ws://", "http://", 1).replace("wss://", "https://", 1) or DEFAULT_LIVEKIT
    if not _up(livekit):
        raise CannotRun(f"LiveKit is not reachable at {livekit} (npm run livekit:start)")
    agent = config.turn_url().rstrip("/") + "/voice/health"
    if not _up(agent, ok_only=True):
        raise CannotRun(f"the agent is not reachable at {agent} (npm run dev:agent with JOMCALL_VOICE_PROVIDER=hosted)")
    try:
        await helper("ping")
    except CannotRun as error:
        raise CannotRun(f"the database is not reachable ({error})") from None


# --- audio on disk --------------------------------------------------------------------------

def _voice(preset: str) -> Voice:
    return Voice(preset, cache_dir=CACHE)


async def prepare_audio(script: list[dict], preset: str) -> core.PrepareResult:
    voice = _voice(preset)
    return await core.prepare(
        voice, RealClock(), [t["text"] for t in script], config.PREWARM_MAX_PER_MIN,
        VoiceRefused, VoiceError, say=print,
    )


def load_audio(script: list[dict], preset: str) -> dict[str, bytes]:
    voice = _voice(preset)
    audio: dict[str, bytes] = {}
    missing = 0
    for t in script:
        pcm = voice.lookup(t["text"])
        if pcm is None:
            missing += 1
        else:
            audio[t["id"]] = core.trim_silence(pcm, RATE)
    if missing:
        raise CannotRun(f"{missing} caller clips are not synthesized yet; run: npm run check:voice-speed -- --prepare")
    return audio


# --- one call --------------------------------------------------------------------------------

async def run_call(call_no: int, batch: list[dict], audio: dict[str, bytes], end_silence: float) -> tuple[str, str, list[tuple[dict, core.TurnTiming]]]:
    from livekit import rtc  # kept out of the module top so the pure parts import without it

    clock = RealClock()
    info = await helper("start")
    session_id = info["sessionId"]
    room = rtc.Room()
    frames: asyncio.Queue = asyncio.Queue()
    readers: list[asyncio.Task] = []
    gone = asyncio.Event()

    async def read_agent(track) -> None:
        stream = rtc.AudioStream.from_track(track=track, sample_rate=RATE, num_channels=1)
        try:
            async for event in stream:
                f = event.frame
                frames.put_nowait((clock.now(), core.rms(f.data), f.samples_per_channel / f.sample_rate))
        finally:
            await stream.aclose()

    room.on("track_subscribed", lambda track, pub, who: readers.append(asyncio.ensure_future(read_agent(track))) if track.kind == rtc.TrackKind.KIND_AUDIO else None)
    room.on("disconnected", lambda *_: gone.set())

    await room.connect(info["url"], info["token"])
    source = rtc.AudioSource(RATE, 1, queue_size_ms=200)
    await room.local_participant.publish_track(
        rtc.LocalAudioTrack.create_audio_track("jomcall-replay", source),
        rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
    )

    async def push(data: bytes) -> None:
        await source.capture_frame(rtc.AudioFrame(data, RATE, 1, len(data) // 2))

    pump = core.Pump(push, clock, RATE)
    pump_task = asyncio.ensure_future(pump.run())
    done: list[tuple[dict, core.TurnTiming]] = []
    try:
        # The greeting and the AI disclosure come first, every call.
        tracker = core.TurnTracker(clock.now(), timeout_s=core.GREETING_TIMEOUT_S)
        if await core.listen(frames, clock, tracker) == "timeout":
            raise CannotRun(
                f"no agent audio within {core.GREETING_TIMEOUT_S:.0f} s after joining: is the voice worker running "
                "(npm run dev:voice) and are the speech keys set?"
            )
        joined = clock.now()
        last_sound = tracker.t0 + tracker.bursts()[-1].end_ms / 1000 if tracker.bursts() else None
        for turn in batch:
            if done and clock.now() - joined > core.CALL_BUDGET_S:
                break  # leave the rest for a fresh call: the call cap is 300 s
            if gone.is_set() or pump_task.done():
                break
            # Do not rely on barge-in: let the agent finish, then speak.
            quiet = await core.wait_quiet(frames, clock, last_sound_t=last_sound)
            try:
                t0 = await pump.say_wait(audio[turn["id"]])
            except core.PumpStalled as error:
                raise CannotRun(str(error)) from None
            t0_wall = pump.t0_wall_ms
            turn_tracker = core.TurnTracker(t0, end_silence_s=end_silence)
            while not frames.empty():  # everything heard while the caller spoke, before and after t0
                turn_tracker.feed(*frames.get_nowait())
            ended = await core.listen(frames, clock, turn_tracker)
            timing = turn_tracker.result(clock.now(), ended)
            timing.t0_wall_ms = t0_wall
            timing.speech_start_wall_ms = pump.speech_start_wall_ms
            timing.barged_in = not quiet
            done.append((turn, timing))
            bursts = turn_tracker.bursts()
            last_sound = t0 + bursts[-1].end_ms / 1000 if bursts else last_sound
    finally:
        pump.stop()
        await asyncio.gather(pump_task, return_exceptions=True)
        for task in readers:
            task.cancel()
        await asyncio.gather(*readers, return_exceptions=True)
        await room.disconnect()
    return session_id, info["room"], done


# --- rows ---------------------------------------------------------------------------------

def attach(sent: list[tuple[dict, core.TurnTiming]], stored_turns: list[dict], call_no: int, stages: list[dict] | None = None) -> list[dict]:
    voice = [x for x in stored_turns if x.get("channel") == "voice"]
    windows = [
        None if t.speech_start_wall_ms is None or t.t0_wall_ms is None else (t.speech_start_wall_ms, t.t0_wall_ms + core.CALLER_TAIL_MS)
        for _, t in sent
    ]
    chosen, extra, stray = core.match_rows(windows, voice)
    rows = []
    for i, (turn, timing) in enumerate(sent):
        reason = None if chosen[i] is not None else f"no stored voice turn in this turn's window ({len(voice)} stored, {stray} outside every window)"
        row = chosen[i]
        stage = core.join_stage(row, stages or [], None if row is None else row.get("heardEstMs"))
        rows.append(core.score_turn(turn, call_no, timing, row, reason, extra[i], stage))
    core.link_endpoint_errors(rows)
    if len(voice) != len(sent):
        for r in rows:
            r["notMeasured"]["storedRowCount"] = f"{len(voice)} stored voice rows for {len(sent)} turns in this call"
    return rows


# --- main -----------------------------------------------------------------------------------

def rescore_file(path: Path, end_silence: float | None) -> int:
    saved = json.loads(path.read_text(encoding="utf-8"))
    script = core.load_script(TOOLS_DIR / "script.json")
    result = core.rescore(saved, script, end_silence)
    out = path.with_name(path.stem.replace("replay-", "rescored-") + ".json")
    out.write_text(json.dumps({"definitions": core.DEFINITIONS, **result}, indent=2) + "\n", encoding="utf-8")
    print(core.render_table(result["rows"], result["summary"]))
    print("not recomputable from the saved run: " + "; ".join(result["notRecomputable"]))
    print(f"wrote {out}")
    return 0


def write_output(args, calls: list[dict], rows: list[dict]) -> Path:
    summary = core.summarize(rows, end_silence_s=args.end_silence)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"replay-{stamp}.json"
    path.write_text(json.dumps({
        "generatedAtUtc": stamp,
        "callerVoice": args.preset,
        "turnsPerCall": args.turns_per_call,
        "endSilenceS": args.end_silence,
        "definitions": core.DEFINITIONS,
        "calls": calls,
        "rows": rows,
        "summary": summary,
    }, indent=2) + "\n", encoding="utf-8")
    print(core.render_table(rows, summary))
    print(f"wrote {path.relative_to(ROOT)}")
    return path


async def measure(args) -> int:
    script = core.load_script(TOOLS_DIR / "script.json")
    audio = load_audio(script, args.preset)
    await preflight()
    pending = list(script)
    rows: list[dict] = []
    calls: list[dict] = []
    failure: CannotRun | None = None
    try:
        for call_no in range(1, core.MAX_CALLS + 1):
            if not pending:
                break
            size = core.plan_calls(len(pending), args.turns_per_call)[0]
            print(f"call {call_no}: {min(size, len(pending))} turns", flush=True)
            session_id, room, done = await run_call(call_no, pending[:size], audio, args.end_silence)
            await asyncio.sleep(1.0)  # the last turn's row is written as its reply ends
            stored = (await helper("turns", session_id))["turns"]
            stages = core.read_stages(Path(args.stages_dir) / f"stages-{room}.jsonl")
            rows += attach(done, stored, call_no, stages)
            calls.append({"call": call_no, "sessionId": session_id, "room": room, "turnsRun": len(done), "stageRows": len(stages)})
            pending = pending[len(done):]
            if not done:
                break
    except CannotRun as error:
        failure = error
    if rows:
        write_output(args, calls, rows)  # a partial run is kept, never lost
    if failure is not None:
        raise failure
    if not rows:
        raise CannotRun("no turn could be played")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="tools.replay")
    parser.add_argument("--prepare", action="store_true", help="only synthesize the caller's audio, then stop")
    parser.add_argument("--preset", default="Puck", help="caller voice; must differ from the agent's (Kore in the fixture)")
    parser.add_argument("--turns-per-call", type=int, default=core.TURNS_PER_CALL)
    parser.add_argument("--stages-dir", default=str(OUTPUT_DIR), help="where the worker writes stages-<room>.jsonl")
    parser.add_argument("--rescore", metavar="FILE", help="recompute flags and summary from a saved run; no network")
    parser.add_argument("--end-silence", type=float, default=core.END_SILENCE_S)
    args = parser.parse_args()
    try:
        if args.rescore:
            sys.exit(rescore_file(Path(args.rescore), args.end_silence if "--end-silence" in sys.argv else None))
        if args.prepare:
            script = core.load_script(TOOLS_DIR / "script.json")
            try:
                result = asyncio.run(prepare_audio(script, args.preset))
            except RuntimeError as error:  # a missing GOOGLE_CLOUD_API_KEY: name only
                raise CannotRun(str(error)) from None
            print(f"done: {result.synthesized} new, {result.skipped} already cached, {result.remaining} remaining")
            sys.exit(0 if result.remaining == 0 else 1)
        sys.exit(asyncio.run(measure(args)))
    except (CannotRun, core.ScriptError) as error:
        print(f"voice-speed: cannot run: {error}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
