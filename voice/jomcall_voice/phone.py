"""Phone-call helpers for the worker: job detection, call start and call end.

A phone job comes from a LiveKit SIP dispatch rule whose metadata is the fixed
string {"channel":"phone"}. It carries no session, token or settings: the
worker asks the agent process (loopback, PHONE_URL) to start the call, and
that server checks the SIP participant, applies every refusal and returns a
per-call token. Nothing here logs a token, a phone number or a transcript.
"""

from __future__ import annotations

import json
import os

import httpx

DEFAULT_PHONE_URL = "http://127.0.0.1:54635"
LANGUAGES = ("ms", "en", "manglish", "zh")


def phone_url() -> str:
    return os.environ.get("JOMCALL_PHONE_URL", "").strip() or DEFAULT_PHONE_URL


def is_phone_job(raw: str) -> bool:
    try:
        data = json.loads(raw)
    except ValueError:
        return False
    return isinstance(data, dict) and data.get("channel") == "phone"


def parse_start(data: object) -> dict | None:
    """Validates the call-start answer. None means: end the call silently."""
    if not isinstance(data, dict):
        return None
    if data.get("refusal"):
        return {"refused": True, "busyLine": data.get("busyLine") is True}
    call_id, token = data.get("callId"), data.get("token")
    disclosure = data.get("disclosure")
    if not (isinstance(call_id, str) and call_id and isinstance(token, str) and token):
        return None
    # The AI disclosure is never skippable: without it there is no call.
    if not isinstance(disclosure, str) or not disclosure.strip():
        return None
    cap = data.get("capSeconds")
    text = lambda key: data[key].strip() if isinstance(data.get(key), str) else ""  # noqa: E731
    return {
        "refused": False,
        "callId": call_id,
        "token": token,
        "voice": data.get("voice") if isinstance(data.get("voice"), str) else "",
        # Disclosure, then the recording notice, then the greeting: one opening.
        "opening": " ".join(
            part for part in (text("disclosure"), text("recordingDisclosure"), text("greeting")) if part
        ),
        "capSeconds": float(cap) if isinstance(cap, (int, float)) and 30 <= cap <= 3600 else 600.0,
    }


class PhoneClient:
    def __init__(self, base_url: str | None = None, client: httpx.AsyncClient | None = None):
        self._base = (base_url or phone_url()).rstrip("/")
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(connect=3.0, read=10.0, write=5.0, pool=3.0)
        )

    def __repr__(self) -> str:
        return "PhoneClient()"

    async def start(self, room: str, identity: str) -> dict | None:
        response = await self._client.post(
            self._base + "/phone/calls", json={"room": room, "identity": identity}
        )
        if response.status_code != 200:
            return None
        try:
            return parse_start(response.json())
        except ValueError:
            return None

    async def answered(self, call_id: str, token: str) -> None:
        await self._client.post(
            f"{self._base}/phone/calls/{call_id}/answered",
            headers={"authorization": "Bearer " + token},
            json={},
        )

    async def end(self, call_id: str, token: str, reason: str, language: str | None) -> None:
        body: dict = {"reason": reason if reason.replace("_", "").isalpha() else "ended"}
        if language in LANGUAGES:
            body["language"] = language
        await self._client.post(
            f"{self._base}/phone/calls/{call_id}/end",
            headers={"authorization": "Bearer " + token},
            json=body,
        )

    async def aclose(self) -> None:
        await self._client.aclose()
