"""Client for the voice turn endpoint in the TypeScript agent process.

Closing the iterator closes the HTTP request, which aborts the turn on the
server. That is how barge-in cancels a running turn. Nothing here logs the
token or the transcript.
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from . import config


class BrainError(Exception):
    pass


class BrainUnauthorized(BrainError):
    """HTTP 401: the voice token is wrong or the session is gone."""


class BrainRejected(BrainError):
    """HTTP 400 or 413: our request was malformed. A worker bug, not the caller's."""


class BrainUnavailable(BrainError):
    """The brain could not be reached or answered with a server error."""


def _body(session_id: str, transcript: str, turn_id: str, heard_at_ms: float) -> bytes:
    def encode(text: str) -> bytes:
        return json.dumps(
            {
                "sessionId": session_id,
                "transcript": text,
                "clientTurnId": turn_id,
                "heardAtMs": heard_at_ms,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()

    text = transcript[:4000]  # the endpoint accepts at most 4000 characters
    body = encode(text)
    while len(body) > config.BODY_BUDGET_BYTES and text:
        text = text[: max(0, len(text) - max(1, (len(body) - config.BODY_BUDGET_BYTES) // 3))]
        body = encode(text)
    return body


def _new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(connect=3.0, read=30.0, write=5.0, pool=3.0),
        limits=httpx.Limits(keepalive_expiry=config.HTTP_KEEPALIVE_S),
    )


class BrainClient:
    """One HTTP client for a whole call, so turns reuse the connection.

    Closing a turn's iterator early still drops that connection, which is how the
    server learns the turn was aborted.
    """

    def __init__(self, base_url: str | None = None):
        self._base_url = base_url
        self._client = _new_client()

    def __call__(self, session_id, token, transcript, client_turn_id, heard_at_ms):
        return stream_turn(
            session_id, token, transcript, client_turn_id, heard_at_ms,
            base_url=self._base_url, client=self._client,
        )

    async def aclose(self) -> None:
        await self._client.aclose()


async def stream_turn(
    session_id: str,
    token: str,
    transcript: str,
    client_turn_id: str,
    heard_at_ms: float,
    *,
    base_url: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> AsyncIterator[dict]:
    url = (base_url or config.turn_url()).rstrip("/") + "/voice/turns"
    headers = {
        "authorization": f"Bearer {token}",
        "content-type": "application/json",
    }
    body = _body(session_id, transcript, client_turn_id, heard_at_ms)
    own = client is None
    http = client or _new_client()
    try:
        async with http.stream("POST", url, content=body, headers=headers) as response:
            if response.status_code == 401:
                raise BrainUnauthorized("401")
            if response.status_code in (400, 413):
                raise BrainRejected(str(response.status_code))
            if response.status_code != 200:
                raise BrainUnavailable(str(response.status_code))
            buffer = b""
            async for chunk in response.aiter_bytes():
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if line.strip():
                        yield _parse(line)
            if buffer.strip():
                yield _parse(buffer)
    except httpx.HTTPError as error:
        raise BrainUnavailable(type(error).__name__) from None
    finally:
        if own:
            await http.aclose()


def _parse(line: bytes) -> dict:
    try:
        event = json.loads(line)
    except ValueError:
        raise BrainUnavailable("bad_line") from None
    if not isinstance(event, dict):
        raise BrainUnavailable("bad_line")
    return event
