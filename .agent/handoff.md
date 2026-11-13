# Handoff

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
