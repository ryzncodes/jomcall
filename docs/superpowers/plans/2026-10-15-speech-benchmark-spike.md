# Malaysian Speech Benchmark Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure which speech-to-text options understand Malaysian callers on phone-quality audio, at zero cost, and record a provider decision.

**Architecture:** A throwaway Python harness in `spikes/speech-benchmark/`. Clips (Revolab public set plus the user's own recordings) are optionally passed through a phone-line simulation, sent to each speech-to-text option in its production mode (streaming for cloud providers, per-utterance for local Whisper models), cached per clip, scored with a Malaysian-aware normalizer, and summarized into a committed decision record. A small local text-to-speech comparison is rated blind by the user.

**Tech Stack:** Python 3.13, uv, pytest, jiwer, numpy, soundfile, pandas/pyarrow, huggingface_hub, transformers + torch (MPS) for local models, LiveKit Agents STT plugins (deepgram, assemblyai, speechmatics; optional gladia, elevenlabs), ffmpeg.

**Spec:** `docs/superpowers/specs/2026-10-15-jomcall-design.md` (§9 sub-project 1, §11 assumptions, §12 risks)

## Global Constraints

- Budget: **USD 0.** Only free credits and local models. No account that requires a credit card.
- Cloud providers in scope (no card, verified 2026-10-15): Deepgram ($200 credit), AssemblyAI ($50 credit), Speechmatics ($100 credit). Optional only if sign-up asks for no card: Gladia, ElevenLabs, Soniox.
- API keys and the Hugging Face token are read from environment variables only; never printed, logged, or written to results.
- All audio, per-clip transcripts and model weights stay local and are gitignored. Only aggregate results and the decision record are committed.
- Code is throwaway: lives in `spikes/speech-benchmark/`, never imported by product code.
- All code and copy must be original; do not copy from other products.
- Disk: 17 GB free at start. `HF_HOME` points to `spikes/speech-benchmark/.cache/hf`. Check free space before every model download (stop if under 5 GB).
- Local model or tool setup is timeboxed to 45 minutes each; drop it and record "not run" if it misses the box.

## Review Focus

1. **Provider silently ignores `ms`** and returns English or empty text → empty hypotheses must count as full deletions and the report must flag providers with >20% empty results (test in Task 3).
2. **Revolab Telephony clips get double-degraded** by the phone simulation → simulation must skip clips whose category is Telephony (test in Task 2).
3. **Free credit overrun** → a run must refuse to start when estimated cost exceeds remaining credit, and cached clips must not be re-sent (test in Task 4).
4. **Over-reading small groups** → every results cell shows clip count and a 95% bootstrap interval; groups under 30 clips are marked "low n" (test in Task 3).
5. **Personal data leaking into git** → `.gitignore` covers audio, parquet and per-clip results; the summary contains no transcripts (test in Task 1 and Task 7).

---

## Task 0: User-only setup (the user does these; the agent cannot)

- [ ] **Step 1:** Create free accounts (no card) and API keys: Deepgram, AssemblyAI, Speechmatics. Optional: Gladia, ElevenLabs, Soniox; skip any that asks for a card.
- [ ] **Step 2:** Create a free Hugging Face account, open `https://huggingface.co/datasets/Revolab/ASR-Benchmark-Public`, accept the access conditions, and create a read token.
- [ ] **Step 3:** After Task 1 exists, copy `spikes/speech-benchmark/.env.example` to `.env` and fill in keys, token, and remaining credit per provider. Do not paste keys into chat.
- [ ] **Step 4:** Record own clips (Task 5 script). Each speaker gives spoken or written consent to being recorded for this test. Use only the fake names, numbers and addresses in the script.

---

## Task 1: Harness scaffold and data hygiene

**Files:**
- Modify: `.gitignore`
- Create: `spikes/speech-benchmark/README.md`
- Create: `spikes/speech-benchmark/pyproject.toml`
- Create: `spikes/speech-benchmark/.env.example`
- Create: `spikes/speech-benchmark/bench/__init__.py`
- Test: `spikes/speech-benchmark/tests/test_gitignore.py`

**Interfaces:**
- Produces: package `bench`; directories `data/` (audio), `results/raw/` (per-clip, ignored), `results/summary/` (committed).

- [ ] **Step 1: Write the failing test**

```python
# spikes/speech-benchmark/tests/test_gitignore.py
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def is_ignored(rel: str) -> bool:
    r = subprocess.run(["git", "check-ignore", "-q", rel], cwd=ROOT)
    return r.returncode == 0

def test_audio_data_and_raw_results_are_ignored():
    for rel in [
        "spikes/speech-benchmark/data/revolab/x.parquet",
        "spikes/speech-benchmark/data/own/clip.m4a",
        "spikes/speech-benchmark/data/own/clip.flac",
        "spikes/speech-benchmark/results/raw/deepgram.jsonl",
        "spikes/speech-benchmark/.cache/hf/model.bin",
        "spikes/speech-benchmark/.env",
    ]:
        assert is_ignored(rel), rel

def test_summary_is_not_ignored():
    assert not is_ignored("spikes/speech-benchmark/results/summary/results.md")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spikes/speech-benchmark && uv run --with pytest pytest tests/test_gitignore.py -v`
Expected: FAIL on `.parquet` / `.m4a` / `results/raw`.

- [ ] **Step 3: Implement**

Append to `.gitignore`:

```gitignore
# Speech benchmark spike: local data only
*.parquet
*.m4a
*.flac
*.ogg
*.opus
*.aac
spikes/speech-benchmark/data/
spikes/speech-benchmark/results/raw/
spikes/speech-benchmark/.cache/
```

`spikes/speech-benchmark/pyproject.toml`:

```toml
[project]
name = "speech-benchmark"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = [
  "jiwer>=3.0",
  "numpy",
  "soundfile",
  "pandas",
  "pyarrow",
  "huggingface_hub",
  "python-dotenv",
]

[project.optional-dependencies]
cloud = [
  "livekit-agents",
  "livekit-plugins-deepgram",
  "livekit-plugins-assemblyai",
  "livekit-plugins-speechmatics",
  "aiohttp",
]
local = ["torch", "transformers", "accelerate"]
dev = ["pytest", "pytest-asyncio"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

`spikes/speech-benchmark/.env.example`:

```dotenv
# Copy to .env. Never commit .env.
HF_TOKEN=
HF_HOME=./.cache/hf
DEEPGRAM_API_KEY=
ASSEMBLYAI_API_KEY=
SPEECHMATICS_API_KEY=
# Remaining free credit in USD, checked before each run
CREDIT_DEEPGRAM_USD=200
CREDIT_ASSEMBLYAI_USD=50
CREDIT_SPEECHMATICS_USD=100
```

`spikes/speech-benchmark/README.md`:

```markdown
# Speech benchmark (throwaway spike)

Measures speech-to-text options on Malaysian speech at phone quality.
Code here is throwaway and must not be imported by product code.
Results feed `docs/decisions/0001-speech-providers.md`.

Setup: `uv sync --extra dev --extra cloud --extra local`, then copy `.env.example` to `.env`.
Audio and per-clip results stay local (gitignored). Only `results/summary/` is committed.
```

Create empty `bench/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spikes/speech-benchmark && uv run --with pytest pytest tests/test_gitignore.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .gitignore spikes/speech-benchmark
git commit -m "chore(spike): scaffold speech benchmark harness"
```

---

## Task 2: Clips, dataset loading and phone simulation

**Files:**
- Create: `spikes/speech-benchmark/bench/clips.py`
- Create: `spikes/speech-benchmark/bench/phone.py`
- Create: `spikes/speech-benchmark/bench/datasets.py`
- Test: `spikes/speech-benchmark/tests/test_phone.py`

**Interfaces:**
- Produces:
  - `Clip(id: str, source: str, category: str, lang: str, text: str, pcm16k: numpy.ndarray[int16], duration_s: float)`
  - `simulate_phone(pcm16k: np.ndarray) -> np.ndarray` (int16, 16 kHz, after 8 kHz μ-law round trip)
  - `prepare(clip: Clip, condition: Literal["clean", "phone"]) -> np.ndarray` (skips simulation for category `Telephony`)
  - `load_revolab(limit: int | None = None) -> list[Clip]`
  - `load_own(manifest: Path) -> list[Clip]`

- [ ] **Step 1: Write the failing test**

```python
# spikes/speech-benchmark/tests/test_phone.py
import numpy as np
from bench.clips import Clip
from bench.phone import simulate_phone, prepare

def tone(seconds=1.0, hz=440):
    t = np.arange(int(16000 * seconds)) / 16000
    return (np.sin(2 * np.pi * hz * t) * 8000).astype(np.int16)

def test_phone_simulation_keeps_length_and_removes_high_band():
    x = tone(1.0, 6000)  # above the 4 kHz phone band
    y = simulate_phone(x)
    assert y.dtype == np.int16
    assert abs(len(y) - len(x)) < 50
    assert np.abs(y).mean() < np.abs(x).mean() * 0.2

def test_prepare_skips_telephony_clips():
    x = tone()
    clip = Clip(id="a", source="revolab", category="Telephony", lang="ms",
                text="", pcm16k=x, duration_s=1.0)
    assert np.array_equal(prepare(clip, "phone"), x)

def test_prepare_clean_returns_original():
    x = tone()
    clip = Clip(id="b", source="own", category="manglish", lang="mixed",
                text="", pcm16k=x, duration_s=1.0)
    assert np.array_equal(prepare(clip, "clean"), x)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_phone.py -v`
Expected: FAIL with `ModuleNotFoundError: bench.clips`

- [ ] **Step 3: Implement**

```python
# bench/clips.py
from dataclasses import dataclass
import numpy as np

@dataclass(frozen=True)
class Clip:
    id: str
    source: str        # "revolab" | "own"
    category: str      # Revolab category or own-script group
    lang: str          # "ms" | "en" | "zh" | "mixed"
    text: str          # reference transcript
    pcm16k: np.ndarray # int16 mono 16 kHz
    duration_s: float
```

```python
# bench/phone.py
import subprocess
from typing import Literal
import numpy as np
from bench.clips import Clip

def _ffmpeg(args: list[str], data: bytes) -> bytes:
    r = subprocess.run(["ffmpeg", "-loglevel", "error", *args], input=data,
                       stdout=subprocess.PIPE, check=True)
    return r.stdout

def simulate_phone(pcm16k: np.ndarray) -> np.ndarray:
    """8 kHz G.711 mu-law round trip, returned as 16 kHz int16."""
    mulaw = _ffmpeg(["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "pipe:0",
                     "-ar", "8000", "-ac", "1", "-f", "mulaw", "pipe:1"],
                    pcm16k.astype(np.int16).tobytes())
    back = _ffmpeg(["-f", "mulaw", "-ar", "8000", "-ac", "1", "-i", "pipe:0",
                    "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"], mulaw)
    return np.frombuffer(back, dtype=np.int16)

def prepare(clip: Clip, condition: Literal["clean", "phone"]) -> np.ndarray:
    if condition == "clean" or clip.category.lower() == "telephony":
        return clip.pcm16k
    return simulate_phone(clip.pcm16k)
```

```python
# bench/datasets.py
import io, json, os
from pathlib import Path
import numpy as np, pandas as pd, soundfile as sf
from huggingface_hub import snapshot_download
from bench.clips import Clip

REVOLAB = "Revolab/ASR-Benchmark-Public"

def _to_pcm16k(raw: bytes) -> np.ndarray:
    audio, sr = sf.read(io.BytesIO(raw), dtype="int16", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1).astype(np.int16)
    if sr != 16000:
        from bench.phone import _ffmpeg
        audio = np.frombuffer(_ffmpeg(
            ["-f", "s16le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
             "-ar", "16000", "-f", "s16le", "pipe:1"], audio.tobytes()), dtype=np.int16)
    return audio

def load_revolab(limit: int | None = None) -> list[Clip]:
    path = snapshot_download(REVOLAB, repo_type="dataset",
                             token=os.environ["HF_TOKEN"],
                             local_dir=Path("data/revolab"))
    frames = [pd.read_parquet(p) for p in sorted(Path(path).rglob("*.parquet"))]
    df = pd.concat(frames, ignore_index=True)
    clips = []
    for row in df.itertuples():
        pcm = _to_pcm16k(row.audio["bytes"])
        clips.append(Clip(id=f"rv-{row.id}", source="revolab", category=str(row.category),
                          lang="mixed", text=str(row.text), pcm16k=pcm,
                          duration_s=len(pcm) / 16000))
        if limit and len(clips) >= limit:
            break
    return clips

def load_own(manifest: Path) -> list[Clip]:
    """manifest.jsonl rows: {"id","file","category","lang","text"}; files relative to manifest."""
    clips = []
    for line in manifest.read_text().splitlines():
        m = json.loads(line)
        pcm = _to_pcm16k((manifest.parent / m["file"]).read_bytes())
        clips.append(Clip(id=f"own-{m['id']}", source="own", category=m["category"],
                          lang=m["lang"], text=m["text"], pcm16k=pcm,
                          duration_s=len(pcm) / 16000))
    return clips
```

Note: `soundfile` cannot read `.m4a`. Own recordings are converted to WAV in Task 5 before loading.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_phone.py -v`
Expected: PASS

- [ ] **Step 5: Inspect Revolab once (requires Task 0 Step 2)**

Run:
```bash
cd spikes/speech-benchmark && uv run python -c "
from dotenv import load_dotenv; load_dotenv()
from bench.datasets import load_revolab
from collections import Counter
c = load_revolab()
print(len(c), round(sum(x.duration_s for x in c)/3600, 2), 'h')
print(Counter(x.category for x in c))"
```
Expected: about 820 clips, about 2.2 h, 12 categories including `Telephony`. If the category value for phone audio is spelled differently, change the `"telephony"` comparison in `prepare` and rerun the test.

- [ ] **Step 6: Commit**

```bash
git add spikes/speech-benchmark/bench spikes/speech-benchmark/tests/test_phone.py
git commit -m "feat(spike): clip loading and phone-line simulation"
```

---

## Task 3: Malaysian normalizer and scorer

**Files:**
- Create: `spikes/speech-benchmark/bench/normalize.py`
- Create: `spikes/speech-benchmark/bench/score.py`
- Test: `spikes/speech-benchmark/tests/test_normalize.py`
- Test: `spikes/speech-benchmark/tests/test_score.py`

**Interfaces:**
- Produces:
  - `normalize(text: str) -> str`
  - `tokens(text: str) -> list[str]` (Latin words as tokens, each CJK character as a token)
  - `ClipScore(errors: int, ref_len: int, entities_total: int, entities_hit: int, empty: bool)`
  - `score_clip(ref: str, hyp: str) -> ClipScore`
  - `aggregate(scores: list[ClipScore], seed: int = 0) -> dict` with keys `n, error_rate, ci_low, ci_high, entity_acc, empty_rate, low_n`

- [ ] **Step 1: Write the failing tests**

```python
# spikes/speech-benchmark/tests/test_normalize.py
from bench.normalize import normalize, tokens

def test_lowercase_and_punctuation():
    assert normalize("Boleh, saya BOOK esok?") == "boleh saya book esok"

def test_sms_spelling_variants():
    assert normalize("sy x dpt dtg, nk tukar") == "saya tak dapat datang nak tukar"

def test_phone_number_spoken_digit_by_digit():
    assert normalize("nombor saya kosong satu dua tiga empat lima enam tujuh lapan sembilan") \
        == "nombor saya 0123456789"

def test_phone_number_written_with_separators():
    assert normalize("call 012-345 6789 ok") == "call 0123456789 ok"

def test_malay_compound_numbers():
    assert normalize("dua ratus lima puluh ringgit") == "250 ringgit"
    assert normalize("seribu dua ratus") == "1200"
    assert normalize("dua belas orang") == "12 orang"
    assert normalize("sepuluh pagi") == "10 pagi"

def test_english_digits_in_manglish():
    assert normalize("my number is zero one two three") == "my number is 0123"

def test_single_number_word_stays_numeric():
    assert normalize("satu orang je") == "1 orang je"

def test_cjk_tokens_are_characters():
    assert tokens(normalize("我想预约 tomorrow")) == ["我", "想", "预", "约", "tomorrow"]
```

```python
# spikes/speech-benchmark/tests/test_score.py
from bench.score import score_clip, aggregate, ClipScore

def test_perfect_match():
    s = score_clip("saya nak tempah esok", "Saya nak tempah esok.")
    assert s.errors == 0 and s.ref_len == 4

def test_variant_spelling_is_not_an_error():
    assert score_clip("saya tak dapat datang", "sy x dpt dtg").errors == 0

def test_empty_hypothesis_counts_every_word_and_flags_empty():
    s = score_clip("saya nak tempah esok", "")
    assert s.errors == 4 and s.empty

def test_entity_accuracy_on_phone_numbers():
    s = score_clip("nombor saya kosong satu dua tiga empat lima",
                   "nombor saya 012345")
    assert (s.entities_total, s.entities_hit) == (1, 1)
    s2 = score_clip("nombor saya kosong satu dua tiga empat lima",
                    "nombor saya 012 346")
    assert s2.entities_hit == 0

def test_mandarin_scored_by_character():
    s = score_clip("我想预约", "我想预定")
    assert s.ref_len == 4 and s.errors == 1

def test_aggregate_marks_low_n_and_has_interval():
    scores = [ClipScore(1, 10, 0, 0, False)] * 12
    a = aggregate(scores)
    assert a["n"] == 12 and a["low_n"] is True
    assert a["ci_low"] <= a["error_rate"] <= a["ci_high"]
    assert abs(a["error_rate"] - 0.1) < 1e-9

def test_aggregate_empty_rate():
    scores = [ClipScore(4, 4, 0, 0, True)] * 3 + [ClipScore(0, 4, 0, 0, False)] * 37
    assert abs(aggregate(scores)["empty_rate"] - 0.075) < 1e-9
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_normalize.py tests/test_score.py -v`
Expected: FAIL with `ModuleNotFoundError: bench.normalize`

- [ ] **Step 3: Implement**

```python
# bench/normalize.py
import re
import unicodedata

VARIANTS = {
    "x": "tak", "tk": "tak", "nk": "nak", "sy": "saya", "dpt": "dapat",
    "dtg": "datang", "utk": "untuk", "dgn": "dengan", "yg": "yang",
    "okay": "ok", "okey": "ok",
}
DIGITS = {
    "kosong": 0, "sifar": 0, "satu": 1, "dua": 2, "tiga": 3, "empat": 4,
    "lima": 5, "enam": 6, "tujuh": 7, "lapan": 8, "sembilan": 9,
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
}
SPECIAL = {"sepuluh": 10, "sebelas": 11, "seratus": 100, "seribu": 1000}
MULT = {"puluh": 10, "ratus": 100, "ribu": 1000}
CJK = re.compile(r"[㐀-鿿豈-﫿]")

def _is_num_word(w: str) -> bool:
    return w in DIGITS or w in SPECIAL or w in MULT or w == "belas"

def _value(words: list[str]) -> int:
    total, current = 0, 0
    for w in words:
        if w in DIGITS:
            current += DIGITS[w]
        elif w in SPECIAL:
            v = SPECIAL[w]
            if v >= 100:
                total += current * v if current else v
                current = 0
            else:
                current += v
        elif w == "belas":
            current = (current or 1) + 10
        elif w in MULT:
            m = MULT[w]
            if m == 10:
                current = (current or 1) * 10
            else:
                total += (current or 1) * m
                current = 0
    return total + current

def _numbers(words: list[str]) -> list[str]:
    out, i = [], 0
    while i < len(words):
        if not _is_num_word(words[i]):
            out.append(words[i]); i += 1; continue
        j = i
        while j < len(words) and _is_num_word(words[j]):
            j += 1
        run = words[i:j]
        if len(run) > 1 and all(w in DIGITS for w in run):
            out.append("".join(str(DIGITS[w]) for w in run))  # digit-by-digit
        else:
            out.append(str(_value(run)))
        i = j
    return out

def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    t = re.sub(r"(?<=\d)[\s\-.](?=\d)", "", t)           # 012-345 6789 -> 0123456789
    t = CJK.sub(lambda m: f" {m.group(0)} ", t)
    t = re.sub(r"[^\w\s]", " ", t)
    words = [VARIANTS.get(w, w) for w in t.split()]
    return " ".join(_numbers(words))

def tokens(text: str) -> list[str]:
    return text.split()
```

```python
# bench/score.py
from dataclasses import dataclass
import re
import numpy as np
import jiwer
from bench.normalize import normalize, tokens

@dataclass(frozen=True)
class ClipScore:
    errors: int
    ref_len: int
    entities_total: int
    entities_hit: int
    empty: bool

def _entities(text: str) -> list[str]:
    return re.findall(r"\b\d{3,}\b", text)

def score_clip(ref: str, hyp: str) -> ClipScore:
    r, h = normalize(ref), normalize(hyp)
    rt, ht = tokens(r), tokens(h)
    if not ht:
        errors = len(rt)
    else:
        o = jiwer.process_words(" ".join(rt), " ".join(ht))
        errors = o.substitutions + o.deletions + o.insertions
    ents = _entities(r)
    hyp_ents = set(_entities(h))
    return ClipScore(errors=errors, ref_len=len(rt), entities_total=len(ents),
                     entities_hit=sum(1 for e in ents if e in hyp_ents),
                     empty=not ht)

def aggregate(scores: list[ClipScore], seed: int = 0, reps: int = 1000) -> dict:
    n = len(scores)
    err = np.array([s.errors for s in scores], dtype=float)
    ref = np.array([s.ref_len for s in scores], dtype=float)
    rate = err.sum() / max(ref.sum(), 1)
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(reps):
        idx = rng.integers(0, n, n)
        boots.append(err[idx].sum() / max(ref[idx].sum(), 1))
    ent_t = sum(s.entities_total for s in scores)
    ent_h = sum(s.entities_hit for s in scores)
    return {
        "n": n,
        "error_rate": rate,
        "ci_low": min(float(np.percentile(boots, 2.5)), rate),
        "ci_high": max(float(np.percentile(boots, 97.5)), rate),
        "entity_acc": (ent_h / ent_t) if ent_t else None,
        "empty_rate": sum(s.empty for s in scores) / n if n else 0.0,
        "low_n": n < 30,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_normalize.py tests/test_score.py -v`
Expected: PASS. If a number case fails, fix `_value` / `_numbers` (not the test); these cases are the booking-critical ones.

- [ ] **Step 5: Commit**

```bash
git add spikes/speech-benchmark/bench/normalize.py spikes/speech-benchmark/bench/score.py spikes/speech-benchmark/tests/test_normalize.py spikes/speech-benchmark/tests/test_score.py
git commit -m "feat(spike): Malaysian-aware normalizer and scorer"
```

---

## Task 4: Run cache and credit guard

**Files:**
- Create: `spikes/speech-benchmark/bench/runlog.py`
- Test: `spikes/speech-benchmark/tests/test_runlog.py`

**Interfaces:**
- Produces:
  - `estimate_cost_usd(clips: list[Clip], rate_per_min: float) -> float`
  - `check_credit(provider: str, cost: float) -> None` (raises `CreditExceeded` if `cost` > env `CREDIT_<PROVIDER>_USD`; local providers pass `rate_per_min=0`)
  - `RunLog(path: Path)` with `.done() -> set[str]`, `.append(row: dict) -> None`, `.rows() -> list[dict]`. Row keys: `clip_id, hyp, latency_ms, error` (no audio, no reference text).

- [ ] **Step 1: Write the failing test**

```python
# spikes/speech-benchmark/tests/test_runlog.py
import numpy as np, pytest
from bench.clips import Clip
from bench.runlog import estimate_cost_usd, check_credit, CreditExceeded, RunLog

def clip(sec):
    return Clip(id=f"c{sec}", source="own", category="x", lang="ms", text="",
                pcm16k=np.zeros(int(16000 * sec), np.int16), duration_s=sec)

def test_estimate_cost():
    assert estimate_cost_usd([clip(60), clip(120)], 0.01) == pytest.approx(0.03)

def test_credit_guard_refuses_overrun(monkeypatch):
    monkeypatch.setenv("CREDIT_DEEPGRAM_USD", "0.02")
    with pytest.raises(CreditExceeded):
        check_credit("deepgram", 0.03)

def test_credit_guard_requires_env(monkeypatch):
    monkeypatch.delenv("CREDIT_SPEECHMATICS_USD", raising=False)
    with pytest.raises(CreditExceeded):
        check_credit("speechmatics", 0.01)

def test_local_providers_skip_credit_check(monkeypatch):
    check_credit("local-whisper", 0.0)

def test_runlog_skips_done_clips(tmp_path):
    log = RunLog(tmp_path / "r.jsonl")
    log.append({"clip_id": "a", "hyp": "x", "latency_ms": 10, "error": None})
    assert log.done() == {"a"}
    assert RunLog(tmp_path / "r.jsonl").rows()[0]["hyp"] == "x"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_runlog.py -v`
Expected: FAIL with `ModuleNotFoundError: bench.runlog`

- [ ] **Step 3: Implement**

```python
# bench/runlog.py
import json, os
from pathlib import Path
from bench.clips import Clip

class CreditExceeded(RuntimeError):
    pass

def estimate_cost_usd(clips: list[Clip], rate_per_min: float) -> float:
    return sum(c.duration_s for c in clips) / 60 * rate_per_min

def check_credit(provider: str, cost: float) -> None:
    if cost == 0:
        return
    raw = os.environ.get(f"CREDIT_{provider.upper().replace('-', '_')}_USD")
    if raw is None:
        raise CreditExceeded(f"Set CREDIT_{provider.upper()}_USD before running {provider}")
    if cost > float(raw):
        raise CreditExceeded(f"{provider}: estimated ${cost:.2f} exceeds credit ${float(raw):.2f}")

class RunLog:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)

    def rows(self) -> list[dict]:
        if not self.path.exists():
            return []
        return [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()]

    def done(self) -> set[str]:
        return {r["clip_id"] for r in self.rows() if r.get("error") is None}

    def append(self, row: dict) -> None:
        with self.path.open("a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_runlog.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add spikes/speech-benchmark/bench/runlog.py spikes/speech-benchmark/tests/test_runlog.py
git commit -m "feat(spike): per-clip run cache and free-credit guard"
```

---

## Task 5: Own recording script and conversion

**Files:**
- Create: `spikes/speech-benchmark/prompts/recording-script.md`
- Create: `spikes/speech-benchmark/bench/own_manifest.py`

**Interfaces:**
- Consumes: `load_own(manifest)` from Task 2.
- Produces: `data/own/manifest.jsonl` and WAV files (local only).

- [ ] **Step 1: Write the recording script** (fake data only). Groups and counts:

```markdown
# Recording script (fake data only, about 100 clips)

Before recording, each speaker says: "Saya setuju rakaman ini digunakan untuk ujian." (consent).
Record on a phone voice-memo app, normal speaking pace, a little background noise is fine.
File name = line id (e.g. `ms-01.m4a`).

## ms (Malay, 25)
ms-01 Saya nak buat temujanji untuk hari Khamis pukul tiga petang.
ms-02 Klinik buka pukul berapa hari Sabtu?
... (25 lines covering bookings, opening hours, prices, directions)

## mixed (Manglish, 25)
mx-01 Hi, can I book appointment esok pagi, around ten macam tu?
mx-02 Eh sorry, I nak cancel booking yang Isnin tu, boleh tak?
... (25 lines)

## zh (Malaysian Mandarin, 20)
zh-01 你好，我想预约明天早上十点。
zh-02 请问星期六有开吗？
... (20 lines)

## numbers (15): phone numbers, prices, times
nm-01 Nombor saya kosong satu dua, tiga empat lima, enam tujuh lapan sembilan.
nm-02 Harga dia dua ratus lima puluh ringgit kan?
... (15 lines)

## names-places (15): fake names, real place names
np-01 Nama saya Siti Aminah binti Rahman, dari Shah Alam.
np-02 Saya duduk dekat Jalan Ampang, area KLCC.
... (15 lines)
```

The executor writes all 100 lines in full; the reference text of each clip is its script line exactly.

- [ ] **Step 2: Write the manifest builder**

```python
# bench/own_manifest.py
"""Convert recordings in data/own/raw/*.m4a to WAV and build manifest.jsonl from the script."""
import json, re, subprocess, sys
from pathlib import Path

GROUP = {"ms": ("ms", "ms"), "mx": ("mixed", "mixed"), "zh": ("zh", "zh"),
         "nm": ("numbers", "mixed"), "np": ("names-places", "mixed")}

def main(script: Path, raw_dir: Path, out_dir: Path) -> None:
    lines = dict(re.findall(r"^((?:ms|mx|zh|nm|np)-\d+)\s+(.+)$", script.read_text(), re.M))
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for src in sorted(raw_dir.glob("*")):
        cid = src.stem
        if cid not in lines:
            print(f"skip {src.name}: id not in script", file=sys.stderr); continue
        wav = out_dir / f"{cid}.wav"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src),
                        "-ac", "1", "-ar", "16000", str(wav)], check=True)
        category, lang = GROUP[cid.split("-")[0]]
        rows.append({"id": cid, "file": wav.name, "category": category,
                     "lang": lang, "text": lines[cid]})
    (out_dir / "manifest.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    print(f"{len(rows)} clips")

if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
```

- [ ] **Step 3: Verify after the user records** (Task 0 Step 4)

Run: `cd spikes/speech-benchmark && uv run python -m bench.own_manifest prompts/recording-script.md data/own/raw data/own`
Expected: `N clips` with N close to 100; every skipped file printed by name.

- [ ] **Step 4: Commit** (script and code only; audio is ignored)

```bash
git add spikes/speech-benchmark/prompts spikes/speech-benchmark/bench/own_manifest.py
git commit -m "feat(spike): recording script and own-clip manifest builder"
```

---

## Task 6: Speech-to-text adapters with one-clip smoke tests

**Files:**
- Create: `spikes/speech-benchmark/bench/providers.py`
- Create: `spikes/speech-benchmark/bench/run.py`
- Test: `spikes/speech-benchmark/tests/test_smoke.py` (marked `smoke`, needs keys, run manually)

**Interfaces:**
- Consumes: `Clip`, `prepare`, `RunLog`, `estimate_cost_usd`, `check_credit`.
- Produces:
  - `Setting(provider: str, label: str, mode: Literal["streaming", "utterance", "batch"], rate_per_min: float, language: str | None, license: str)`
  - `SETTINGS: dict[str, Setting]` keyed `"<provider>:<label>"`
  - `async transcribe(setting: Setting, pcm16k: np.ndarray) -> tuple[str, float]` returning `(text, latency_ms)` where latency is time from the last audio frame sent to the final transcript (streaming) or processing time for the whole utterance (local).
  - CLI: `python -m bench.run <setting-key> --source revolab|own --condition clean|phone [--limit N]`

Settings to define (two language modes per provider where the provider supports them):

| Key | Mode | Language | Rate USD/min | Notes |
|---|---|---|---|---|
| `deepgram:nova3-ms` | streaming | `ms` | 0.0048 | `multi` has no Malay, so no auto row |
| `assemblyai:stream-ms` | streaming | Malay-capable streaming model | per account page | If the plugin only exposes English-family streaming models, record "no Malay streaming path" and stop |
| `speechmatics:ms` | streaming | `ms` | 0.40/60 | |
| `speechmatics:en_ms` | streaming | bilingual `en_ms` pack | 0.40/60 | code-switching |
| `local:whisper-turbo-ms` | utterance | `ms` | 0 | `openai/whisper-large-v3-turbo` on MPS |
| `local:whisper-turbo-auto` | utterance | auto | 0 | |
| `local:mesolitica-turbo-auto` | utterance | auto | 0 | `mesolitica/Malaysian-whisper-large-v3-turbo-v3`, license unknown |

- [ ] **Step 1: Verify plugin constructor names before writing adapters**

Run:
```bash
cd spikes/speech-benchmark && uv sync --extra dev --extra cloud --extra local && uv run python -c "
import inspect
from livekit.plugins import deepgram, assemblyai, speechmatics
for m in (deepgram, assemblyai, speechmatics):
    print(m.__name__, inspect.signature(m.STT.__init__))"
```
Expected: printed signatures. Use the exact parameter names printed (e.g. `model`, `language`, `http_session`) in Step 2; if a plugin has no way to select Malay, mark its setting as unsupported instead of forcing it.

- [ ] **Step 2: Implement adapters**

```python
# bench/providers.py
import asyncio, time
from dataclasses import dataclass
from typing import Literal
import numpy as np

@dataclass(frozen=True)
class Setting:
    provider: str
    label: str
    mode: Literal["streaming", "utterance", "batch"]
    rate_per_min: float
    language: str | None
    license: str

SETTINGS = {
    "deepgram:nova3-ms": Setting("deepgram", "nova3-ms", "streaming", 0.0048, "ms", "commercial API"),
    "speechmatics:ms": Setting("speechmatics", "ms", "streaming", 0.40 / 60, "ms", "commercial API"),
    "speechmatics:en_ms": Setting("speechmatics", "en_ms", "streaming", 0.40 / 60, "en_ms", "commercial API"),
    "assemblyai:stream-ms": Setting("assemblyai", "stream-ms", "streaming", 0.15 / 60, "ms", "commercial API"),
    "local:whisper-turbo-ms": Setting("local", "whisper-turbo-ms", "utterance", 0.0, "ms", "MIT"),
    "local:whisper-turbo-auto": Setting("local", "whisper-turbo-auto", "utterance", 0.0, None, "MIT"),
    "local:mesolitica-turbo-auto": Setting("local", "mesolitica-turbo-auto", "utterance", 0.0, None, "unknown"),
}

LOCAL_MODELS = {
    "whisper-turbo-ms": "openai/whisper-large-v3-turbo",
    "whisper-turbo-auto": "openai/whisper-large-v3-turbo",
    "mesolitica-turbo-auto": "mesolitica/Malaysian-whisper-large-v3-turbo-v3",
}

_pipes: dict[str, object] = {}

def _local_pipe(model_id: str):
    if model_id not in _pipes:
        from transformers import pipeline
        _pipes[model_id] = pipeline("automatic-speech-recognition", model=model_id, device="mps")
    return _pipes[model_id]

def _local(setting: Setting, pcm16k: np.ndarray) -> tuple[str, float]:
    pipe = _local_pipe(LOCAL_MODELS[setting.label])
    audio = pcm16k.astype(np.float32) / 32768.0
    kwargs = {"language": setting.language} if setting.language else {}
    t0 = time.perf_counter()
    out = pipe({"raw": audio, "sampling_rate": 16000}, generate_kwargs=kwargs)
    return out["text"], (time.perf_counter() - t0) * 1000

def _plugin_stt(setting: Setting, session):
    # Parameter names come from Step 1's printed signatures.
    if setting.provider == "deepgram":
        from livekit.plugins import deepgram
        return deepgram.STT(model="nova-3", language="ms", http_session=session)
    if setting.provider == "speechmatics":
        from livekit.plugins import speechmatics
        return speechmatics.STT(language=setting.language, http_session=session)
    if setting.provider == "assemblyai":
        from livekit.plugins import assemblyai
        return assemblyai.STT(http_session=session)
    raise ValueError(setting.provider)

async def _streaming(setting: Setting, pcm16k: np.ndarray) -> tuple[str, float]:
    import aiohttp
    from livekit import rtc
    from livekit.agents import stt as lk_stt
    async with aiohttp.ClientSession() as session:
        engine = _plugin_stt(setting, session)
        stream = engine.stream()
        finals: list[str] = []
        done = asyncio.Event()
        last_sent = 0.0

        async def reader():
            async for ev in stream:
                if ev.type == lk_stt.SpeechEventType.FINAL_TRANSCRIPT and ev.alternatives:
                    finals.append(ev.alternatives[0].text)
            done.set()

        task = asyncio.create_task(reader())
        chunk = 160  # 10 ms at 16 kHz
        for i in range(0, len(pcm16k), chunk):
            data = pcm16k[i:i + chunk]
            stream.push_frame(rtc.AudioFrame(data=data.tobytes(), sample_rate=16000,
                                             num_channels=1, samples_per_channel=len(data)))
            await asyncio.sleep(0.01)  # real-time pace
        last_sent = time.perf_counter()
        stream.end_input()
        await asyncio.wait_for(done.wait(), timeout=30)
        latency = (time.perf_counter() - last_sent) * 1000
        await stream.aclose()
        await task
        return " ".join(finals).strip(), latency

async def transcribe(setting: Setting, pcm16k: np.ndarray) -> tuple[str, float]:
    if setting.mode == "utterance":
        return await asyncio.to_thread(_local, setting, pcm16k)
    return await _streaming(setting, pcm16k)
```

```python
# bench/run.py
import argparse, asyncio
from pathlib import Path
from dotenv import load_dotenv
from bench.providers import SETTINGS, transcribe
from bench.phone import prepare
from bench.runlog import RunLog, estimate_cost_usd, check_credit
from bench.datasets import load_revolab, load_own

async def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("setting", choices=sorted(SETTINGS))
    ap.add_argument("--source", choices=["revolab", "own"], required=True)
    ap.add_argument("--condition", choices=["clean", "phone"], required=True)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    s = SETTINGS[a.setting]
    clips = load_revolab(a.limit) if a.source == "revolab" else load_own(Path("data/own/manifest.jsonl"))
    if a.limit:
        clips = clips[: a.limit]
    log = RunLog(Path(f"results/raw/{a.setting.replace(':', '__')}__{a.source}__{a.condition}.jsonl"))
    todo = [c for c in clips if c.id not in log.done()]
    cost = estimate_cost_usd(todo, s.rate_per_min)
    check_credit(s.provider, cost)
    print(f"{a.setting}: {len(todo)} clips, est ${cost:.2f}")
    for c in todo:
        try:
            hyp, ms = await transcribe(s, prepare(c, a.condition))
            log.append({"clip_id": c.id, "hyp": hyp, "latency_ms": round(ms), "error": None})
        except Exception as e:  # record and continue; the clip is retried next run
            log.append({"clip_id": c.id, "hyp": "", "latency_ms": None, "error": type(e).__name__})

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: One-clip smoke test per setting**

```python
# spikes/speech-benchmark/tests/test_smoke.py
import os, pytest
from dotenv import load_dotenv
from bench.datasets import load_own
from bench.providers import SETTINGS, transcribe
from pathlib import Path

load_dotenv()
pytestmark = pytest.mark.skipif(not Path("data/own/manifest.jsonl").exists(),
                                reason="needs own recordings")

@pytest.mark.parametrize("key", sorted(SETTINGS))
async def test_one_clip_returns_text(key):
    s = SETTINGS[key]
    if s.provider != "local" and not os.environ.get(f"{s.provider.upper()}_API_KEY"):
        pytest.skip("no key")
    clip = next(c for c in load_own(Path("data/own/manifest.jsonl")) if c.id == "own-ms-01")
    text, ms = await transcribe(s, clip.pcm16k)
    print(key, ms, text)
    assert text.strip(), f"{key} returned empty text for a Malay clip"
```

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_smoke.py -v -s`
Expected: each configured setting prints a Malay transcript. Any setting that errors or returns empty after one fix attempt is removed from `SETTINGS` and recorded as "not supported" with the error name. Local model setup is timeboxed to 45 minutes each.

- [ ] **Step 4: Commit**

```bash
git add spikes/speech-benchmark/bench/providers.py spikes/speech-benchmark/bench/run.py spikes/speech-benchmark/tests/test_smoke.py
git commit -m "feat(spike): streaming and local speech-to-text adapters"
```

---

## Task 7: Full runs and summary report

**Files:**
- Create: `spikes/speech-benchmark/bench/report.py`
- Test: `spikes/speech-benchmark/tests/test_report.py`
- Create (generated, committed): `spikes/speech-benchmark/results/summary/results.md`

**Interfaces:**
- Consumes: `RunLog`, `score_clip`, `aggregate`, `SETTINGS`, clip loaders.
- Produces: `render(rows: list[dict]) -> str` where each row is `{"setting", "source", "condition", "group", **aggregate(...), "latency_p50", "latency_p95", "rate_per_min", "license", "mode"}`.

- [ ] **Step 1: Write the failing test**

```python
# spikes/speech-benchmark/tests/test_report.py
from bench.report import render

ROW = {"setting": "deepgram:nova3-ms", "source": "own", "condition": "phone",
       "group": "numbers", "n": 15, "error_rate": 0.21, "ci_low": 0.15, "ci_high": 0.3,
       "entity_acc": 0.6, "empty_rate": 0.0, "low_n": True, "latency_p50": 420,
       "latency_p95": 900, "rate_per_min": 0.0048, "license": "commercial API",
       "mode": "streaming"}

def test_render_shows_n_interval_and_low_n_flag():
    md = render([ROW])
    assert "| 15 |" in md and "21.0% (15.0–30.0)" in md and "low n" in md

def test_render_flags_high_empty_rate():
    md = render([dict(ROW, empty_rate=0.25)])
    assert "25% empty" in md

def test_render_contains_no_transcripts():
    assert "hyp" not in render([ROW])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_report.py -v`
Expected: FAIL with `ModuleNotFoundError: bench.report`

- [ ] **Step 3: Implement**

```python
# bench/report.py
import sys
from collections import defaultdict
from pathlib import Path
import numpy as np
from dotenv import load_dotenv
from bench.providers import SETTINGS
from bench.runlog import RunLog
from bench.score import score_clip, aggregate

HEADER = ("| Setting | Mode | Source | Condition | Group | n | Error rate (95% CI) | "
          "Number/name acc | Latency p50/p95 ms | USD/min | License | Flags |\n"
          "|---|---|---|---|---|---|---|---|---|---|---|---|\n")

def render(rows: list[dict]) -> str:
    out = [HEADER]
    for r in rows:
        flags = []
        if r["low_n"]:
            flags.append("low n")
        if r["empty_rate"] > 0.2:
            flags.append(f"{r['empty_rate']:.0%} empty")
        ent = "—" if r["entity_acc"] is None else f"{r['entity_acc']:.0%}"
        out.append(
            f"| {r['setting']} | {r['mode']} | {r['source']} | {r['condition']} | {r['group']} "
            f"| {r['n']} | {r['error_rate']:.1%} ({r['ci_low']*100:.1f}–{r['ci_high']*100:.1f}) "
            f"| {ent} | {r['latency_p50']}/{r['latency_p95']} | {r['rate_per_min']:.4f} "
            f"| {r['license']} | {', '.join(flags)} |\n")
    return "".join(out)

def build(source: str, clips) -> list[dict]:
    refs = {c.id: c for c in clips}
    rows = []
    for path in sorted(Path("results/raw").glob(f"*__{source}__*.jsonl")):
        key_part, _, condition = path.stem.rsplit("__", 2)
        key = key_part.replace("__", ":")
        s = SETTINGS.get(key)
        if s is None:
            continue
        groups = defaultdict(list); lats = defaultdict(list)
        for row in RunLog(path).rows():
            c = refs.get(row["clip_id"])
            if c is None or row["error"] is not None:
                continue
            for g in (c.category, "ALL"):
                groups[g].append(score_clip(c.text, row["hyp"]))
                lats[g].append(row["latency_ms"])
        for g, scores in sorted(groups.items()):
            rows.append({"setting": key, "source": source, "condition": condition, "group": g,
                         **aggregate(scores),
                         "latency_p50": int(np.percentile(lats[g], 50)),
                         "latency_p95": int(np.percentile(lats[g], 95)),
                         "rate_per_min": s.rate_per_min, "license": s.license, "mode": s.mode})
    return rows

if __name__ == "__main__":
    load_dotenv()
    from bench.datasets import load_revolab, load_own
    rows = build("revolab", load_revolab()) + build("own", load_own(Path("data/own/manifest.jsonl")))
    Path("results/summary").mkdir(parents=True, exist_ok=True)
    Path("results/summary/results.md").write_text(render(rows))
    print(f"{len(rows)} rows")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spikes/speech-benchmark && uv run pytest tests/test_report.py -v`
Expected: PASS

- [ ] **Step 5: Full runs, sequential, cheapest first**

For each setting that passed the Task 6 smoke test, run four combinations, one at a time:
```bash
cd spikes/speech-benchmark
uv run python -m bench.run <setting> --source own --condition phone
uv run python -m bench.run <setting> --source own --condition clean
uv run python -m bench.run <setting> --source revolab --condition phone
uv run python -m bench.run <setting> --source revolab --condition clean
```
Expected: each prints clip count and estimated cost before starting; a credit overrun stops with `CreditExceeded`. Re-running a command only sends clips not yet done. After each cloud provider, lower its `CREDIT_*_USD` in `.env` by the estimate.

- [ ] **Step 6: Generate and check the summary**

Run: `cd spikes/speech-benchmark && uv run python -m bench.report && git diff --stat`
Expected: `results/summary/results.md` written; `git status` shows no files under `data/` or `results/raw/`.

- [ ] **Step 7: Commit**

```bash
git add spikes/speech-benchmark/bench/report.py spikes/speech-benchmark/tests/test_report.py spikes/speech-benchmark/results/summary/results.md
git commit -m "feat(spike): speech-to-text benchmark summary"
```

---

## Task 8: Local text-to-speech blind rating (partial, timeboxed)

**Files:**
- Create: `spikes/speech-benchmark/tts/sentences.txt`
- Create: `spikes/speech-benchmark/tts/generate.py`
- Create: `spikes/speech-benchmark/tts/rate.py`
- Create (generated, committed): `spikes/speech-benchmark/results/summary/tts.md`

**Interfaces:**
- Produces: `data/tts/<voice>/<n>.wav` (local), `results/raw/tts_ratings.csv` (local), `results/summary/tts.md` (mean score per voice, n ratings, license).

Candidates (each timeboxed to 45 minutes of setup; drop on miss):
- `facebook/mms-tts-zlm` (Malay, CC-BY-NC-4.0: benchmark only, cannot ship in hosted product)
- `mesolitica/Malaysian-TTS-0.6B-v1` (Malay and English switching; license unknown)
- One Mandarin voice: `hexgrad/Kokoro-82M` Mandarin voice (Apache-2.0) or `FunAudioLLM/CosyVoice2-0.5B` (Apache-2.0)

- [ ] **Step 1:** Write 20 sentences in `tts/sentences.txt` (8 Malay, 6 Manglish, 4 Mandarin, 2 with prices and phone numbers), one per line, written the way an agent would speak them on a call.

- [ ] **Step 2: Generate**

```python
# tts/generate.py
import sys
from pathlib import Path
import numpy as np, soundfile as sf

def mms(lines: list[str], out: Path) -> None:
    import torch
    from transformers import VitsModel, AutoTokenizer
    model = VitsModel.from_pretrained("facebook/mms-tts-zlm")
    tok = AutoTokenizer.from_pretrained("facebook/mms-tts-zlm")
    for i, text in enumerate(lines):
        with torch.no_grad():
            wav = model(**tok(text, return_tensors="pt")).waveform[0].numpy()
        sf.write(out / f"{i:02d}.wav", wav, model.config.sampling_rate)

VOICES = {"mms-zlm": mms}  # add mesolitica / Mandarin voices following their model cards

if __name__ == "__main__":
    lines = Path("tts/sentences.txt").read_text().splitlines()
    for name in sys.argv[1:]:
        out = Path("data/tts") / name
        out.mkdir(parents=True, exist_ok=True)
        VOICES[name](lines, out)
        print(name, "done")
```

Run: `cd spikes/speech-benchmark && uv run python tts/generate.py mms-zlm`
Expected: 20 WAV files in `data/tts/mms-zlm/`. Add the other candidates to `VOICES` using the inference snippet from each model card; stop at the timebox.

- [ ] **Step 3: Blind rating CLI**

```python
# tts/rate.py
import csv, random, subprocess
from pathlib import Path

files = sorted(Path("data/tts").glob("*/*.wav"))
random.Random(7).shuffle(files)
out = Path("results/raw/tts_ratings.csv")
out.parent.mkdir(parents=True, exist_ok=True)
with out.open("a", newline="") as f:
    w = csv.writer(f)
    for i, p in enumerate(files, 1):
        subprocess.run(["afplay", str(p)])
        score = ""
        while score not in {"1", "2", "3", "4", "5"}:
            score = input(f"[{i}/{len(files)}] natural + correct (1-5), r=replay: ").strip()
            if score == "r":
                subprocess.run(["afplay", str(p)])
        w.writerow([p.parent.name, p.stem, score])
```

The voice name is never shown while rating.

- [ ] **Step 4:** The user runs `uv run python tts/rate.py`. Then summarize into `results/summary/tts.md` (mean score, n, license per voice) with a short pandas one-off, and state that this is one rater on local models only.

- [ ] **Step 5: Commit**

```bash
git add spikes/speech-benchmark/tts spikes/speech-benchmark/results/summary/tts.md
git commit -m "feat(spike): local text-to-speech blind rating"
```

---

## Task 9: Decision record and cleanup

**Files:**
- Create: `docs/decisions/0001-speech-providers.md`
- Modify: `docs/superpowers/specs/2026-10-15-jomcall-design.md` (§11: mark verified items)

- [ ] **Step 1: Write the decision record** with these sections, filled from `results/summary/*.md`:
  1. Question and method (sources, phone simulation, settings, what each mode means).
  2. Results table (copied from `results.md`, phone condition first).
  3. Recommendation: default streaming speech-to-text for Malay, for Manglish, for Mandarin; whether a local model is viable for self-hosters; default text-to-speech candidate.
  4. Which winners can become hosted defaults now, and which are blocked by license (unknown or non-commercial).
  5. Limitations: phone line simulated (not real calls), own clips from few speakers, Revolab small per-category counts, local latency measured on a laptop, text-to-speech single rater on local models only, Azure/Google/AWS not tested (card required).
  6. Follow-ups: what to re-test once there is budget.
- [ ] **Step 2:** Update spec §11: mark checked assumptions with the date and outcome.
- [ ] **Step 3: Cleanup.** Run `du -sh spikes/speech-benchmark/.cache spikes/speech-benchmark/data` and delete `.cache/hf` model weights no longer needed. Keep audio until the user confirms the decision.
- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0001-speech-providers.md docs/superpowers/specs/2026-10-15-jomcall-design.md
git commit -m "docs: record speech provider decision from benchmark spike"
```
