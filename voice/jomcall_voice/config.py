"""Every timing and limit of the voice worker lives here, and nowhere else.

Keys are read from the environment only. Nothing in this package logs or writes
a key or a voice token.
"""

from __future__ import annotations

import os
from pathlib import Path

# --- Race-the-clock timing (milliseconds unless the name says otherwise) ---
NEUTRAL_ACK_MS = 800  # no sentence yet: say a one-or-two-word acknowledgement
TROUBLE_MS = 4_000  # still no sentence: say the trouble line, once
CALL_CAP_S = 300  # hard cap on one call
MAX_VOICE_REQUESTS_PER_TURN = 2  # first sentence alone, the rest in one request

# --- Hearing: Deepgram through livekit-plugins-deepgram ---
STT_MODEL = "nova-3"
STT_LANGUAGE = "multi"
STT_ENDPOINTING_MS = 300
STT_SAMPLE_RATE = 16_000

# --- Speaking: Gemini text-to-speech on the Google Agent Platform endpoint ---
TTS_MODEL = "gemini-3.8-flash-lite-tts"
TTS_URL = (
    "https://aiplatform.googleapis.com/v1/publishers/google/models/"
    f"{TTS_MODEL}:streamGenerateContent?alt=sse"
)
TTS_SAMPLE_RATE = 24_000  # 16-bit mono PCM
TTS_TIMEOUT_S = 20.0

# --- The brain: the voice turn endpoint in the TypeScript agent process ---
DEFAULT_TURN_URL = "http://127.0.0.1:54633"
BODY_LIMIT_BYTES = 8 * 1024
BODY_BUDGET_BYTES = 7_500  # leaves room for the JSON envelope

# Prewarm: stay well under the ~11 requests a minute the speech endpoint allows.
PREWARM_MAX_PER_MIN = 8

AGENT_NAME = "jomcall-voice"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"

# Brain error codes that end the call. Any other code gets the trouble line.
FATAL_BRAIN_CODES = frozenset({"VOICE_EXPIRED", "VOICE_UNAUTHORIZED", "TURN_LIMIT"})


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing environment variable {name}")
    return value


def turn_url() -> str:
    return os.environ.get("JOMCALL_VOICE_TURN_URL", "").strip() or DEFAULT_TURN_URL
