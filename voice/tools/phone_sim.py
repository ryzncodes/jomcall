"""Fake phone caller for the LOCAL LiveKit server only.

    npm run phone:simulate -- --dialled +60312345678 --caller +60123456789 --clip path.pcm

It stands in for LiveKit's SIP service: it creates a room named the way the
generated callee dispatch rule names it, dispatches the voice worker with the
same fixed metadata ({"channel":"phone"}), and joins as a participant of kind
SIP carrying the `sip.*` attributes the agent process checks. It then plays a
clip (raw 16-bit mono PCM at 24 kHz, for example one from voice/.cache) as the
caller's voice and listens for --seconds before hanging up.

It refuses any LIVEKIT_URL that is not loopback. It sends nothing to a hosted
service itself, but the worker and agent it reaches will, if they run with
hosted keys: point them at fakes, or accept that cost, before running it.
Use fake numbers only (for example +6012345xxxx). Nothing secret is printed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse

from livekit import api, rtc

from jomcall_voice import config

RATE = config.TTS_SAMPLE_RATE
FRAME = RATE // 50  # 20 ms
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def is_loopback(url: str) -> bool:
    return (urlparse(url).hostname or "") in LOOPBACK


def room_name(dialled: str) -> str:
    # The callee rule: prefix "call-", the dialled number, then a random suffix.
    return f"call-{dialled}_{secrets.token_hex(4)}"


def sip_identity(caller: str | None) -> str:
    return f"sip_{caller}" if caller else f"sip_anonymous_{secrets.token_hex(3)}"


def sip_attributes(caller: str | None, dialled: str) -> dict[str, str]:
    attrs = {
        "sip.trunkPhoneNumber": dialled,
        "sip.callID": "SCL_sim_" + secrets.token_hex(6),
        "sip.callStatus": "active",
    }
    if caller:  # a withheld caller ID has no phoneNumber attribute
        attrs["sip.phoneNumber"] = caller
    return attrs


def caller_token(key: str, secret: str, room: str, caller: str | None, dialled: str) -> str:
    return (
        api.AccessToken(key, secret)
        .with_identity(sip_identity(caller))
        .with_kind("sip")
        .with_attributes(sip_attributes(caller, dialled))
        .with_grants(api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True))
        .to_jwt()
    )


def frames(pcm: bytes) -> list[bytes]:
    size = FRAME * 2
    return [pcm[i : i + size] for i in range(0, len(pcm), size)]


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fake SIP caller for the local LiveKit server.")
    p.add_argument("--dialled", required=True, help="the JomCall number, E.164 (fake)")
    p.add_argument("--caller", default=None, help="caller number, E.164 (fake); omit to withhold")
    p.add_argument("--clip", type=Path, required=True, help="raw 16-bit mono PCM at 24 kHz")
    p.add_argument("--seconds", type=float, default=20.0, help="how long to stay on the line")
    args = p.parse_args(argv)
    for value in (args.dialled, args.caller):
        if value is not None and not E164.match(value):
            p.error("numbers must be E.164, for example +60312345678")
    return args


async def run(args: argparse.Namespace) -> int:
    url = os.environ.get("LIVEKIT_URL", "").strip()
    key = os.environ.get("LIVEKIT_API_KEY", "").strip()
    secret = os.environ.get("LIVEKIT_API_SECRET", "").strip()
    if not (url and key and secret):
        print("phone_sim: LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required")
        return 2
    if not is_loopback(url):
        print("phone_sim: refusing a LiveKit server that is not on this machine")
        return 2
    pcm = args.clip.read_bytes()
    room = room_name(args.dialled)
    http_url = url.replace("ws://", "http://").replace("wss://", "https://")
    async with api.LiveKitAPI(http_url, key, secret) as lk:
        await lk.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(
                agent_name=config.AGENT_NAME, room=room, metadata=json.dumps({"channel": "phone"})
            )
        )
    lk_room = rtc.Room()
    heard = 0

    def on_track(track: rtc.Track, *_):
        nonlocal heard
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            heard += 1

    lk_room.on("track_subscribed", on_track)
    await lk_room.connect(url, caller_token(key, secret, room, args.caller, args.dialled))
    try:
        source = rtc.AudioSource(RATE, 1)
        await lk_room.local_participant.publish_track(
            rtc.LocalAudioTrack.create_audio_track("caller", source),
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        # Let the agent play its opening before the caller speaks.
        await asyncio.sleep(6)
        for chunk in frames(pcm):
            await source.capture_frame(rtc.AudioFrame(chunk, RATE, 1, len(chunk) // 2))
        await source.wait_for_playout()
        await asyncio.sleep(max(0.0, args.seconds - 6))
    finally:
        await lk_room.disconnect()
    print(f"phone_sim: room {room} done; agent audio tracks heard: {heard}")
    return 0 if heard else 1


def main(argv: list[str] | None = None) -> None:
    sys.exit(asyncio.run(run(parse_args(sys.argv[1:] if argv is None else argv))))


if __name__ == "__main__":
    main()
