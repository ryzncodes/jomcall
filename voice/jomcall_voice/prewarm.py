"""Fill `voice/.cache/` with every fixed line for one voice preset.

    python -m jomcall_voice.prewarm --preset Kore [--languages ms,en,manglish,zh]

Resumable (lines already cached are skipped), rate-limited, and stops cleanly
when the speech service refuses. Run by hand, never during a call.
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass

from . import config, fillers
from .voice_out import Voice, VoiceError, VoiceRefused


@dataclass
class PrewarmResult:
    synthesized: int
    skipped: int
    remaining: int
    refused: bool


class _RealClock:
    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


async def prewarm(voice, clock, languages=fillers.LANGUAGES, say=print) -> PrewarmResult:
    lines = fillers.fixed_lines(tuple(languages))
    todo = [x for x in lines if voice.lookup(x) is None]
    skipped = len(lines) - len(todo)
    interval = 60 / config.PREWARM_MAX_PER_MIN
    done = 0
    for index, line in enumerate(todo):
        if done:
            await clock.sleep(interval)
        try:
            await voice.cached(line)
        except VoiceRefused:
            left = len(todo) - index
            say(f"Refused by the speech service. {left} lines remain; run again later.")
            return PrewarmResult(done, skipped, left, True)
        except VoiceError:
            left = len(todo) - index
            say(f"A request failed. {left} lines remain; run again.")
            return PrewarmResult(done, skipped, left, False)
        done += 1
        say(f"cached {done}/{len(todo)}")
    return PrewarmResult(done, skipped, 0, False)


def main() -> None:
    parser = argparse.ArgumentParser(prog="jomcall_voice.prewarm")
    parser.add_argument("--preset", required=True)
    parser.add_argument("--languages", default=",".join(fillers.LANGUAGES))
    args = parser.parse_args()
    languages = tuple(x for x in args.languages.split(",") if x in fillers.LANGUAGES)
    if not languages:
        parser.error("no known language in --languages")
    result = asyncio.run(prewarm(Voice(args.preset), _RealClock(), languages))
    print(f"done: {result.synthesized} new, {result.skipped} already cached, {result.remaining} remaining")


if __name__ == "__main__":
    main()
