# Handoff

## 2026-11-14 — billing: prepaid MYR wallet (sub-project 5, partial)

Branch `feat/billing-wallet`, pull request open against `main`, not merged.

**Changed**
- Migrations `20261114150000_billing_wallet.sql` and `20261114150100_billing_wallet_fixes.sql`: append-only ledger, usage events, versioned prices, top-ups, provider events, receipts. Writes only through `app_private` functions owned by `nologin` role `jomcall_billing`; triggers refuse update, delete and truncate.
- `packages/billing`: `recordUsage` and `walletState` for other services; provider interface; Billplz client (never run against Billplz); local-only fake that signs Billplz-format callbacks.
- Routes `/api/v1/billing/*`, webhook `POST /api/billing/webhook/<provider>`, local wallet screen, `npm run billing:simulate | billing:reconcile | billing:admin`.
- Docs: `docs/research/payment-providers-malaysia.md`, `docs/superpowers/specs/2026-11-14-billing-design.md`.

**Verified**
- `npm run check:billing`: 15 tests (8 unit, 7 against the local database through the API) pass. See the pull request for the full command list and results.
- Both Billplz documentation signature examples reproduce exactly.

**Not verified**
- No real provider call, no merchant account, no browser check of the wallet screen (port 4182 was in use by another session).
- Callback delivery from the internet (needs the hosted deployment).

**Next**
1. Owner: approve a payment provider as an outbound service, then follow the checklist in the research note, section 6.
2. Phone line and WhatsApp sessions: call `recordUsage` after the provider confirms a call or conversation, and `walletState` before starting a new one.
3. Owner: final prices (new `billing_price` version).
4. On a database where the billing migration is not yet applied: run `npm run db:migrate:local` before `npm run db:verify-migrations`, or drop the stray `jomcall_billing` role first.

## 2026-11-14 — pre-launch fixes from the voice branch review

Branch `fix/voice-prelaunch-hardening`, started from `feat/voice-milestone-a` and merged with `main` after the voice work landed there. Pushed, with a pull request against `main`; not merged.

**Changed**
- CI: `.github/workflows/ci.yml` runs typecheck, `test:guards`, the new `test:offline` (database-free domain and inference tests, including `anthropic-voice.test.ts`) and the Python voice tests. The API, database and engine tests are not in CI: they need the local Supabase stack.
- The two `voice-server.test.ts` tests that spawn an agent on port 54633 skip with a message when the port is busy.
- False-success check (`packages/domain/src/agent-test/safety.ts`) covers past-tense delivery and booking claims in four languages and lets promises and conditions through; 86-sentence table in `tests/inference/safety.test.ts`.
- Agent process stops at start with `VOICE_MODEL_KEY_MISSING` when hosted voice has no `ANTHROPIC_API_KEY`; empty `JOMCALL_VOICE_PROVIDER` means disabled. The Python worker ends a job with `voice_keys_missing` before joining the room when a speech key is missing.
- Migration `20261114090000_voice_cache_expiry.sql`: cached answers expire after 7 days (not served, replaced on put, deleted by the worker's maintenance tick). The cache key ends with a fingerprint of the active booking resources.
- Browser room token has `canPublishData: false`. The room client is injected (`createDispatch` in `web/lib/server/api.ts`, `AgentTestDeps` in the routes); the `globalThis` seam is gone.
- Voice panel shows its own wording for `DISCLOSURE_REQUIRED` (`web/components/core/error-copy.ts`).

**Verified** (2026-11-14, this machine)
- `npm run check:phase2`: 192 tests, 190 pass, 2 skipped (port 54633 was busy), then 22 inference tests, 21 pass, 1 skipped. `test:guards` 20/20. `test:offline` 102 tests, 101 pass, 1 skipped. `typecheck` clean. `uv run pytest` 222 passed. `db:verify-migrations` passed.
- The new migration is applied to the shared local database (`npm run db:migrate:local`). A checkout without this branch will see one migration it does not have.

**Not verified / open**
- The workflow has not run on GitHub. `actionlint` is not installed here; the file was only parsed as YAML and its commands were run locally without env files. Action SHAs were read from the GitHub API on 2026-11-14.
- No hosted model or speech run: the widened false-success check was not tried against real model output, so its false-positive rate on live answers is unknown (a flagged sentence ends the turn as `UNSAFE_REPLY`).
- The two port-54633 tests did not run (port busy).
- The new voice wording and the missing-key paths were not checked in a browser or on a live call. The panel's behaviour when the worker ends a job with `voice_keys_missing` is unknown.
- The cache's time-dependence decision (QA record, known limits) is still the owner's.

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

## 2026-11-14 — call patterns research and pack drafts

Branch `claude/hopeful-neumann-aa3c64`. Research and data only, no product code.

**Changed**
- `docs/research/call-patterns.md`: validation of the call patterns, sector rules with sources, final list.
- `docs/research/pattern-packs/`: nine JSON packs (`every-business` plus eight patterns) and a README on the shape.

**Decided in the draft (owner has not reviewed)**
- Seven patterns became eight: "order and reservation" split into `order` and `reservation-rental`; "professional" renamed and narrowed to `case-intake`.
- Sector rules should become rule-only overlays chosen by business type.

**Verified**
- All nine files parse and pass a shape check (keys, references, counts). Details in the packs README.

**Not verified / open**
- Evaluation cases have not been run against a model.
- Sector rules rest mostly on secondary sources; a Malaysian lawyer should review them.
- Customer phrasings are not from real conversations. BM text not reviewed by a native editor.
- Largest gaps: structured catalogue with import, job status list, date-range availability, structured lead/order/intake records, real call transfer, caller verification.
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
