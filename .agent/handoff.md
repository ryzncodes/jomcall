# Handoff

## 2026-11-14 — browser voice call, milestone A

Branch `feat/voice-milestone-a` (builds on PR #6; not merged, not pushed).

**Changed**
- Database support for spoken turns and an answer cache; spoken rules and tools; streamed Anthropic client; `startVoiceTest` web command; loopback NDJSON turn endpoint in the agent process (`127.0.0.1:54633`).
- Pinned local LiveKit server in Docker (ports 54630-54632, loopback). Python worker in `voice/` (health listener 54634). Voice controls in the agent test panel (app on 4182 only).
- Scripted caller that measures speed. Docs: `AGENTS.md`, `README.md`, `infra/local/README.md`, design spec section 10, `docs/qa/2026-11-14-voice-milestone-a.md`.
- Owner approved on 2026-11-13, opt-in only with `JOMCALL_VOICE_PROVIDER=hosted`: Deepgram (`DEEPGRAM_API_KEY`, worker), Anthropic direct (`ANTHROPIC_API_KEY`, agent), Google TTS (`GOOGLE_CLOUD_API_KEY`, worker). Keys in `.env.hosted`.

**Verified**
- `npm run check:voice-model`, run 4: 48/48, 12 per language, no safety flags, read-back before the first tool on 8 of 8 booking cases.
- `npm run check:voice-speed`, run 3 (20 turns, 3 calls): 20 of 20 answered, 0 timeouts, 0 refused voice requests. First sound median 1.42 s (p90 2.02 s, 15 of 20 within 1.5 s). Plain answer start median 3.02 s (goal 2.5 s, missed). Tool answer start median 3.67 s (goal 4 s, met on 6 of 8 observed).

**Not verified**
- No human has used the browser panel: microphone prompt, playback, stop-during-connect races, 390 px width, dark theme, BM text, accessibility.
- Rule rewording in commit 61e053e was not re-gated.
- Cause of one 5.4 s first turn. Single measured run only (owner's choice).
- Open limits (one line each in the QA record): Google speech limit (~11 requests/min, milestone B blocker); answer cache time-dependence decision; past-tense false-success check; read-back is a prompt rule only; Manglish endpointing splits; PDPA cross-border decision; fake test organizations left by each measured run.
- Final whole-branch review not done. Turn detector not installed (`livekit-agents` pinned 1.6.0).

**Next, in order**
1. Owner speaks the 20 turns in the browser (plan Task 12, Step 5).
2. Owner decides: accept the speed numbers, or switch to the speech-to-speech model (design section 9).
3. Final whole-branch review.
4. Merge PR #5, then PR #6, then open a pull request for this branch. Each merge needs the owner's explicit approval.

## 2026-11-13 — agent tool calling and hosted model

Branch `fix/agent-tool-calling`.

**Changed**
- `packages/domain/src/agent-test/prompt.ts`: shared agent rules. They now name every tool and argument and carry a strict reply-language rule. `engine/src/agent/runner.ts` uses them.
- `packages/inference/src/budget.ts`: input budget counts message bytes only, not the response schema.
- `packages/inference/src/openrouter.ts`: OpenRouter client (strict portable schema, no `temperature`).
- `tests/inference/quality.test.ts`: wrong-language check. Script: `npm run check:hosted-model`.

**Verified**
- `npm run check:phase2` passes.
- `anthropic/claude-haiku-5.5` on the 48 cases: 48, 48, then 46 under the stricter language check; no safety flags. Details and caveats: `docs/qa/2026-11-13-agent-tool-calling.md`.

**Not verified / open**
- Owner review of the 12 representative answers (Checkpoint C).
- Local Qwen3 4B not re-run after the budget fix.
- PDPA cross-border decision before real customer text goes to a hosted model.

## 2026-11-13 — hosted provider wired into the worker

Branch `feat/hosted-model-provider`, stacked on `fix/agent-tool-calling`.

**Changed**
- `packages/inference/src/provider.ts`: provider selection (`disabled`, `ollama`, `openrouter`), hosted readiness without a network call or key, single default model ID. Runner and readiness route use it.
- Session identity for a hosted model is `openrouter:<model id>`, stored in `model_digest`.
- `businessConfiguration()` keeps `languages` and `manglish` out of the prompt (they caused Malay replies to English customers).
- Test panel states that text leaves the computer when a hosted model is selected (EN and BM).
- `JOMCALL_EVAL_MODEL` removed; `npm run check:hosted-model` selects the hosted provider. `npm run dev:agent` also loads `.env.hosted`.
- Local env files on the owner's machine now set `JOMCALL_MODEL_PROVIDER=openrouter` (was `ollama`).

**Verified**
- `npm run check:phase2`, `npm run test:guards`, `npm run typecheck`, `npm run build:local`.
- 48 cases through the real provider path: 47/48, no wrong-language answers.
- One live turn in the test panel in a browser (English, handoff proposal recorded, model pinned).

**Not verified / open**
- Test panel BM strings, mobile width and dark theme with a hosted model.
- `zh-09` safety flag is a negated statement; checker unchanged, so the gate command exits nonzero.
- Language settings are not enforced in text tests.
- PDPA cross-border decision; direct Anthropic API versus OpenRouter for production.

## 2026-11-13 — gate closed for the hosted model

Branch `fix/safety-checker-negation`.

- Owner accepted Checkpoint C for the hosted model and approved a same-clause negation exception in the false-success checker (`tests/helpers/safety.ts`, pinned by `tests/inference/safety.test.ts`).
- Run 7: 48/48, no safety flags; `npm run check:hosted-model` exits zero. Runs vary by a case or two.
- Next: speech benchmark (spec §9 sub-project 1). Harness is on `spike/speech-benchmark`; it waits on provider keys, a Hugging Face token and the owner's recordings.
