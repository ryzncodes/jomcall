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
        pieces: list[str] = []
        try:
            async for event in stream:
                if event.type == stt.SpeechEventType.START_OF_SPEECH:
                    yield EarEvent("speech_start")
                elif event.type == stt.SpeechEventType.INTERIM_TRANSCRIPT:
                    # Words, not noise: this is what lets the caller interrupt.
                    if event.alternatives and event.alternatives[0].text.strip():
                        yield EarEvent("interim", "words")
                elif event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                    if event.alternatives and event.alternatives[0].text.strip():
                        pieces.append(event.alternatives[0].text.strip())
                        yield EarEvent("interim", "words")
                elif event.type == stt.SpeechEventType.END_OF_SPEECH:
                    text, pieces = " ".join(pieces), []
                    # `call` derives when the caller stopped (see EARS_LAG_MS).
                    yield EarEvent("transcript", text)
        finally:
            pump_task.cancel()
            await audio.aclose()
            await stream.aclose()
            await engine.aclose()
