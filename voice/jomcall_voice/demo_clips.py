"""Record the landing page's sample call: one clip per spoken line.

    npm run voice:demo -- --paid [--force]

Reads the sample call's lines from web/messages/en.json and ms.json (the same
text the page shows), so the audio and the captions come from one source.
Four sets: "manglish" (the English page's mixed lines), "ms", "en" and "zh".
Lines 0, 2 and 5 are the agent (voice Kore); lines 1 and 4 are the caller
(voice Charon); line 3 is the calendar check and has no audio. The lines are
fixed, made-up text with no business or caller data. Twenty requests to
Google text-to-speech, a few cents. Refuses to run without --paid.

Writes web/public/demo-call/<set>-<line>.m4a (AAC, see samples.py) and
web/lib/demo-call.json, which records the text each clip was made from. The
page plays a clip only while that text still equals the caption, so editing
a line silently drops its audio until this is run again. Resumable: a clip
whose text is unchanged is kept unless --force.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Callable

from . import config
from .audio import trim_silence
from .samples import Convert, afconvert_aac, has_aac, write_wav
from .voice_out import Voice, VoiceError, VoiceRefused

ROOT = Path(__file__).resolve().parents[2]
MESSAGES = ROOT / "web" / "messages"
OUT_DIR = ROOT / "web" / "public" / "demo-call"
MANIFEST = ROOT / "web" / "lib" / "demo-call.json"

AGENT_VOICE = "Kore"
CALLER_VOICE = "Charon"
SPOKEN = {0: AGENT_VOICE, 1: CALLER_VOICE, 2: AGENT_VOICE, 4: CALLER_VOICE, 5: AGENT_VOICE}


def demo_lines(messages: Path = MESSAGES) -> dict[str, list[str]]:
    """The four sets of six lines, exactly as the page shows them."""
    en = json.loads((messages / "en.json").read_text())
    ms = json.loads((messages / "ms.json").read_text())

    def turns(d: dict) -> list[str]:
        return [d[f"turn{i}"] for i in range(6)]

    return {
        "manglish": turns(en),
        "ms": turns(ms),
        "en": list(en["turnsEnglish"]),
        "zh": list(en["turnsMandarin"]),
    }


def load_manifest(manifest: Path) -> dict:
    try:
        return json.loads(manifest.read_text())
    except (OSError, ValueError):
        return {}


def kept(out_dir: Path, old: dict, lines: dict[str, list[str]]) -> dict:
    """Clips on disk whose recorded text still equals the current line."""
    found: dict = {}
    for name, texts in lines.items():
        for index in SPOKEN:
            entry = old.get(name, {}).get(str(index))
            if (
                isinstance(entry, dict)
                and entry.get("text") == texts[index]
                and (out_dir / str(entry.get("file"))).is_file()
            ):
                found.setdefault(name, {})[str(index)] = entry
    return found


def write_manifest(manifest: Path, found: dict) -> None:
    ordered = {k: dict(sorted(v.items())) for k, v in sorted(found.items())}
    manifest.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n")


async def record(
    out_dir: Path,
    manifest: Path,
    clock,
    *,
    lines: dict[str, list[str]],
    force: bool = False,
    convert: Convert = afconvert_aac,
    make_voice: Callable[[str], Voice] = Voice,
    say=print,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    found = {} if force else kept(out_dir, load_manifest(manifest), lines)
    todo = [
        (name, index)
        for name in lines
        for index in SPOKEN
        if str(index) not in found.get(name, {})
    ]
    interval = 60 / config.PREWARM_MAX_PER_MIN
    try:
        for count, (name, index) in enumerate(todo):
            if count:
                await clock.sleep(interval)
            text = lines[name][index]
            voice = make_voice(SPOKEN[index])
            try:
                pcm = trim_silence(b"".join([c async for c in voice.speak(text)]))
            except VoiceRefused:
                say(f"Refused by the speech service. {len(todo) - count} clips remain; run again later.")
                break
            except VoiceError:
                say(f"A request failed. {len(todo) - count} clips remain; run again.")
                break
            finally:
                await voice.aclose()
            key = f"{name}-{index}"
            with tempfile.TemporaryDirectory() as tmp:
                wav, m4a = Path(tmp) / f"{key}.wav", Path(tmp) / f"{key}.m4a"
                write_wav(wav, pcm)
                if not convert(wav, m4a):
                    say(f"AAC conversion failed for {key}. {len(todo) - count} clips remain; run again.")
                    break
                shutil.move(str(m4a), out_dir / f"{key}.m4a")
            found.setdefault(name, {})[str(index)] = {"file": f"{key}.m4a", "text": text}
            say(f"recorded {key}.m4a")
    finally:
        write_manifest(manifest, found)
    return found


class _RealClock:
    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jomcall_voice.demo_clips")
    parser.add_argument("--paid", action="store_true", help="confirm the paid Google calls")
    parser.add_argument("--force", action="store_true", help="re-record every clip")
    args = parser.parse_args(argv)
    lines = demo_lines()
    total = len(lines) * len(SPOKEN)
    if not args.paid:
        print(
            f"Refusing: this calls Google text-to-speech up to {total} times (a few cents). "
            "Run again with --paid.",
            file=sys.stderr,
        )
        return 2
    if not has_aac():
        print("Refusing: macOS afconvert is needed to write AAC clips. Run this on a Mac.", file=sys.stderr)
        return 2
    if "GOOGLE_CLOUD_API_KEY" in config.missing_keys():
        print("Refusing: GOOGLE_CLOUD_API_KEY is not set (expected in .env.hosted).", file=sys.stderr)
        return 2
    found = asyncio.run(record(OUT_DIR, MANIFEST, _RealClock(), lines=lines, force=args.force))
    done = sum(len(v) for v in found.values())
    print(f"done: {done} of {total} clips; list written to {MANIFEST.relative_to(ROOT)}")
    return 0 if done == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
