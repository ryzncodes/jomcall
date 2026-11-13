# JomCall voice worker

A LiveKit Agents worker registered as `jomcall-voice`. It joins a browser-call room,
listens (Deepgram), asks the voice turn endpoint in the TypeScript agent process
what to say (the "brain"), and speaks the answer (Gemini text-to-speech). The worker
owns timing only; every product rule lives in the brain.

Run: `npm run dev:voice` from the repo root (loads `.env.local`, then `.env.hosted`
if it exists). Tests: `cd voice && uv run pytest` (no network, no keys, no LiveKit).

## Environment

`DEEPGRAM_API_KEY`, `GOOGLE_CLOUD_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, optional `JOMCALL_VOICE_TURN_URL` (default `http://127.0.0.1:54633`).
Keys come from the environment only. The worker never prints or writes a key or the
voice token, and never logs transcripts or answers.

## Files

| File | Job | LiveKit import |
|---|---|---|
| `config.py` | All timing constants and endpoints, in one place | no |
| `fillers.py` | Fixed lines in ms/en/manglish/zh, filler-language guess | no |
| `brain_client.py` | NDJSON client for `POST /voice/turns` | no |
| `voice_out.py` | Gemini TTS client, disk cache, `VoiceRefused` | no |
| `call.py` | Per-call state machine (protocols for ears, brain, voice, clock, sink) | no |
| `ears.py` | Deepgram through `livekit-plugins-deepgram` | yes |
| `worker.py`, `__main__.py` | Room join, audio track, wiring | yes |

## Choices to know about

- **Ears** use LiveKit's Deepgram plugin as is. It expresses `nova-3`, `language="multi"`,
  `endpointing_ms=300` and `interim_results=True`, so no custom adapter was written.
  LiveKit's turn-detector model is not used (separate proprietary licence).
- **Voice is a direct streaming client** (httpx, server-sent events, 16-bit mono PCM at
  24 kHz), not LiveKit's `google.beta.TTS`. That class accepts the model name but builds
  on the google-genai SDK, which cannot target the Agent Platform endpoint with an
  `x-goog-api-key` header. The request body mirrors what that class sends.
  Unverified against the live service until the end-to-end leg runs.
- **Speech budget**: that endpoint allows about 11 requests a minute on this project. A
  turn makes at most 2 voice requests (first sentence alone, the rest joined); the cap is
  enforced in code from `MAX_VOICE_REQUESTS_PER_TURN`. A 429 raises `VoiceRefused`, is never
  retried, and the turn is marked `voiceRefused`.
- **Fixed lines are never synthesized during a call.** Fillers, trouble line, repeat request
  and goodbye come from the cache only (`Voice.lookup`, no request). An uncached line is
  skipped silently and counted as the call's `fixedLinesSkipped`. Fill the cache first with
  `npm run voice:prewarm -- --preset Kore` (or `python -m jomcall_voice.prewarm --preset Kore
  [--languages ms,en,manglish,zh]` inside `voice/`): at most 8 requests a minute, resumable,
  stops on a 429 and says how many lines remain. Cache: `voice/.cache/<preset>/`, gitignored.
  The call opening (greeting + disclosure) is the one line synthesized at call time; it is
  cached by model + preset + text, so a repeat call with the same text costs no request.
- **Barge-in** needs words: only a non-empty interim transcript while the agent is speaking
  interrupts it. Raw voice-activity detection alone does nothing, so noise or echo cannot
  abort a turn or spend one of the session's turns.
- **Filler language** comes from a tiny local guess on the transcript (CJK characters,
  a short Malay word list, Manglish particles). It is a filler-only heuristic; the brain
  decides the real reply language.
- **Disclosure** is spoken before listening starts, every call. If it cannot be
  synthesized the call ends (`opening_failed`).

## Direct dependencies (exact pins in `pyproject.toml`, locked in `uv.lock`)

| Package | Version | Licence |
|---|---|---|
| livekit-agents | 1.6.0 | Apache-2.0 |
| livekit-plugins-deepgram | 1.6.0 | Apache-2.0 |
| httpx | 0.28.1 | BSD-3-Clause |
| pytest (dev) | 9.2.0 | MIT |
| pytest-asyncio (dev) | 1.5.0 | Apache-2.0 |

## Transitive licences

Gathered from the installed packages' metadata (`License-Expression`, `License`, then
`License ::` classifiers) in `voice/.venv` after `uv sync` against `uv.lock`. Every locked
package is MIT, Apache-2.0, BSD, ISC, PSF or MPL-2.0 class. Those that are not a plain single
permissive licence:

| Package | Licence | Note |
|---|---|---|
| certifi | MPL-2.0 | Weak copyleft, file-level; used unmodified |
| numpy | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | Bundled components, all permissive |
| aiohttp | Apache-2.0 AND MIT | |
| prometheus_client | Apache-2.0 AND BSD-2-Clause | |
| packaging | Apache-2.0 OR BSD-2-Clause | |
| cffi | MIT-0 | |
| protobuf | BSD-3-Clause | Reported as "3-Clause BSD License" |

**`livekit-local-inference` is not installed.** `livekit-agents` 1.6.1 through 1.8.11 declare
it as a hard requirement (`livekit-local-inference>=0.2.7`, no extra). It is licensed
`Apache-2.0 AND LicenseRef-LiveKit-Model`, ships a roughly 95 MB native library, and its
model licence is the same proprietary LiveKit Model License as the optional turn detector.
This worker pins `livekit-agents` and `livekit-plugins-deepgram` to 1.6.0, the newest 1.x
release whose metadata does not require it, so the package is neither locked nor installed
and JomCall neither loads nor redistributes it. Before upgrading past 1.6.0, re-check
`Requires-Dist` for it and the licence note above.
