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
- `npm run check:voice-speed`, run 3 (20 turns, 3 calls): 20 of 20 answered, 0 timeouts, 0 refused voice requests. First sound median 1.42 s (p90 2.02 s, 16 of 20 within 1.5 s). Plain answer start median 3.02 s (goal 2.5 s, missed). Tool answer start: partial median 3.67 s over 6 of 8 observed turns (tool verdict: not decided). Silence goal missed (5.4 s, t01).

**Review and next steps**
- The final whole-branch review is done. Its fix wave is these commits: `fix(api): return up to 60 turns of a test session`; `fix(voice): keep the first half of a split utterance when a filler is playing`; `chore: pin the Anthropic SDK version exactly`; `docs: correct the voice measurement record and run instructions`.
- The pull request for this branch must target `docs/inbound-voice-design` (PR #6) or wait for #6 to merge.
- Open owner decisions: speed goals (design §9); the `av`/FFmpeg licence question; the fast-lane cache design before real callers; PDPA cross-border.

**Not verified**
- The owner spoke to the agent through the browser panel on 2026-11-14 (Chrome, desktop) and judged it "sounds great"; it was a free conversation, not the scripted twenty turns, with no timings recorded. Still unchecked: stop-during-connect races, 390 px width, dark theme, BM text, accessibility.
- Rule rewording in commit 61e053e was not re-gated.
- Cause of one 5.4 s first turn. Single measured run only (owner's choice).
- Open limits (one line each in the QA record): Google speech limit (~11 requests/min, milestone B blocker); answer cache time-dependence decision; past-tense false-success check; read-back is a prompt rule only; Manglish endpointing splits; PDPA cross-border decision; fake test organizations left by each measured run.
- Turn detector not installed (`livekit-agents` pinned 1.6.0).

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

## 2026-11-14 — phone line research

Branch `claude/vigorous-noether-dff306` (worktree), not pushed.

- Added `docs/research/phone-line-options.md`: providers for a Malaysian number over SIP, LiveKit SIP inbound set-up, Malaysian rules, call forwarding per carrier, three set-ups with cost at 300 minutes a month.
- Nothing built, nothing signed up for. Web research only; weak claims are labelled in the document.
- Next: owner answers section 9; phone SIPPALS and INVITE with the section 8 questions; buy one Plivo or Twilio number for a trial only on the owner's say.
## 2026-11-14 — production hosting plan (document only)

Branch `claude/amazing-villani-e117cb`.

**Changed**
- `docs/superpowers/specs/2026-11-14-production-hosting-design.md`: hosting options with prices checked that day, code changes needed for a `hosted` mode, security and PDPA points, staged rollout, owner decisions.

**Verified**
- Nothing hosted was created or changed. Prices marked "checked" were read on vendor pages on 2026-11-14; code facts come from a read-only survey of `feat/voice-milestone-a` at `8b05a18`.

**Not verified / open**
- Everything in §10 of the document: Singapore latency, call concurrency per server, hosted Supabase grants and bypass roles, pooler safety, LiveKit Agents production options.
- Owner decisions in §8; recommendation is Vercel Pro + Supabase Pro (Singapore) + one Singapore server.
- The sibling CI and phone-line plans were not available to cross-check.
## 2026-11-13 — speech providers decided

Branch `docs/speech-decisions`.

- Decision record: `docs/decisions/0001-speech-providers.md`. Text-to-speech: Google `gemini-3.8-flash-lite-tts`, preset chosen by the business. Speech-to-text: Deepgram `nova-3` multilingual, chosen in a second round the same day.
- Evidence: blind listening test of 7 hosted voices and 7 Gemini presets, streamed speed direct from Google, and three speech-to-text runs on 118 Revolab clips.
- Local only, not in git: fal voice generator on the spike worktree (`.local/speech-spike`, uncommitted), clips and transcripts under `spikes/speech-benchmark/data/`, keys in `.env.hosted` (`FAL_KEY`, `GOOGLE_CLOUD_API_KEY`, `HF_TOKEN`).
- Open: per-turn delay of three to four seconds as measured piecewise; Speechmatics and Deepgram untested; PDPA cross-border position.
- Next: plan for inbound voice (spec §9 sub-project 3), owner sign-off before code.
