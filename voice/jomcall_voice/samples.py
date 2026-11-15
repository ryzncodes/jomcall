"""Record the voice picker's sample clips: one per voice preset per language.

    npm run voice:samples -- --paid [--force]

Calls Google text-to-speech (the same request the worker makes) with two fixed
sentences and no business or caller text: ten requests in all, a few cents.
Refuses to run without --paid. Needs GOOGLE_CLOUD_API_KEY (read from the
gitignored .env.hosted by the npm script); the key is never printed.

Writes web/public/voice-samples/<voice>-<lang>.m4a (AAC in MP4, which every
current browser plays) and the list of clips that exist to
web/lib/voice-samples.json, which the picker reads. AAC needs macOS
`afconvert` (part of macOS, nothing installed); without it the clips are
written as 16-bit WAV, about ten times larger. Resumable: existing clips are
kept unless --force. A refusal (HTTP 429) stops the run; run it again later.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Callable

from . import config
from .audio import trim_silence
from .voice_out import Voice, VoiceError, VoiceRefused
from .worker import PRESETS

# Neutral fake greetings: no business name, no caller detail.
SENTENCES = {
    "en": "Hi, thanks for calling. How can I help you today?",
    "ms": "Hai, terima kasih kerana menghubungi kami. Boleh saya bantu?",
}

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "web" / "public" / "voice-samples"
MANIFEST = ROOT / "web" / "lib" / "voice-samples.json"

Convert = Callable[[Path, Path], bool]


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(config.TTS_SAMPLE_RATE)
        out.writeframes(pcm)


def afconvert_aac(wav: Path, m4a: Path) -> bool:
    """AAC through macOS afconvert. False when the tool is missing or fails."""
    tool = shutil.which("afconvert")
    if not tool:
        return False
    done = subprocess.run(
        [tool, "-f", "m4af", "-d", "aac", "-b", "32000", str(wav), str(m4a)],
        capture_output=True,
    )
    return done.returncode == 0 and m4a.is_file()


def existing(out_dir: Path) -> dict[str, str]:
    """Clips on disk, keyed '<voice>-<lang>', for known voices and languages."""
    found: dict[str, str] = {}
    for voice in PRESETS:
        for lang in SENTENCES:
            for ext in ("m4a", "wav"):
                name = f"{voice}-{lang}.{ext}"
                if (out_dir / name).is_file():
                    found[f"{voice}-{lang}"] = name
                    break
    return found


def write_manifest(manifest: Path, found: dict[str, str]) -> None:
    manifest.write_text(json.dumps(dict(sorted(found.items())), indent=2) + "\n")


async def record(
    out_dir: Path,
    manifest: Path,
    clock,
    *,
    force: bool = False,
    convert: Convert = afconvert_aac,
    make_voice: Callable[[str], Voice] = Voice,
    say=print,
) -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    found = {} if force else existing(out_dir)
    todo = [(v, lang) for v in PRESETS for lang in SENTENCES if f"{v}-{lang}" not in found]
    interval = 60 / config.PREWARM_MAX_PER_MIN
    try:
        for index, (preset, lang) in enumerate(todo):
            if index:
                await clock.sleep(interval)
            voice = make_voice(preset)
            try:
                pcm = trim_silence(b"".join([c async for c in voice.speak(SENTENCES[lang])]))
            except VoiceRefused:
                say(f"Refused by the speech service. {len(todo) - index} clips remain; run again later.")
                break
            except VoiceError:
                say(f"A request failed. {len(todo) - index} clips remain; run again.")
                break
            finally:
                await voice.aclose()
            key = f"{preset}-{lang}"
            for ext in ("m4a", "wav"):
                (out_dir / f"{key}.{ext}").unlink(missing_ok=True)
            with tempfile.TemporaryDirectory() as tmp:
                wav = Path(tmp) / f"{key}.wav"
                write_wav(wav, pcm)
                if convert(wav, out_dir / f"{key}.m4a"):
                    found[key] = f"{key}.m4a"
                else:
                    shutil.copyfile(wav, out_dir / f"{key}.wav")
                    found[key] = f"{key}.wav"
            say(f"recorded {found[key]}")
    finally:
        write_manifest(manifest, found)
    return found


class _RealClock:
    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jomcall_voice.samples")
    parser.add_argument("--paid", action="store_true", help="confirm the paid Google calls")
    parser.add_argument("--force", action="store_true", help="re-record existing clips")
    args = parser.parse_args(argv)
    if not args.paid:
        print(
            "Refusing: this calls Google text-to-speech ten times (a few cents). "
            "Run again with --paid.",
            file=sys.stderr,
        )
        return 2
    if "GOOGLE_CLOUD_API_KEY" in config.missing_keys():
        print("Refusing: GOOGLE_CLOUD_API_KEY is not set (expected in .env.hosted).", file=sys.stderr)
        return 2
    found = asyncio.run(record(OUT_DIR, MANIFEST, _RealClock(), force=args.force))
    total = len(PRESETS) * len(SENTENCES)
    print(f"done: {len(found)} of {total} clips; list written to {MANIFEST.relative_to(ROOT)}")
    return 0 if len(found) == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
