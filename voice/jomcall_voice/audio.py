"""Silence trimming for 16-bit mono PCM (little-endian), no dependencies.

Synthesized speech starts with up to ~0.3 s of near-silence and fixed clips end
with ~0.3 s more. Both are dead air on a phone call, so they are cut, keeping a
short pad so the voice never starts or stops abruptly.
"""

from __future__ import annotations

import sys
from array import array

from . import config

BYTES_PER_SAMPLE = 2


def _samples(pcm: bytes) -> array:
    out = array("h")
    out.frombytes(pcm[: len(pcm) - len(pcm) % BYTES_PER_SAMPLE])
    if sys.byteorder == "big":
        out.byteswap()
    return out


def _window_samples(ms: int = 10) -> int:
    return config.TTS_SAMPLE_RATE * ms // 1000


def _voiced(window: array) -> bool:
    return bool(window) and max(map(abs, window)) >= config.TRIM_THRESHOLD


def trim_silence(pcm: bytes) -> bytes:
    """Cut leading and trailing silence, keeping TRIM_PAD_MS each side.

    A clip with no voiced sample at all is returned unchanged: it stays a valid,
    non-empty clip and nothing is guessed about it.
    """
    samples = _samples(pcm)
    step = _window_samples()
    voiced = [i for i in range(0, len(samples), step) if _voiced(samples[i : i + step])]
    if not voiced:
        return pcm
    pad = config.TTS_SAMPLE_RATE * config.TRIM_PAD_MS // 1000
    first = max(0, voiced[0] - pad)
    last = min(len(samples), voiced[-1] + step + pad)
    out = samples[first:last]
    if sys.byteorder == "big":
        out.byteswap()
    return out.tobytes()


class LeadTrimmer:
    """Streaming: drops leading silence from chunks as they arrive.

    Drops at most LEAD_TRIM_MAX_MS, so real quiet speech is never eaten. Chunks may
    be any size; `flush()` returns whatever is still held when the stream ends.
    """

    def __init__(self) -> None:
        self._step = _window_samples() * BYTES_PER_SAMPLE
        self._pad_windows = max(1, config.TRIM_PAD_MS // 10)
        self._max_windows = config.LEAD_TRIM_MAX_MS // 10
        self._buffer = b""  # bytes not yet judged (less than one window)
        self._held: list[bytes] = []  # the last silent windows, kept as pad
        self._dropped = 0
        self._done = False

    def feed(self, chunk: bytes) -> bytes:
        if self._done:
            return chunk
        self._buffer += chunk
        out = b""
        while len(self._buffer) >= self._step and not self._done:
            window, self._buffer = self._buffer[: self._step], self._buffer[self._step :]
            if _voiced(_samples(window)):
                out = b"".join(self._held) + window
                self._held = []
                self._done = True
            else:
                self._held.append(window)
                if len(self._held) > self._pad_windows:
                    self._held.pop(0)
                    self._dropped += 1
                if self._dropped >= self._max_windows:
                    out = b"".join(self._held)  # give up trimming: pass on
                    self._held = []
                    self._done = True
        if self._done:
            return out + self._buffer_take()
        return out

    def _buffer_take(self) -> bytes:
        rest, self._buffer = self._buffer, b""
        return rest

    def flush(self) -> bytes:
        out = b"".join(self._held) + self._buffer
        self._held, self._buffer = [], b""
        return out
