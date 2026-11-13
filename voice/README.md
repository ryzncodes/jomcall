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
  turn makes at most 2 voice requests (first sentence alone, the rest joined). Fixed
  lines are synthesized once per preset and kept in `voice/.cache/` (gitignored). A 429
  raises `VoiceRefused`, is never retried, and the turn is marked `voiceRefused`.
  A filler line not yet cached costs one request the first time it is needed.
- **Filler language** comes from a tiny local guess on the transcript (CJK characters,
  a short Malay word list, Manglish particles). It is a filler-only heuristic; the brain
  decides the real reply language.
- **Disclosure** is spoken before listening starts, every call. If it cannot be
  synthesized the call ends (`opening_failed`).

## Direct dependencies (exact pins in `pyproject.toml`, locked in `uv.lock`)

| Package | Version | Licence |
|---|---|---|
| livekit-agents | 1.8.11 | Apache-2.0 |
| livekit-plugins-deepgram | 1.8.11 | Apache-2.0 |
| httpx | 0.28.1 | BSD-3-Clause |
| pytest (dev) | 9.2.0 | MIT |
| pytest-asyncio (dev) | 1.5.0 | Apache-2.0 |
