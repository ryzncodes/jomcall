# Pattern packs (draft data)

Draft packs for JomCall's call patterns, written on 2026-11-14. The reasoning behind the list is in `../call-patterns.md`.

**The JSON files moved into the product on 2026-11-14.** They now live in `packages/domain/src/packs/`, are validated by `packSchema` in `packages/domain/src/packs/index.ts` at load, and are the only copy (so research and product cannot drift apart). This README still describes their shape. Each pack's evaluation cases are also written to `tests/fixtures/pack-evaluation.json`.

All sample data is fictional. Names carry "Contoh", and phone numbers use made-up `555 01xx` ranges.

## Files

| File | Pattern |
|---|---|
| `every-business.json` | Shared facts and rules for any business |
| `appointment.json` | A time slot with a person or room |
| `stock-price.json` | Is it in stock and how much |
| `quote-visit.json` | A job at the customer's place: estimate and visit |
| `order.json` | Goods made or packed for a date |
| `reservation-rental.json` | A unit held for a date or date range |
| `enrolment-lead.json` | Signing up for something that runs over time |
| `case-intake.json` | A matter for a licensed professional |
| `status-check.json` | Is my job ready |

A business turns on `every-business` plus one or more of the others. `pairsWith` lists the usual combinations.

## Shape

Every file has the same top-level keys, in the same order.

| Key | What it holds |
|---|---|
| `schemaVersion` | `1` |
| `id` | File name without `.json` |
| `name`, `callPurpose` | `{ en, ms }`. The purpose says what the call is for; it is what an owner reads to decide whether the pack applies |
| `businessTypes` | Examples only. A pack is not tied to an industry |
| `pairsWith` | Pack ids often used together |
| `facts` | Fields the owner fills: `key`, `label { en, ms }`, `type`, `required`, `example` |
| `catalogue` | `needed`, `reason`, `columns` (same shape as facts) and `sampleRows` |
| `interview` | Ordered questions: `order`, `en`, `ms`, `fills` |
| `rules` | Default rules: `id`, `kind`, `text { en, ms }` |
| `messageDetails` | What to collect when taking a message for this pattern |
| `tools` | `uses` (tools in today's contract) and `gaps` |
| `evaluation` | `knowledge`, `resources`, `cases` |

### Why this shape

- **Facts, catalogue and rules are separate keys** because they are the three kinds of knowledge agreed on 2026-11-14 and they reach the agent differently: facts are always shown, the catalogue is searched, rules outrank everything.
- **Fact types** are few and plain: `text`, `list`, `enum`, `boolean`, `number`, `money_sen`, `duration_minutes`, `date`, `hours`, `phone_e164`, `url`. Money is integer sen and phone numbers are E.164, as the project rules require.
- **`interview[].fills`** points at `facts.<key>`, `rules.<id>` or `catalogue`. Every fact is filled by at least one question, so the interview can be checked for completeness, and an answer has a known place to go.
- **Rules are sentences, not code.** `kind` is one of `unknown` (the agent does not know), `message`, `handoff`, `never`, `after_hours`, `always`. Every pack has at least one rule of each of the first five kinds, which are the five the task asked for.
- **Gaps are recorded beside the tools that exist**, each with what data it needs and what the agent does until it is built. This keeps a pack honest about what it can do today.
- **Labels, questions and rules are in English and BM.** Mandarin appears only in the evaluation data, because the owner-facing interface is in BM and English.

## Evaluation cases

Cases follow `tests/fixtures/agent-evaluation.json`: `id`, `language` (`ms`, `en`, `manglish`, `zh`), `kind`, `question`, and for `faq` cases `sourceOrdinal` (an index into this pack's `evaluation.knowledge`) and `contains` (a regular expression). Booking cases keep the `{day}` placeholder and `hour`.

Each pack has 12 cases, three per language: three plain answers (`faq`), three missing-knowledge cases (`missing`), three rule cases and three tool cases.

Three things were added to the fixture's shape, because the existing kinds could not express them:

| Addition | Meaning |
|---|---|
| `kind: "rule"` with `rule` and `notContains` | The named rule must be obeyed. `notContains` is a regular expression for wording that would break it. It is a coarse check; a real evaluator should also judge the answer |
| `expectTool` | The tool the agent should call. Present on all tool cases and on rule cases where the right move is a tool |
| `kind: "gap"` with `gapTool` | The request needs a tool that does not exist yet. `expectTool` is the correct fallback today, and `gapTool` is what the case should exercise once that tool is built |

`evaluation.resources` names the bookable resources the booking cases refer to. A harness would create them before the run, as the existing one does for "QA Room".

The cases have not been run against a model. A rule's `id` in a rule case may refer to a rule in `every-business.json`.

## Checks done

Each file parses as JSON. A script confirmed, for all nine files: identical top-level keys; unique fact keys and rule ids; every `fills` target exists; every fact is asked by a question; 12 to 20 interview questions; all five required rule kinds present; `uses` only names tools in `packages/contracts/src/agent-test.ts`; 12 cases split three per language and three each of `faq`, `missing` and `rule`; every `faq` pattern matches its source text; every `gap` case names a listed gap.

## Known limits

- Rules reflect the sector research in `../call-patterns.md`, which rests mostly on secondary sources. A Malaysian lawyer should review them before they are shown to owners as defaults.
- Customer phrasings in the cases are written from general familiarity with Malaysian usage, not taken from real conversations.
- The BM text has not been reviewed by a native editor.
