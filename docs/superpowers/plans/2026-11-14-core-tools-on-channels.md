# Catalogue Lookup on Phone and WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real phone calls and WhatsApp conversations can call `lookup_catalogue` and record an unanswered question, exactly as the browser test paths do today.

**Architecture:** The model-side tools already exist (`packages/domain/src/knowledge/tools.ts`). Two things stop them on real channels: the engine never passes the `core` input for those paths, and the SQL functions behind them (`app_private.agent_call`, `app_private.whatsapp_work`) reject the tool name and have no knowledge actions. This plan adds knowledge actions to those two functions, backed by one shared internal lookup, widens the gap log to the two channels, and passes `core` on both paths.

**Tech Stack:** TypeScript (engine, packages/domain, packages/contracts), Postgres plpgsql migrations (Supabase), node:test.

**Spec:** `docs/superpowers/specs/2026-11-14-setup-flow-design.md` (section 7, "Settled after an independent builder's read", first bullet). Background: `docs/superpowers/specs/2026-11-14-knowledge-core-design.md` (amendment on WhatsApp and real phone calls).

## Global Constraints

- Original work only; no new dependencies.
- No secrets, no personal data in git; test data is clearly fake.
- Work on a feature branch; small Conventional Commits; pull request into `main`.
- A snapshot without `packs` or `context` (`usesCore` false, `packages/domain/src/knowledge/prompt.ts:32`) must keep today's prompt and tools byte for byte on every channel.
- A catalogue lookup reads only the set frozen in the session's snapshot (`snapshot.catalogue.setId`), never live draft rows.
- The agent never states a price that is not in a returned catalogue row or a confirmed fact; when nothing is found it takes a message.
- Phone read-back before booking, transfer rules, STOP and staff keywords on WhatsApp are unchanged.
- Migrations are re-runnable (the shared local database is patched with psql; see `supabase/migrations/20261114200000_knowledge_core.sql:4-6`).
- New migration file name: `supabase/migrations/20261114230000_core_tools_channels.sql`.
- Paid model gates (`npm run check:hosted-model`, `npm run check:voice-model`) run only with the owner's go-ahead (Task 6).

## Review Focus

1. A version published **before** packs existed is answering a phone call: the caller must get exactly today's behaviour, no new tool offered. (Task 3 test.)
2. The model calls `lookup_catalogue` with every argument blank, or a 500-character item: the call must not drop; the tool returns a validation failure the model can recover from. (Task 3 and Task 4 tests.)
3. A turn or call id from another organization is used for a lookup: refused, no rows. (Task 1 test.)
4. The owner edits the catalogue while a call is running: the call keeps reading the set frozen at publish. (Task 1 test.)
5. A caller's own phone number or name appears in an unanswered question on WhatsApp: the gap row stores it masked, and contact export and delete cover it. (Task 2 test.)

---

### Task 1: Shared lookup and knowledge actions in SQL

**Files:**
- Create: `supabase/migrations/20261114230000_core_tools_channels.sql`
- Test: `tests/db/core-tools-channels.test.ts`

**Interfaces:**
- Produces: `app_private.knowledge_lookup(p_org uuid, p_set uuid, p_action text, p_data jsonb) returns jsonb`. Internal (no grant to service roles). `p_action` is `'catalogue'` or `'units'`; returns the same JSON the `catalogue` and `units` actions of `app_private.agent_knowledge` return today.
- Produces: actions `'catalogue'` and `'units'` on `app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)` and on `app_private.whatsapp_work(text,text,uuid,uuid,jsonb)`. Each takes the same identifying arguments as that function's existing turn-recording action and applies that action's authority checks before reading. Input in the `jsonb` argument: `{item, code, fits}` for `catalogue`, `{model, vector, hashes}` for `units`.
- Produces: `lookup_catalogue` accepted in the tool allow-list of `agent_call` (`supabase/migrations/20261114190000_phone_calls.sql:267`) and `whatsapp_work` (`supabase/migrations/20261114120100_whatsapp_worker.sql:241`).

- [ ] **Step 1: Write failing tests** in `tests/db/core-tools-channels.test.ts`, following the set-up helpers used by `tests/api/knowledge-core.test.ts` and `tests/engine/phone-call.test.ts`:

  - `a phone turn looks up a frozen catalogue row`: publish a version with one confirmed row `{item: "Servis biasa 1.0HP", price 8000 sen}`, start a call, call `agent_call` action `catalogue` with `{item:"servis biasa", code:"", fits:""}`; expect one row with that item and price.
  - `a WhatsApp turn looks up a frozen catalogue row`: same through `whatsapp_work`.
  - `a lookup reads the published set, not later edits`: after `call_start`, change the row's price in the live catalogue and confirm; the lookup still returns 8000.
  - `another organization's call is refused`: the same call with a call and turn belonging to a second organization raises the function's existing authority error and returns no rows.
  - `recording a lookup_catalogue tool step is accepted on both channels`: a `record` / `turn_record` with `call.name = 'lookup_catalogue'` no longer raises `INVALID_TOOL`; a made-up name `delete_everything` still does.
  - `agent_knowledge results are unchanged`: the browser path's `catalogue` action returns the same JSON for the same input before and after the migration (compare against a literal expected value).

- [ ] **Step 2: Run them and see them fail**

  Run: `npm run test:local -- tests/db/core-tools-channels.test.ts`
  Expected: FAIL (unknown action, `INVALID_TOOL`).

- [ ] **Step 3: Write the migration.**

  - Move the catalogue and units query bodies out of `app_private.agent_knowledge` (`20261114200000_knowledge_core.sql:212-268`) into `app_private.knowledge_lookup`; `agent_knowledge` calls it. `security definer`, `set search_path=''`, owner as `agent_knowledge`, `revoke all ... from public`.
  - Add the two actions to `agent_call` and `whatsapp_work`. The set id comes from the snapshot that function already holds for the turn (`app.call.snapshot` / `agent_version.snapshot`): `nullif(snapshot->'catalogue'->>'setId','')::uuid`. No set id means an empty result, not an error.
  - Add `'lookup_catalogue'` to the two allow-lists with the guarded text substitution used at `20261114200000_knowledge_core.sql:303-314` (pattern from `20261114180000_hosted_namespaces.sql:16-36`). The substitution must raise if the expected text is not found.

- [ ] **Step 4: Apply and run**

  Run: `npm run db:migrate:local && npm run db:verify-migrations && npm run test:local -- tests/db/core-tools-channels.test.ts tests/api/knowledge-core.test.ts`
  Expected: migration replay passes; all tests PASS.

- [ ] **Step 5: Commit** `feat(db): knowledge lookups for phone and WhatsApp turns`

### Task 2: Gap log for phone and WhatsApp

**Files:**
- Modify: `supabase/migrations/20261114230000_core_tools_channels.sql`
- Modify: `packages/domain/src/knowledge/tools.ts:36-48,255`
- Test: `tests/db/core-tools-channels.test.ts`, `tests/domain/knowledge-core.test.ts`

**Interfaces:**
- Produces: `KnowledgeAccess.gap` and `gapRecord(question, language, channel, answer)` accept `channel: "text" | "voice" | "phone" | "whatsapp"`.
- Produces: action `'gap'` on `agent_call` and `whatsapp_work`, input `{key, question, language, channel, answer}`, same return as `agent_knowledge 'gap'`.
- Produces: `app.knowledge_gap_ask` gains nullable `call_id uuid` and `conversation_id uuid` (foreign keys to the phone call and WhatsApp conversation tables, `on delete cascade`); `session_id` becomes nullable; a check enforces exactly one of the three is set; the `channel` check allows `'text','voice','phone','whatsapp'`.

- [ ] **Step 1: Write failing tests**

  - `a phone gap is stored against the call`: `agent_call 'gap'` with channel `phone` creates an ask row with `call_id` set and `session_id` null.
  - `a WhatsApp gap masks contact details`: question `"boleh call saya 0123456789 nama Ali"` is stored with the number masked exactly as the browser path masks it (assert equality with the result of the existing masking for the same string through `agent_knowledge 'gap'`).
  - `contact export and delete cover channel gaps`: after a WhatsApp gap for a contact, the contact export includes the ask and contact deletion removes it (extend the existing export/delete test for gaps).
  - `an ask needs exactly one parent`: inserting with both `session_id` and `call_id`, or none, violates the check.
  - Domain: `gapRecord accepts phone and whatsapp channels` (type-level and value assertion).

- [ ] **Step 2: Run and see them fail**

  Run: `npm run test:local -- tests/db/core-tools-channels.test.ts tests/domain/knowledge-core.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** the columns, check, channel values and the two `gap` actions (reuse the body of `agent_knowledge 'gap'`, `20261114200000_knowledge_core.sql:254-265`, through a shared internal function `app_private.knowledge_gap_write(p_org uuid, p_parent jsonb, p_data jsonb) returns jsonb`), and widen the TypeScript channel type.

- [ ] **Step 4: Run** the two test files plus `npm run typecheck`. Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit** `feat(knowledge): gap log accepts phone and WhatsApp`

### Task 3: Core tools on real phone calls

**Files:**
- Modify: `engine/src/agent/voice-turn.ts:69-71,248-250,313,395-398`
- Modify: `engine/src/agent/phone-call.ts:118-128` and the `CallRepository` implementation it uses
- Modify: `engine/src/agent/phone-server.ts:97,135` only if wiring needs it
- Test: `tests/engine/phone-call.test.ts`, `tests/engine/voice-turn.test.ts`

**Interfaces:**
- Consumes: Task 1 and 2 actions on `agent_call`.
- Produces: `CallRepository.knowledge(envelope): KnowledgeAccess`, built like `engine/src/agent/repository.ts:154-168` but calling `app_private.agent_call` with the call's own identifying arguments.
- Produces: in `runVoiceTurn`, core tools are offered when `usesCore(snapshot)` and the repository has `knowledge`, with or without a `policy`. On a path with a policy the gap channel is `"phone"`; without one it stays `"voice"`.
- Produces: `phonePolicy(deps).runTool` passes `lookup_catalogue`, and `take_message` carrying `unanswered`, to `executeCoreTool` (`packages/domain/src/knowledge/tools.ts:195`); booking read-back and transfer handling are untouched.

- [ ] **Step 1: Write failing tests**

  - `a phone turn with packs offers lookup_catalogue`: with a snapshot that has `packs`, the tools passed to the model include `lookup_catalogue`.
  - `a phone turn without packs is unchanged`: with a snapshot without `packs` or `context`, the system text and tool list equal a stored copy of today's (snapshot-compare the two strings; this pins Review Focus 1).
  - `a phone lookup returns the frozen row and the answer carries its price`: fake model emits `lookup_catalogue {item:"servis biasa"}`, then an answer; the tool step is recorded and the row reached the model.
  - `blank lookup arguments do not end the call`: fake model emits `lookup_catalogue {item:"",code:"",fits:""}`; the turn completes with a spoken answer and no thrown error (Review Focus 2).
  - `an unanswered phone question records a gap on channel phone`.
  - `read-back is still enforced before a booking on a phone turn with core tools`.

- [ ] **Step 2: Run and see them fail**

  Run: `npm run test:local -- tests/engine/phone-call.test.ts tests/engine/voice-turn.test.ts`

- [ ] **Step 3: Implement** the repository method, the condition change in `voice-turn.ts` (drop the `!deps.policy` exclusion), the channel choice for gaps, and the `runTool` routing.

- [ ] **Step 4: Run** the two files plus `tests/engine/phone-server.test.ts` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(phone): catalogue lookup and gap log on real calls`

### Task 4: Core tools on WhatsApp

**Files:**
- Modify: `engine/src/whatsapp/worker.ts:219-230` and the repository object it uses for turn calls
- Test: `tests/engine/whatsapp-flow.test.ts`

**Interfaces:**
- Consumes: Task 1 and 2 actions on `whatsapp_work`.
- Produces: the WhatsApp worker calls `runTextBrain` with `core: { rules: coreAgentRules, knowledge, ... }` in the same shape as `engine/src/agent/runner.ts:154-169`, where `knowledge` is a `KnowledgeAccess` backed by `whatsapp_work` and gaps use channel `"whatsapp"`.

- [ ] **Step 1: Write failing tests**

  - `a WhatsApp turn with packs can look up the catalogue`.
  - `a WhatsApp turn without packs is unchanged` (same snapshot-compare as Task 3).
  - `an over-long lookup item is refused without failing the turn`: 500-character `item` (Review Focus 2).
  - `an unanswered WhatsApp question records a gap on channel whatsapp and still sends the take-a-message reply`.
  - `STOP still opts the contact out when core tools are on`.

- [ ] **Step 2: Run and see them fail**

  Run: `npm run test:local -- tests/engine/whatsapp-flow.test.ts`

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the file plus `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(whatsapp): catalogue lookup and gap log`

### Task 5: Whole-suite check and documents

**Files:**
- Modify: `AGENTS.md` (the knowledge core entry: phone and WhatsApp now get the catalogue tool and the gap log)
- Modify: `docs/superpowers/specs/2026-11-14-knowledge-core-design.md` (dated amendment, three lines)
- Modify: `.agent/handoff.md` (new entry: changed, verified, not verified)

- [ ] **Step 1: Run** `npm run typecheck && npm run test:guards && npm run check:core && npm run db:verify-migrations`. Expected: all PASS; record the counts.
- [ ] **Step 2: Update the three documents** with what changed, the counts from Step 1, and "paid gates not re-run" unless Task 6 was done.
- [ ] **Step 3: Commit** `docs: catalogue lookup on phone and WhatsApp`, push, open the pull request.

### Task 6: Paid quality gates (owner's go-ahead required)

Changing the tool list changes what the model sees on phone turns. The two 48-case gates have also been stale since the knowledge core.

- [ ] **Step 1: Ask the owner** before spending: "Run `npm run check:hosted-model` and `npm run check:voice-model` now? Each sends 48 fake cases to the hosted model."
- [ ] **Step 2: With a yes, run both** and record pass counts and any wrong-language or false-success flags in `docs/qa/` as a dated file, following `docs/qa/2026-11-13-agent-tool-calling.md`.
- [ ] **Step 3: Commit** the QA record. A gate below its accepted bar blocks the merge until the owner decides.
