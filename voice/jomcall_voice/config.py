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
NEUTRAL_FINISH_MS = 250  # a neutral filler with less than this left is not cut by an answer
MAX_VOICE_REQUESTS_PER_TURN = 2  # first sentence alone, the rest in one request

# End of speech reaches the worker about 0.9 s after the caller stops (median 0.92 s,
# range 0.85-1.21 s in ONE measured run: Deepgram's 300 ms endpointing plus
# transport and recognition). This is an estimate, not a constant of nature. 600 is
# deliberately below that measured minimum, so the `heardAtMs` sent to the brain and the
# filler deadlines never claim an end of speech earlier than the data supports. Revisit
# it from the stage logs (`stages-*.jsonl`) once more calls exist.
EARS_LAG_MS = 600

# --- Silence trimming (16-bit PCM; amplitudes are absolute sample values) ---
TRIM_THRESHOLD = 200  # a 10 ms window whose peak is below this counts as silent
TRIM_PAD_MS = 20  # kept on each side of the voiced part
LEAD_TRIM_MAX_MS = 400  # never drop more than this from the start of an answer

# --- Hearing: Deepgram through livekit-plugins-deepgram ---
STT_MODEL = "nova-3"
STT_LANGUAGE = "multi"
STT_ENDPOINTING_MS = 300
STT_SAMPLE_RATE = 16_000

# Deepgram sometimes sends final transcripts and no end-of-speech (seen once: 15 s).
# If words are pending and nothing was heard for this long, the utterance has ended.
FLUSH_AFTER_FINAL_MS = 1_000
# A transcript arriving this soon after the previous one, before any answer audio for
# it, is the rest of the same sentence that endpointing cut in two: the two are joined.
MERGE_WINDOW_MS = 700

# --- Speaking: Gemini text-to-speech on the Google Agent Platform endpoint ---
TTS_MODEL = "gemini-3.8-flash-lite-tts"
TTS_URL = (
    "https://aiplatform.googleapis.com/v1/publishers/google/models/"
    f"{TTS_MODEL}:streamGenerateContent?alt=sse"
)
TTS_SAMPLE_RATE = 24_000  # 16-bit mono PCM
TTS_TIMEOUT_S = 20.0
# Idle connections stay open this long so a call's later requests skip the TLS
# handshake (httpx's default of 5 s is shorter than the pause between turns).
HTTP_KEEPALIVE_S = 60.0

# --- The brain: the voice turn endpoint in the TypeScript agent process ---
DEFAULT_TURN_URL = "http://127.0.0.1:54633"
BODY_LIMIT_BYTES = 8 * 1024
BODY_BUDGET_BYTES = 7_500  # leaves room for the JSON envelope

# Prewarm: stay well under the ~11 requests a minute the speech endpoint allows.
PREWARM_MAX_PER_MIN = 8

AGENT_NAME = "jomcall-voice"
# The worker's own health HTTP server (the only listener livekit-agents 1.6.0 opens;
# its Prometheus server stays off unless prometheus_port is set). Loopback only.
WORKER_HOST = "127.0.0.1"
WORKER_PORT = 54634
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
