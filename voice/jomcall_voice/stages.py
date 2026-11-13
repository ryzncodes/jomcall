"""One JSON line per finished turn: when each stage happened, in epoch milliseconds.

Timestamps and flags only. Never a transcript, answer text, token or key.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

from .call import STAGE_FIELDS

log = logging.getLogger("jomcall_voice.stages")
_ROOT = Path(__file__).resolve().parent.parent.parent


def stages_dir() -> Path:
    custom = os.environ.get("JOMCALL_VOICE_STAGES_DIR", "").strip()
    return Path(custom) if custom else _ROOT / "output" / "voice"


class StageWriter:
    def __init__(self, room_name: str, directory: Path | None = None):
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", room_name)[:120] or "room"
        self._path = (directory or stages_dir()) / f"stages-{safe}.jsonl"

    @property
    def path(self) -> Path:
        return self._path

    def __call__(self, record: dict) -> None:
        line = json.dumps({k: record.get(k) for k in STAGE_FIELDS}, separators=(",", ":"))
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
