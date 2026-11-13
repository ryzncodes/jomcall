"""Spoken output: Gemini text-to-speech, streamed, with a disk cache for fixed lines.

A direct client rather than LiveKit's `google.beta.TTS`: that class builds on
the google-genai SDK, which cannot be pointed at the Agent Platform endpoint
with an `x-goog-api-key` header. Output is 16-bit mono PCM at 24 kHz.

A 429 raises VoiceRefused and is never retried: this project may make only
about 11 requests a minute, so a retry would spend the next turn's budget.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
from typing import AsyncIterator

import httpx

from . import config


class VoiceError(Exception):
    pass


class VoiceRefused(VoiceError):
    """HTTP 429: the speech service refused for rate limiting."""


class VoiceFailed(VoiceError):
    """Any other failure to get audio."""


class Voice:
    def __init__(
        self,
        preset: str,
        *,
        api_key: str | None = None,
        url: str | None = None,
        cache_dir: Path | None = None,
    ):
        self.preset = preset
        self._key = api_key
        self._url = url or config.TTS_URL
        self._cache_dir = Path(cache_dir) if cache_dir else config.CACHE_DIR
        self._memory: dict[str, bytes] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def __repr__(self) -> str:  # never show the key
        return f"Voice({self.preset!r})"

    def _api_key(self) -> str:
        return self._key or config.env("GOOGLE_CLOUD_API_KEY")

    async def speak(self, text: str) -> AsyncIterator[bytes]:
        """One voice request. Yields PCM chunks, each a whole number of samples."""
        body = {
            "contents": [{"role": "user", "parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": self.preset}}
                },
                "response_format": {"audio": {"mime_type": "AUDIO_L16"}},
            },
        }
        headers = {"x-goog-api-key": self._api_key(), "content-type": "application/json"}
        timeout = httpx.Timeout(config.TTS_TIMEOUT_S, connect=5.0)
        carry = b""
        got_audio = False
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", self._url, json=body, headers=headers) as r:
                    if r.status_code == 429:
                        raise VoiceRefused("429")
                    if r.status_code != 200:
                        raise VoiceFailed(str(r.status_code))
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        pcm = carry + _audio_of(line[5:].strip())
                        cut = len(pcm) - (len(pcm) % 2)
                        carry = pcm[cut:]
                        if cut:
                            got_audio = True
                            yield pcm[:cut]
        except httpx.HTTPError as error:
            raise VoiceFailed(type(error).__name__) from None
        if not got_audio:
            raise VoiceFailed("no_audio")

    def _path(self, text: str) -> Path:
        digest = hashlib.sha256(
            f"{config.TTS_MODEL}\n{self.preset}\n{text}".encode()
        ).hexdigest()[:40]
        return self._cache_dir / self.preset / f"{digest}.pcm"

    async def cached(self, text: str) -> bytes:
        """Audio for a fixed line: synthesized once per preset, then kept on disk."""
        path = self._path(text)
        key = str(path)
        if key in self._memory:
            return self._memory[key]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if key in self._memory:
                return self._memory[key]
            if path.is_file():
                audio = path.read_bytes()
            else:
                audio = b"".join([chunk async for chunk in self.speak(text)])
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(f".{os.getpid()}.tmp")
                tmp.write_bytes(audio)
                tmp.replace(path)
            self._memory[key] = audio
            return audio


def _audio_of(data: str) -> bytes:
    if not data or data == "[DONE]":
        return b""
    try:
        event = json.loads(data)
        parts = event["candidates"][0]["content"]["parts"]
    except (ValueError, KeyError, IndexError, TypeError):
        return b""
    out = b""
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data") or {}
        mime = inline.get("mimeType") or inline.get("mime_type") or ""
        if inline.get("data") and mime.startswith("audio/"):
            out += base64.b64decode(inline["data"])
    return out
