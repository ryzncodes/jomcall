"""Hearing: LiveKit's Deepgram plugin, configured to the measured speech rules.

nova-3, language "multi", 300 ms endpointing, interim results on. The plugin
expresses all of that, so no custom adapter is needed. Interim text is never
logged or passed on (only the fact that words were heard); only the endpointed, final transcript leaves this module.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from livekit import rtc
from livekit.agents import stt
from livekit.plugins import deepgram

from . import config
from .call import EarEvent


def build_stt() -> deepgram.STT:
    return deepgram.STT(
        model=config.STT_MODEL,
        language=config.STT_LANGUAGE,
        interim_results=True,
        endpointing_ms=config.STT_ENDPOINTING_MS,
        sample_rate=config.STT_SAMPLE_RATE,
        api_key=config.env("DEEPGRAM_API_KEY"),
    )


async def assemble(events: AsyncIterator, sleep=asyncio.sleep) -> AsyncIterator[EarEvent]:
    """Turn Deepgram events into call events, and never lose a finished utterance.

    Final transcripts are held until end-of-speech. If end-of-speech does not come
    within FLUSH_AFTER_FINAL_MS of the last speech activity (interim or final words),
    the utterance is delivered anyway, and the late end-of-speech, if any, is dropped.
    The plugin has no `utterance_end_ms`-style option in 1.6.0, hence this timer.
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def pump() -> None:
        try:
            async for event in events:
                queue.put_nowait(event)
        finally:
            queue.put_nowait(None)

    pump_task = asyncio.create_task(pump())
    # Retrieved here or by `await` below, so asyncio never logs it with a traceback.
    pump_task.add_done_callback(lambda t: t.cancelled() or t.exception())
    pieces: list[str] = []
    swallow_end = False
    getter: asyncio.Task | None = None
    timer: asyncio.Task | None = None
    flush = config.FLUSH_AFTER_FINAL_MS / 1000

    def rearm() -> None:
        nonlocal timer
        if timer:
            timer.cancel()
        timer = asyncio.create_task(sleep(flush)) if pieces else None

    def words(event) -> str:
        return event.alternatives[0].text.strip() if event.alternatives else ""

    try:
        while True:
            getter = getter or asyncio.create_task(queue.get())
            waiting = {getter} | ({timer} if timer else set())
            done, _ = await asyncio.wait(waiting, return_when=asyncio.FIRST_COMPLETED)
            if timer is not None and timer in done and getter not in done:
                timer, text, pieces, swallow_end = None, " ".join(pieces), [], True
                yield EarEvent("transcript", text)
                continue
            event, getter = getter.result(), None
            if event is None:
                await pump_task  # an STT failure ends the call, it is not a hangup
                return
            kind = event.type
            if kind == stt.SpeechEventType.START_OF_SPEECH:
                yield EarEvent("speech_start")
            elif kind == stt.SpeechEventType.INTERIM_TRANSCRIPT:
                if words(event):  # words, not noise: this is what lets the caller interrupt
                    yield EarEvent("interim", "words")
                    rearm()
            elif kind == stt.SpeechEventType.FINAL_TRANSCRIPT:
                if words(event):
                    pieces.append(words(event))
                    swallow_end = False
                    yield EarEvent("interim", "words")
                    rearm()
            elif kind == stt.SpeechEventType.END_OF_SPEECH:
                if timer:
                    timer.cancel()
                    timer = None
                if swallow_end:
                    swallow_end = False  # that utterance was already delivered
                    continue
                text, pieces = " ".join(pieces), []
                # `call` derives when the caller stopped (see EARS_LAG_MS).
                yield EarEvent("transcript", text)
    finally:
        for task in (pump_task, getter, timer):
            if task:
                task.cancel()


class DeepgramEars:
    def __init__(self, track: rtc.Track):
        self._track = track

    async def events(self) -> AsyncIterator[EarEvent]:
        engine = build_stt()
        stream = engine.stream()
        audio = rtc.AudioStream(
            self._track, sample_rate=config.STT_SAMPLE_RATE, num_channels=1
        )

        async def pump() -> None:
            async for frame_event in audio:
                stream.push_frame(frame_event.frame)

        pump_task = asyncio.create_task(pump())
        try:
            async for event in assemble(stream):
                yield event
        finally:
            pump_task.cancel()
            await audio.aclose()
            await stream.aclose()
            await engine.aclose()
