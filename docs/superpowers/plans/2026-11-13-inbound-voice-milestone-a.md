# Inbound Voice Milestone A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner or admin starts a voice test in the browser, speaks to their agent and hears it answer, with every turn's delay measured against the design's speed goals.

**Architecture:** The browser joins a local LiveKit room. A Python LiveKit Agents worker in `voice/` streams the microphone to Deepgram, posts each finished transcript to a loopback HTTP endpoint in the existing TypeScript agent process, and speaks the streamed reply through Gemini text-to-speech. The endpoint runs a spoken-path turn (plain speech plus native tool calls on Anthropic's API) that reuses the existing knowledge search, tool executor, authority checks and proposal recording.

**Tech Stack:** TypeScript (Node 24, `tsx`, `node:test`, Zod 4), Postgres through the existing `app_private.agent_work` function, `@anthropic-ai/sdk`, `livekit-server-sdk`, `livekit-client`, Python 3.13 with `uv`, `livekit-agents` plus its Deepgram and Google plugins, `pytest`.

**Spec:** `docs/superpowers/specs/2026-11-13-inbound-voice-design.md`. Evidence for provider choices: `docs/decisions/0001-speech-providers.md`.

## Global Constraints

- Work on a feature branch; merge by pull request; Conventional Commits. Never commit to `main`.
- Dependencies only under MIT, Apache-2.0, BSD or ISC. One accepted exception: LiveKit's turn-detector model (LiveKit Model License), optional, never copied into the repository, and the service must run without it.
- Original work only. No secrets, real audio or real customer data in git. Fixtures use fake names and numbers.
- `JOMCALL_VOICE_PROVIDER` defaults to `disabled`; the only other value is `hosted`.
- Keys come from the ignored `.env.hosted`: `DEEPGRAM_API_KEY` and `GOOGLE_CLOUD_API_KEY` are read only by the voice worker, `ANTHROPIC_API_KEY` only by the agent process. The web process reads none of them.
- Model and service identifiers, each named in exactly one place: brain `claude-haiku-5-5`; ears Deepgram `nova-3` with `language=multi` and a 300 ms end-of-speech wait; voice `gemini-3.8-flash-lite-tts`.
- Brain request settings: thinking left on (adaptive), `output_config.effort` `low`, the stable prompt prefix cached with `cache_control: {type: "ephemeral"}`. Never `thinking: {type: "disabled"}`.
- Voice presets allowed: `Kore`, `Sulafat`, `Leda`, `Achird`, `Charon`. Default `Kore`.
- Every listener binds `127.0.0.1`. New local ports: LiveKit signalling 54630, LiveKit RTC TCP 54631, LiveKit RTC UDP 54632, voice turn endpoint 54633. Register them in `infra/local/services.json`.
- Timing constants: neutral acknowledgement at 800 ms without a sentence; trouble line at 4,000 ms without an answer; at most 2 voice requests per turn; a voice test ends after 300 s; a voice session allows 60 turns.
- Speed goals on the 20-turn script: first sound within 1.5 s on every turn; real answer starting within 2.5 s median without a tool and 4 s median with one; no gap over 3 s without sound.
- Mock preview on 4181 stays independent. A local error never falls back to mock records or to a canned answer presented as the agent.
- Interface text in BM and English. No audio is stored. The typed text path and its accepted gate do not change.

## Review Focus

1. **The ears return nothing** (silence, noise, a cough). Expected: the agent asks the caller to repeat; no model call, no proposal. Pinned in Task 5 and Task 10.
2. **The caller speaks over the agent during a tool turn.** Expected: playback stops, the interrupted turn is cancelled, and no proposal from it remains. Pinned in Task 1 and Task 5.
3. **Google refuses a voice request for rate mid-call.** Expected: the reply still appears as text in the panel, the turn records the refusal, nothing false is spoken, the call stays up. Pinned in Task 10.
4. **The session expires or is deleted while a call is open.** Expected: the next turn is refused, the call ends, the panel clears as it does for typed tests. Pinned in Task 6 and Task 11.
5. **A second voice test is started on the same session from another tab.** Expected: the first call's credential stops working; only one voice call per session. Pinned in Task 1 and Task 9.

---

## File Structure

| Path                                                           | Responsibility                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `supabase/migrations/<timestamp>_voice_test.sql`               | Voice columns, the answer cache table, new `agent_work` actions   |
| `packages/domain/src/agent-test/voice-prompt.ts`               | Spoken-path rules and the tool list in Anthropic's format         |
| `packages/domain/src/agent-test/sentences.ts`                  | Splitting streamed text into speakable sentences                  |
| `packages/domain/src/agent-test/fast-lane.ts`                  | Answer-cache key and the self-contained check                     |
| `packages/inference/src/anthropic-voice.ts`                    | One streamed model call for the spoken path                       |
| `engine/src/agent/voice-turn.ts`                               | One spoken turn end to end, emitting events                       |
| `engine/src/agent/voice-server.ts`                             | Loopback HTTP endpoint around `voice-turn.ts`                     |
| `packages/domain/src/agent-test/voice-session.ts`              | Starting a voice test from the web API                            |
| `scripts/local/livekit-*.mjs`, `infra/local/livekit-lock.json` | Pinned local LiveKit server lifecycle                             |
| `voice/`                                                       | Python worker: ears, brain client, voice out, fillers, call logic |
| `web/components/core/voice-test.tsx`                           | Voice controls and timings in the test panel                      |
| `tests/…`, `voice/tests/…`                                     | Tests beside the conventions already in the repository            |

---

### Task 1: Database support for spoken turns

**Files:**

- Create: `supabase/migrations/<timestamp>_voice_test.sql`
- Test: `tests/db/voice-test.test.ts`

**Interfaces:**

- Produces, as new columns: `app.test_session.channel text not null default 'text' check (channel in ('text','voice'))`, `app.test_session.voice_token_hash text`, `app.test_session.voice_expires_at timestamptz`; `app.test_turn.channel` (same check), `app.test_turn.timings jsonb not null default '{}'`, `app.test_turn.evidence jsonb not null default '[]'`.
- Produces table `app.voice_answer_cache(org_id, snapshot_hash, language, key, answer, evidence, created_at)`, primary key `(org_id, snapshot_hash, language, key)`, row-level security as on `test_turn`, cascade on organization delete.
- Produces `app_private.agent_work` actions, all taking the session id in `p_id` and the SHA-256 hex of the voice token in `p_data.tokenHash`:
  - `voice_begin` with `p_data.input`, `p_data.clientTurnId`: checks `agent_authorized`, token hash, `voice_expires_at > now()` and fewer than 60 turns; cancels any running voice turn of the session and deletes that turn's proposals and tool steps; inserts a `running` turn with `channel='voice'` and a lease; returns the same envelope shape `claim` returns. Raises `VOICE_UNAUTHORIZED`, `VOICE_EXPIRED` or `TURN_LIMIT`.
  - `voice_complete` with `p_data.answer`, `p_data.timings`, `p_data.evidence`, `p_data.usage`; `voice_fail` with `p_data.code`; `voice_cancel`: each requires the turn's lease in `p_lease`.
  - `voice_cache_get` and `voice_cache_put` with `p_data.language`, `p_data.key` (and `answer`, `evidence` for put).

- [ ] **Step 1: Write failing tests** in `tests/db/voice-test.test.ts` using the existing harness in `tests/helpers/agent-test.ts`:
  - `voice_begin` with a wrong token hash raises `VOICE_UNAUTHORIZED`; with `voice_expires_at` in the past raises `VOICE_EXPIRED`.
  - `voice_begin` returns an envelope whose `turn.state` is `running` and whose `session.snapshot` equals the session's.
  - A second `voice_begin` while the first turn is running leaves the first `cancelled` and `select count(*) from app.test_proposal where turn_id = <first>` is `0` after a proposal was recorded on it.
  - The 61st `voice_begin` on one session raises `TURN_LIMIT`.
  - `voice_complete` stores `timings` and `evidence` unchanged; with a stale lease it changes nothing.
  - `voice_cache_put` then `voice_cache_get` returns the row; a different `snapshot_hash` returns null; another organization's role sees nothing.
- [ ] **Step 2: Run** `npm run test:local -- tests/db/voice-test.test.ts`. Expected: fails on the missing action.
- [ ] **Step 3: Write the migration.** Replace `app_private.agent_work` with `create or replace`, keeping every existing action byte for byte and adding the six above. Existing typed turns keep the 20-turn limit.
- [ ] **Step 4: Run** `npm run db:migrate:local && npm run test:local -- tests/db/voice-test.test.ts && npm run db:verify-migrations`. Expected: pass.
- [ ] **Step 5: Run** `npm run check:core`. Expected: pass, unchanged count plus the new tests.
- [ ] **Step 6: Commit** `feat(db): add spoken-turn records and the voice answer cache`.

### Task 2: Spoken-path rules, tools and sentence splitting

**Files:**

- Create: `packages/domain/src/agent-test/voice-prompt.ts`, `packages/domain/src/agent-test/sentences.ts`
- Test: `tests/domain/voice-prompt.test.ts`, `tests/domain/sentences.test.ts`

**Interfaces:**

- Produces `voiceRules: string`, `voiceTools: {name: string; description: string; input_schema: object}[]`, and `voiceSystem(snapshotSettings, resources, evidence, now): {stable: string; volatile: string}`. `stable` holds rules, business configuration (through the existing `businessConfiguration`), resources and evidence; `volatile` holds only the current date and time.
- Produces `splitSentences(buffer: string): {sentences: string[]; rest: string}`.

- [ ] **Step 1: Write failing tests.**
  - `voiceTools` has exactly the five tool names in `toolCallSchema` (`search_knowledge`, `check_availability`, `book_slot`, `take_message`, `handoff_to_human`), and each tool's `input_schema.properties` keys equal that tool's argument keys in `toolCallSchema`; every schema has `additionalProperties: false`.
  - `voiceRules` contains a rule for each anti-goal: matches `/never.*(booked|confirmed)/i`, `/one or two short sentences/i`, `/read back/i`, `/never say.*(tool|source)/i`, and `/language of the latest customer message/i`.
  - `voiceSystem(...).stable` is identical for two calls that differ only in `now`.
  - `splitSentences("Kami buka 9 pagi. Tutup pukul 6")` returns `{sentences: ["Kami buka 9 pagi."], rest: "Tutup pukul 6"}`; `"RM 80.50 sahaja"` yields no sentence; `"好的。请稍等"` yields `["好的。"]`; a sentence shorter than 12 characters is held until the next one completes.
- [ ] **Step 2: Run** the two test files. Expected: fail, modules missing.
- [ ] **Step 3: Implement** both modules. Derive `voiceTools` from `toolCallSchema` with `z.toJSONSchema`, stripping `$schema`, `pattern`, `format`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`.
- [ ] **Step 4: Run** the two test files. Expected: pass.
- [ ] **Step 5: Commit** `feat(agent): add spoken-path rules, tools and sentence splitting`.

### Task 3: Streamed model call for the spoken path

**Files:**

- Create: `packages/inference/src/anthropic-voice.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`), `packages/inference/src/index.ts`
- Test: `tests/inference/anthropic-voice.test.ts`

**Interfaces:**

- Consumes `voiceTools`, `splitSentences`.
- Produces `voiceModel = "claude-haiku-5-5"` and
  `streamVoiceModel(input: {stable: string; volatile: string; messages: unknown[]}, signal: AbortSignal, client?: Pick<Anthropic, "messages">): AsyncIterable<VoiceModelEvent>` where
  `VoiceModelEvent = {type: "sentence"; text: string} | {type: "tool"; id: string; name: string; input: unknown} | {type: "end"; text: string; content: unknown[]; usage: {input: number; output: number; cacheRead: number}}`.

- [ ] **Step 1: Write failing tests** with a fake client whose `messages.stream` yields scripted events:
  - The request has `model: "claude-haiku-5-5"`, `output_config: {effort: "low"}`, no `thinking` key, no `temperature`, `system[0].cache_control.type === "ephemeral"` on the stable block and none on the volatile block, and `tools` equal to `voiceTools`.
  - Text deltas `"Kami buka 9 pagi. "` then `"Tutup 6 petang."` yield two `sentence` events in order, then `end`.
  - A `tool_use` block yields one `tool` event whose `input` passed `toolCallSchema` validation; an input failing validation throws `MODEL_OUTPUT_INVALID`.
  - `stop_reason: "refusal"` or `"max_tokens"` throws `MODEL_OUTPUT_TRUNCATED`; an `Anthropic.RateLimitError` or `APIConnectionError` surfaces as `MODEL_UNAVAILABLE`; `AuthenticationError` as `HOSTED_MODEL_REQUIRED`.
  - An aborted signal stops iteration without an `end` event.
- [ ] **Step 2: Run** `npm run test:local -- tests/inference/anthropic-voice.test.ts`. Expected: fail.
- [ ] **Step 3: Implement** with `client.messages.stream(...)`, `max_tokens: 1024`. Construct the default client with `new Anthropic()` so it reads `ANTHROPIC_API_KEY`.
- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(inference): add the streamed spoken-path model call`.

### Task 4: Fast lane as an answer cache

**Files:**

- Create: `packages/domain/src/agent-test/fast-lane.ts`
- Test: `tests/domain/fast-lane.test.ts`

**Interfaces:**

- Produces `fastLaneKey(transcript: string): string | null` and `spokenLanguage(transcript: string): "ms" | "en" | "zh"`.

The fast lane serves an answer the brain itself gave earlier, for the same agent snapshot, to the same question. It never composes a new answer.

- [ ] **Step 1: Write failing tests.**
  - `fastLaneKey("Kedai buka pukul berapa ah?")` equals `fastLaneKey("kedai buka pukul berapa")`: lower-cased, punctuation removed, the particles `ah`, `lah`, `ya`, `kan`, `eh`, `uh`, `um` removed, spaces collapsed.
  - Returns `null` for fewer than 4 remaining words, for any transcript containing a digit, and for any containing one of `esok`, `hari ini`, `tomorrow`, `today`, `tadi`, `itu`, `that`, `it`, `tu` as a whole word. Dates, amounts and references to earlier turns are never served from cache.
  - Two different fixture questions never share a key: over all 48 questions in `tests/fixtures/agent-evaluation.json`, the non-null keys are unique per distinct question text.
- [ ] **Step 2: Run** the test file. Expected: fail.
- [ ] **Step 3: Implement** both functions. `spokenLanguage` returns `zh` when the text has CJK characters, `ms` when it has any of the Malay marker words already used by the evaluator's wrong-language check, otherwise `en`.
- [ ] **Step 4: Run** the test file. Expected: pass.
- [ ] **Step 5: Commit** `feat(agent): add the fast-lane cache key`.

### Task 5: One spoken turn

**Files:**

- Create: `engine/src/agent/voice-turn.ts`
- Modify: `engine/src/agent/repository.ts` (thin methods over the Task 1 actions)
- Test: `tests/engine/voice-turn.test.ts`

**Interfaces:**

- Consumes Task 1 actions, `voiceSystem`, `streamVoiceModel`, `fastLaneKey`, `spokenLanguage`, and the existing `searchKnowledge`, `buildKnowledgeIndex`, `executeTestTool`, `claimsFalseSuccess`.
- Produces `runVoiceTurn(deps: {repository: AgentRepository; model: typeof streamVoiceModel; now(): number}, request: {sessionId: string; tokenHash: string; transcript: string; clientTurnId: string; heardAtMs: number}, emit: (e: VoiceTurnEvent) => void, signal: AbortSignal): Promise<void>` with
  `VoiceTurnEvent = {type: "started"; turnId: string} | {type: "fast"; text: string} | {type: "sentence"; text: string} | {type: "tool"; name: string} | {type: "done"; turnId: string; timings: {transcriptMs: number; firstSentenceMs: number | null; totalMs: number}} | {type: "error"; code: string}`.

Behaviour the tests fix: an empty transcript emits `error` with `NOTHING_HEARD` before any database write; a fast-lane hit emits `fast` then `done` without calling the model; otherwise sentences stream as they arrive; a tool event runs `executeTestTool` on the final transcript only, feeds the result back and continues, at most two tool calls; a sentence for which `claimsFalseSuccess` is true is not emitted and the turn fails with `UNSAFE_REPLY`; an answer given with no prior turns and no tool is written to the cache under `fastLaneKey`; on abort the turn is cancelled through `voice_cancel`.

- [ ] **Step 1: Write failing tests** with a scripted fake model, following `tests/engine/agent-turns.test.ts`:
  - Plain answer: events are `started`, `sentence`, `sentence`, `done`; the stored turn has `channel = 'voice'`, `state = 'completed'`, `answer` equal to the joined sentences, `evidence` listing the supplied source IDs, and `timings.firstSentenceMs` a number.
  - Message request: a `take_message` tool event records exactly one `message` proposal and emits `tool` before the final sentences.
  - Empty transcript: `error NOTHING_HEARD`, and `select count(*) from app.test_turn` is unchanged.
  - Abort during the tool call: the turn is `cancelled` and no proposal for it exists.
  - Unsafe sentence `"Your appointment is confirmed."`: no `sentence` event carries it; the turn is `failed` with `UNSAFE_REPLY`.
  - Second identical question in a new session on the same snapshot: `fast` is emitted and the fake model was called once in total.
  - A question containing `esok` is never served by `fast`.
  - Expired session: `error VOICE_EXPIRED`.
- [ ] **Step 2: Run** `npm run test:local -- tests/engine/voice-turn.test.ts`. Expected: fail.
- [ ] **Step 3: Implement** `runVoiceTurn` and the repository methods `voiceBegin`, `voiceComplete`, `voiceFail`, `voiceCancel`, `voiceCacheGet`, `voiceCachePut`.
- [ ] **Step 4: Run** the test file and `npm run check:core`. Expected: pass.
- [ ] **Step 5: Commit** `feat(agent): run one spoken turn with tools, cache and safety check`.

### Task 6: Loopback voice turn endpoint

**Files:**

- Create: `engine/src/agent/voice-server.ts`
- Modify: `engine/src/agent/index.ts`, `infra/local/services.json`, `package.json` (`dev:agent` already loads `.env.hosted`)
- Test: `tests/engine/voice-server.test.ts`

**Interfaces:**

- Consumes `runVoiceTurn`.
- Produces `startVoiceServer(deps, options: {host: "127.0.0.1"; port: number}): Promise<{close(): Promise<void>}>`.
- Wire format: `POST /voice/turns` with header `authorization: Bearer <voice token>` and JSON `{sessionId, transcript, clientTurnId, heardAtMs}`; the response is `application/x-ndjson`, one `VoiceTurnEvent` per line, flushed as emitted. Closing the request aborts the turn. `GET /voice/health` returns `{ok: true}`.

- [ ] **Step 1: Write failing tests.**
  - A turn posted over HTTP yields the same event sequence as Task 5's plain-answer test, parsed line by line.
  - A missing or wrong bearer token yields HTTP 401 and no turn.
  - Destroying the client socket mid-stream leaves the turn `cancelled`.
  - `startVoiceServer` with `host: "0.0.0.0"` throws `LOOPBACK_REQUIRED`.
  - A body over 8 KiB yields HTTP 413.
  - A turn on an expired session streams one `error` line with `VOICE_EXPIRED` and ends; a turn on a deleted session does the same with `VOICE_UNAUTHORIZED`.
  - With `JOMCALL_VOICE_PROVIDER` unset, `engine/src/agent/index.ts` does not open port 54633.
- [ ] **Step 2: Run** the test file. Expected: fail.
- [ ] **Step 3: Implement** with `node:http`. Hash the bearer token with SHA-256 before it reaches the repository. Start it from `index.ts` only when `JOMCALL_VOICE_PROVIDER=hosted`.
- [ ] **Step 4: Run** the test file and `npm run test:guards`. Expected: pass.
- [ ] **Step 5: Commit** `feat(agent): serve spoken turns on a loopback endpoint`.

### Task 7: The 48 cases through the spoken path

**Files:**

- Create: `tests/inference/voice-quality.test.ts`
- Modify: `package.json` (script `check:voice-model`)

**Interfaces:**

- Consumes the Task 6 endpoint and `tests/fixtures/agent-evaluation.json`.

- [ ] **Step 1: Write the evaluator.** For each case it starts a session through the existing API harness, marks it as a voice session with a known token, posts the question to `/voice/turns`, and scores it with the rules of `tests/inference/quality.test.ts` with two differences: FAQ cases pass on content alone (`contains`) because spoken answers carry no citations, and the answer must not contain a source ID or a tool name. Thresholds are unchanged: no safety flag, at least 10 of 12 per language. Results go to the ignored `output/phase2/voice-evaluation.json`.
- [ ] **Step 2: Add** `"check:voice-model"` running that file with `JOMCALL_VOICE_PROVIDER=hosted` and `.env.hosted` loaded.
- [ ] **Step 3: Run** `npm run check:voice-model`. Expected: exits zero. This spends a few cents on Anthropic.
- [ ] **Step 4: If it fails,** change only `voiceRules` and rerun; never the fixtures or thresholds. Record every run's totals in `docs/qa/2026-11-13-agent-tool-calling.md` under a new heading "Spoken path".
- [ ] **Step 5: Commit** `test(agent): gate the spoken path on the 48 cases`.

### Task 8: Local LiveKit server

**Files:**

- Create: `scripts/local/livekit-prepare.mjs`, `scripts/local/livekit-start.mjs`, `scripts/local/livekit-stop.mjs`, `infra/local/livekit-lock.json`, `infra/local/livekit.yaml`
- Modify: `scripts/local/env.mjs`, `package.json`, `infra/local/services.json`
- Test: `tests/local/livekit.test.mjs`

**Interfaces:**

- Produces npm scripts `livekit:prepare`, `livekit:start`, `livekit:stop`; env values `LIVEKIT_URL=ws://127.0.0.1:54630`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` written to the root `.env.local` and `web/.env.local`, generated once and preserved like the existing secrets.

- [ ] **Step 1: Write failing tests** in the style of `tests/local/model.test.mjs`: the lock pins a version and a SHA-256 for the darwin-arm64 archive; a checksum mismatch aborts before unpacking; the generated config binds `127.0.0.1`, uses ports 54630, 54631 and 54632, and contains no `0.0.0.0`; stop refuses a process it did not start; `LIVEKIT_API_SECRET` is written to the root `.env.local` and to `web/.env.local` (the web server signs room tokens) and never under a `NEXT_PUBLIC_` name.
- [ ] **Step 2: Run** `npm run test:guards`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the three scripts after `scripts/local/model-*.mjs`: explicit download, checksum check, project-owned binary under `.local/livekit/`, recorded PID.
- [ ] **Step 4: Run** `npm run test:guards`, then `npm run livekit:prepare -- --download && npm run livekit:start` and `curl -s http://127.0.0.1:54630` returns `OK`. Then `npm run livekit:stop`.
- [ ] **Step 5: Commit** `feat(local): run a pinned LiveKit server on loopback`.

### Task 9: Starting a voice test from the web API

**Files:**

- Create: `packages/domain/src/agent-test/voice-session.ts`
- Modify: `packages/contracts/src/agent-test.ts`, `packages/contracts/src/core.ts`, `packages/domain/src/agent-test/routes.ts`, `packages/inference/src/provider.ts`, `package.json` (add `livekit-server-sdk`), regenerate `packages/contracts/openapi.json`
- Test: `tests/api/voice-tests.test.ts`

**Interfaces:**

- Produces command `startVoiceTest`: `POST /agent-tests/:id/voice`, body `{expectedSessionRevision: number}`, response `{url: string; token: string; room: string; expiresAt: string; voice: string}`.
- Extends `Readiness` with `voice: {configured: boolean; reason: string | null}`.
- The room's agent-dispatch metadata is JSON `{sessionId, voiceToken, voice, greeting, disclosure}`.

- [ ] **Step 1: Write failing tests.**
  - Owner starts a voice test: HTTP 200; `token` is a JWT whose grants allow joining only `room`; the session row has `channel = 'voice'`, a `voice_token_hash`, and `voice_expires_at` within 300 s plus or minus 5.
  - Staff role: HTTP 403. Another organization's session: HTTP 404.
  - Agent snapshot with an empty `aiDisclosure`: HTTP 422 `DISCLOSURE_REQUIRED`.
  - `JOMCALL_VOICE_PROVIDER` unset: HTTP 503 `VOICE_DISABLED`, and readiness reports `voice.configured === false`.
  - `voicePreference` of `"Nova"` falls back to `Kore`; `"Leda"` is kept.
  - Starting a second voice test on the same session replaces `voice_token_hash`, so the first token fails `voice_begin` with `VOICE_UNAUTHORIZED`.
  - The response never contains `LIVEKIT_API_SECRET`, and the plain voice token appears nowhere in the database.
- [ ] **Step 2: Run** `npm run test:local -- tests/api/voice-tests.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.** Generate a 32-byte random voice token, store only its SHA-256 hex, create the room with `livekit-server-sdk`'s `RoomServiceClient` and dispatch the agent named `jomcall-voice` with the metadata above.
- [ ] **Step 4: Run** the test file, `npm run contracts:generate`, `npm run check:core`. Expected: pass.
- [ ] **Step 5: Commit** `feat(api): start a voice test session`.

### Task 10: The voice worker

**Files:**

- Create: `voice/pyproject.toml`, `voice/README.md`, `voice/jomcall_voice/{__init__,config,ears,brain_client,voice_out,fillers,call}.py`, `voice/tests/test_{fillers,brain_client,voice_out,call}.py`
- Modify: `.gitignore` (`voice/.venv/`, `voice/.cache/`), `package.json` (`dev:voice`)

**Interfaces:**

- Consumes the Task 6 wire format and the Task 9 dispatch metadata.
- Produces a LiveKit Agents worker registered as `jomcall-voice`, started with `npm run dev:voice`.
- `fillers.choose(action: str | None, language: str, last: str | None, detail: str | None) -> str | None`; `action` is one of `check_availability`, `book_slot`, `take_message`, `handoff_to_human`, `search_knowledge` or `None` for a neutral acknowledgement.
- `brain_client.stream_turn(session_id, token, transcript, client_turn_id, heard_at_ms) -> AsyncIterator[dict]`.
- `voice_out.Voice(preset).speak(text) -> AsyncIterator[bytes]` and `.cached(text) -> bytes`.

- [ ] **Step 1: Write failing tests** with `pytest`.
  - `fillers.choose("check_availability", "ms", None, None)` returns one of that action's Malay lines; called twice with `last` set to the first result it never returns the same line; with `detail="esok pukul sepuluh"` the line contains that detail; every action has at least 3 lines in each of `ms`, `en` and `manglish`; neutral lines are at most 2 words.
  - `brain_client.stream_turn` against a fake NDJSON server yields each event as a dict in order, and closing the iterator closes the HTTP request.
  - `voice_out`: a second `cached("Baik.")` makes no HTTP request; a 429 from the fake server raises `VoiceRefused` and is not retried inside a turn.
  - `call`, with fake ears, brain and voice driven by a fake clock:
    - sentence at 300 ms: no filler is played;
    - a `fast` event: it is spoken like a sentence and no filler is played;
    - no sentence by 800 ms: one neutral acknowledgement plays, then the answer;
    - `tool` event at 500 ms: the action's filler plays, not the neutral one;
    - no sentence by 4,000 ms: the trouble line plays once;
    - empty transcript: the repeat request plays and the brain is not called;
    - caller speech during playback: playback stops and the open brain stream is closed;
    - `VoiceRefused`: nothing is spoken for that sentence, the turn is marked with `voiceRefused: true`, the call continues;
    - `error VOICE_EXPIRED` from the brain: the call ends;
    - a reply of three sentences makes exactly 2 voice requests;
    - at 300 s the call says goodbye and disconnects.
- [ ] **Step 2: Run** `cd voice && uv run pytest`. Expected: fail.
- [ ] **Step 3: Implement.** Ears: LiveKit's Deepgram plugin configured for `nova-3`, `language="multi"`, 300 ms endpointing, interim results on; if the plugin cannot express that, write a small adapter against Deepgram's streaming API and note it in `voice/README.md`. Voice: LiveKit's `google.beta.GeminiTTS` with the Agent Platform key if it accepts `gemini-3.8-flash-lite-tts`, else a direct streaming client. The greeting and disclosure are synthesized once at call start and played before listening begins. Read keys from the environment only; `npm run dev:voice` loads `.env.local` and `.env.hosted`.
- [ ] **Step 4: Run** `cd voice && uv run pytest`. Expected: pass.
- [ ] **Step 5: Commit** `feat(voice): add the LiveKit voice worker`.

### Task 11: Voice controls in the test panel

**Files:**

- Create: `web/components/core/voice-test.tsx`
- Modify: `web/components/core/agent-test.tsx`, `web/lib/core/client.ts` (the `startVoiceTest` command), `web/package.json` (add `livekit-client`), the BM and English message files used by `agent-test.tsx`
- Test: browser verification through the local preview on 4182

**Interfaces:**

- Consumes `startVoiceTest`, `Readiness.voice`, and the stored turns' `channel` and `timings`.

- [ ] **Step 1: Build the control.** In the saved-test view, a "Start voice test" button, disabled with its reason when `voice.configured` is false or the session is closed. Before the first start it shows, in the interface language: "Your microphone audio is sent to Deepgram, and the conversation to Anthropic and Google, outside Malaysia. Do not say real customer details." / "Audio mikrofon anda dihantar kepada Deepgram, dan perbualan kepada Anthropic dan Google, di luar Malaysia. Jangan sebut butiran pelanggan sebenar." While a call is open: a stop button, a live "listening / thinking / speaking" state, and a countdown from 5:00.
- [ ] **Step 2: Show spoken turns.** Spoken turns appear in the existing transcript list with a "spoken" mark and, under each, `transcript → first sentence → total` in seconds from `timings`. Replace the line "Voice testing is not connected yet".
- [ ] **Step 3: Handle failures.** Microphone permission refused: an inline explanation and no call. Call dropped or session expired: the control returns to idle and the session view refreshes, clearing on 401, 403, 404 and 410 exactly as the typed panel does.
- [ ] **Step 4: Verify in the browser** with `npm run local:start`, `npm run livekit:start`, `npm run dev:agent`, `npm run dev:voice`, `npm run dev:local`: start a voice test, ask "Kedai buka pukul berapa?", hear an answer, see the spoken turn with timings; ask to leave a message and see the proposal. Check 390 px width, dark theme and BM. Run the existing accessibility check on the route.
- [ ] **Step 5: Run** `npm run typecheck && npm run build:local && npm run build:mock`. Expected: pass; the mock build contains no voice control.
- [ ] **Step 6: Commit** `feat(web): add voice testing to the agent test panel`.

### Task 12: Measure, then tune

**Files:**

- Create: `voice/tools/replay.py`, `voice/tools/script.json`, `docs/qa/<date>-voice-milestone-a.md`
- Modify: `package.json` (`check:voice-speed`)

**Interfaces:**

- Consumes a running local stack and the stored turns' `timings`.

- [ ] **Step 1: Write `script.json`:** the 20 turns of design §8 (8 BM, 8 Manglish, 4 English; 12 plain, 4 booking, 2 message, 2 handoff) against the fixture knowledge.
- [ ] **Step 2: Write `replay.py`:** joins a room as a caller, plays each turn's audio in real time, records for each turn the time from end of audio to first sound and to the first answer audio, and writes a table. Caller audio is synthesized once and cached under the ignored `voice/.cache/`.
- [ ] **Step 3: Run** `npm run check:voice-speed` three times. Record every run in the QA document: medians, 90th percentiles, the longest silent gap, refused voice requests, reply language, proposals recorded, whether each booking was read back before its proposal, and how many turns the fast lane served. A run with a refused voice request is recorded and excluded from the speed result.
- [ ] **Step 4: Apply the measures of design §5.5 one at a time**, each as its own commit, keeping a measure only if the three-run median improves: one connection per call to each service; start the brain on the interim transcript and restart on change, with tools still running only on the final transcript; preload while the greeting plays; Deepgram vocabulary hints from the agent's name and knowledge titles; the optional turn-detector model behind `JOMCALL_VOICE_TURN_DETECTOR=livekit`, default off.
- [ ] **Step 5: The owner speaks the 20 turns** through the browser once. Record the same numbers and the owner's verdict.
- [ ] **Step 6: Write the outcome** against the speed goals. If they are missed, stop and bring the design §9 decision to the owner.
- [ ] **Step 7: Commit** `docs(qa): record voice milestone A measurements`.

### Task 13: Documentation and handoff

**Files:**

- Modify: `AGENTS.md`, `README.md`, `infra/local/README.md`, `.agent/handoff.md`, `docs/superpowers/specs/2026-10-15-jomcall-design.md`

- [ ] **Step 1: `AGENTS.md`:** record Deepgram, Anthropic's API and Google text-to-speech as owner-approved, opt-in exceptions to the local-only rule, each with who holds its key; update the current-state section.
- [ ] **Step 2: `README.md` and `infra/local/README.md`:** the five commands to run a voice test, the keys needed, what leaves the machine, the ports, and how to stop everything.
- [ ] **Step 3: Design spec §10:** note the spoken path's provider and output shape beside the existing LLM row.
- [ ] **Step 4: `.agent/handoff.md`:** what changed, what is verified, what is next.
- [ ] **Step 5: Run** `npm run check:phase2 && npm run check:hosted-model && npm run check:voice-model && npm run test:guards`. Expected: all pass.
- [ ] **Step 6: Commit** `docs: describe voice testing and its hosted services`, then open the pull request.
