"""The thin LiveKit entry: joins the room, wires real ears, voice and sink to a Call."""

from __future__ import annotations

import asyncio
import json
import logging

from livekit import rtc
from livekit.agents import AutoSubscribe, JobContext

from . import brain_client, config
from .call import Call
from .ears import DeepgramEars
from .voice_out import Voice

log = logging.getLogger("jomcall_voice.worker")

# Keep in step with VOICE_PRESETS in packages/domain/src/agent-test/voice-session.ts.
PRESETS = ("Kore", "Sulafat", "Leda", "Achird", "Charon")
FRAME_SAMPLES = config.TTS_SAMPLE_RATE // 50  # 20 ms
FRAME_BYTES = FRAME_SAMPLES * 2


class RealClock:
    def now(self) -> float:
        return asyncio.get_running_loop().time()

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


class RoomSink:
    """Plays 24 kHz mono PCM into the room through one published audio track."""

    def __init__(self, source: rtc.AudioSource):
        self._source = source

    async def play(self, chunks) -> None:
        buffer = b""
        async for chunk in chunks:
            buffer += chunk
            while len(buffer) >= FRAME_BYTES:
                await self._push(buffer[:FRAME_BYTES])
                buffer = buffer[FRAME_BYTES:]
        if buffer:
            await self._push(buffer)
        await self._source.wait_for_playout()

    async def _push(self, pcm: bytes) -> None:
        samples = len(pcm) // 2
        await self._source.capture_frame(
            rtc.AudioFrame(pcm, config.TTS_SAMPLE_RATE, 1, samples)
        )

    def stop(self) -> None:
        self._source.clear_queue()


def parse_metadata(raw: str) -> dict | None:
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    for key in ("sessionId", "voiceToken"):
        if not isinstance(data.get(key), str) or not data[key]:
            return None
    if not isinstance(data.get("disclosure"), str) or not data["disclosure"].strip():
        return None
    greeting = data.get("greeting")
    return {
        "sessionId": data["sessionId"],
        "voiceToken": data["voiceToken"],
        "voice": data.get("voice") if data.get("voice") in PRESETS else PRESETS[0],
        "greeting": greeting if isinstance(greeting, str) else "",
        "disclosure": data["disclosure"],
    }


async def _caller_audio(ctx: JobContext, participant: rtc.RemoteParticipant):
    future: asyncio.Future = asyncio.get_running_loop().create_future()

    def offer(track: rtc.Track, who: rtc.RemoteParticipant) -> None:
        if (
            who.identity == participant.identity
            and track.kind == rtc.TrackKind.KIND_AUDIO
            and not future.done()
        ):
            future.set_result(track)

    ctx.room.on("track_subscribed", lambda track, pub, who: offer(track, who))
    for pub in participant.track_publications.values():
        if pub.track is not None:
            offer(pub.track, participant)
    return await asyncio.wait_for(future, 30)


async def entrypoint(ctx: JobContext) -> None:
    meta = parse_metadata(ctx.job.metadata)
    if meta is None:
        log.error("voice job refused: bad dispatch metadata")
        ctx.shutdown("bad_metadata")
        return
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    source = rtc.AudioSource(config.TTS_SAMPLE_RATE, 1)
    await ctx.room.local_participant.publish_track(
        rtc.LocalAudioTrack.create_audio_track("jomcall-voice", source),
        rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
    )
    try:
        participant = await asyncio.wait_for(ctx.wait_for_participant(), 60)
        track = await _caller_audio(ctx, participant)
    except asyncio.TimeoutError:
        log.error("voice job ended: nobody joined")
        ctx.shutdown("no_caller")
        return
    call = Call(
        session_id=meta["sessionId"],
        token=meta["voiceToken"],
        greeting=meta["greeting"],
        disclosure=meta["disclosure"],
        ears=DeepgramEars(track),
        brain=brain_client.stream_turn,
        voice=Voice(meta["voice"]),
        clock=RealClock(),
        sink=RoomSink(source),
    )
    ctx.room.on(
        "participant_disconnected",
        lambda who: call.hangup() if who.identity == participant.identity else None,
    )
    ctx.room.on("disconnected", lambda *_: call.hangup())
    result = await call.run()
    ctx.shutdown(result.end_reason)
