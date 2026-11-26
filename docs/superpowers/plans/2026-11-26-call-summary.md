# Call Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each answered real phone call, write a short AI summary (reason, outcome, next step, in English and Bahasa Melayu) that every member sees on the call page, that owners and admins can correct or clear, and that the PDPA export carries.

**Architecture:** A trigger on `app.call` queues a `pending` row in a new table `app.call_summary` when an answered call ends. A `CallSummaryWorker` in the agent process (modelled on `SetupReadWorker`) claims one row at a time through `app_private.call_summary`, sends the turns to `claude-haiku-5-5`, runs code guards (quotes, personal details, false success) on the result and writes it back under its lease. The web app reads the row with the call and offers one owner/admin edit command.

**Tech Stack:** Postgres (Supabase) with row-level security, TypeScript, `@anthropic-ai/sdk` through `sharedAnthropicClient()`, `node:test`, Next.js.

**Spec:** `docs/superpowers/specs/2026-11-26-call-summary-design.md` (owner decisions D1-D5, 2026-11-26).

## Global Constraints

- Every member reads the summary (D1); call turns stay owners and admins only.
- The summary never quotes the caller (D1) and never repeats a personal detail: names, IC or passport numbers, phone numbers, email and street addresses, account or card numbers, health and money details (D5). It names the kind of detail instead.
- Free (D2): no price row, no `recordUsage`, no wallet check.
- Switch `JOMCALL_CALL_SUMMARY`: `disabled` (default, also unset or empty) or `anthropic`; anything else throws `CALL_SUMMARY_UNKNOWN: JOMCALL_CALL_SUMMARY`; `anthropic` without `ANTHROPIC_API_KEY` throws `CALL_SUMMARY_KEY_MISSING: ANTHROPIC_API_KEY` in the agent. Allowed in hosted staging and production (D4). Agent process only; the web service gets no key.
- Model `claude-haiku-5-5` (same constant style as `voiceModel` in `packages/inference/src/anthropic-voice.ts`).
- Logs carry ids and codes only, never turn text, summary text, numbers or keys.
- UI copy in English and Bahasa Melayu through `w(en, ms)`; mobile-first (check at 375 px).
- No real calls or transcripts in git; tests and the paid check use made-up calls.
- Commits: Conventional Commits, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only with a branch refspec: `git push -u origin feat/call-summary:refs/heads/feat/call-summary` (`main` is protected).
- Naming: the existing `CallSummary` type in `packages/contracts/src/phone.ts` is the call **list row**. The new AI summary type is `CallAiSummary`; never rename the old one.

Values fixed by this plan (the spec leaves them to the builder):

- Skip as `TOO_SHORT` (no model call): fewer than 2 completed turns, or `duration_seconds` under 15. Skip as `NO_TURNS`: zero completed turns.
- Lease 60 s; at most 3 attempts, then `failed`. Model request timeout 20 s.
- Each text field 1-300 characters after trimming; `next_step_*` may be null (none).
- Quote guard: 8 consecutive words from any caller turn (case-insensitive, punctuation stripped), or for CJK text 12 consecutive CJK characters.
- Switch-off display: a `pending` or `running` row older than 10 minutes shows nothing.
- The contact timeline does **not** show the reason this round.

Deviations from the spec, recorded in `NOTES.md` in Task 9:

- Spec 6.2 says `app_private.agent_call` inserts the row. That function is redefined in many migrations; this plan queues from an `after update of state on app.call` trigger instead (the same pattern as `app_private.follow_up_from_call_turn`), which covers both `call_end` and `maintain`.
- Spec 6.3 has two success-word rules. This plan implements the stricter phrase guard of the "Guards (builder's call after review)" bullet; the older single-word rule ("booked", "confirmed", "sent" when no booking exists) is dropped because a real call never creates a booking. Task 1 updates the spec's text to match.

## Review Focus

1. **Owner edits racing the worker.** An owner can only edit or clear a `done` row; a worker `write` whose lease is stale, or that arrives for a row no longer `running`, changes nothing. Pinned in Task 1 (`write after lease lost changes nothing`) and Task 5 (`edit on a pending summary is SUMMARY_NOT_READY`).
2. **Calls ended by a crash.** `maintain` ends a call with a turn still `running`; only `completed` turns count and are sent. Pinned in Task 1 (`crash-ended call queues and counts only completed turns`).
3. **Withheld numbers and Mandarin.** `caller_e164` null must not break the detail guard; Chinese text has no spaces, so the word-run quote guard alone would never fire. Pinned in Task 3 (`quote guard catches a CJK run`, `detail guard with no caller number`).
4. **Switch off for days.** Pending rows pile up; the screen must not say "Writing summary…" forever, and turning the switch on later must work through the backlog oldest first. Pinned in Task 4 (`disabled worker claims nothing`) and Task 6 (`old pending reads as hidden`).
5. **Staff and other organizations.** Staff read the summary but not turns and cannot edit; another organization sees nothing. Pinned in Task 1 (RLS test) and Task 5 (API test as `h.staff`, `h.bob`).

---

### Task 1: Table, trigger and worker function

**Files:**
- Create: `supabase/migrations/20261126100000_call_summary.sql`
- Modify: `docs/superpowers/specs/2026-11-26-call-summary-design.md` (6.1 first line: drop "or voice test session"; 6.2: say a trigger queues it; 6.3: drop the older single-word success rule)
- Test: `tests/db/call-summary.test.ts`

**Interfaces:**
- Produces: table `app.call_summary(id uuid pk, org_id uuid, namespace text, call_id uuid unique, state text check in('pending','running','done','skipped','failed'), skip_reason text check in('TOO_SHORT','NO_TURNS'), reason_en, reason_ms, outcome_en, outcome_ms, next_step_en, next_step_ms text (each `char_length<=300`), model text, attempts int default 0, lease_token uuid, lease_until timestamptz, error_code text check ~'^[A-Z_]{1,40}$', edited boolean default false, edited_at timestamptz, created_at, completed_at timestamptz, revision int default 1)`, foreign key `(org_id,call_id)` to `app.call(org_id,id)` on delete cascade; index on `(namespace,state,created_at)`.
- Produces: `app_private.call_summary(p_action text, p_namespace text, p_id uuid default null, p_lease uuid default null, p_data jsonb default '{}') returns jsonb`, security definer, executable by `jomcall_agent_jobs` only, namespace checked like `app_private.agent_call` (`local|staging|prod|test_<uuid>`, else `INVALID_NAMESPACE`). Actions:
  - `claim`: oldest `pending` row in the namespace (`for update skip locked`). If it has no completed turns, mark `skipped`/`NO_TURNS`; if fewer than 2 or `duration_seconds < 15`, mark `skipped`/`TOO_SHORT`; then try the next (at most 25 per call). Otherwise set `running`, `attempts=attempts+1`, new `lease_token`, `lease_until=now()+60s` and return `{id, lease, attempt, call:{outcome, transfer_result, after_hours, caller_e164}, turns:[{input, answer}], proposals:[kind]}` (completed turns only, ordered by `created_at,id`). Returns `null` when nothing is due.
  - `write`: with a matching live lease and `state='running'`, store the six fields and `model`, set `done`, `completed_at`, clear the lease, `revision+1`; returns `{ok:true}`; else `{ok:false}` and changes nothing.
  - `fail`: with a matching lease, store `p_data->>'code'`; back to `pending` if `attempts<3`, else `failed`; clear the lease.
  - `maintain`: `running` rows past `lease_until` go back to `pending`, or `failed` with `LEASE_EXPIRED` when `attempts>=3`; returns the count.
- Produces: trigger `call_summary_queue` `after update of state on app.call for each row when (old.state='active' and new.state='ended' and new.answered_at is not null)`, function `app_private.call_summary_queue()` (owner `jomcall_jobs`, security definer) inserting `pending` with the call's `org_id` and `namespace`, `on conflict (call_id) do nothing`.
- Produces: RLS on `app.call_summary` (enable and force): `tenant_read` for select to `jomcall_app` when `app_private.active_role(org_id) is not null`; `manager_update` for update to `jomcall_app` when the role is `owner` or `admin`; `grant select` and `grant update(reason_en,reason_ms,outcome_en,outcome_ms,next_step_en,next_step_ms,edited,edited_at,revision)` to `jomcall_app`. No insert or delete for the web role.

- [ ] **Step 1: Write the failing tests** in `tests/db/call-summary.test.ts`, using `createHarness()` from `tests/helpers/local.ts` and the `liveCall` style of `tests/db/follow-up.test.ts` (fake numbers, `insert into app.call ... contact_id`, turns with `state='completed'`):
  - `ending an answered call queues one pending summary`: set `answered_at`, insert 2 completed turns, update `state='ended'` with `duration_seconds=40` → one row, `state='pending'`, same `org_id` and `namespace`. Ending it a second way (update again) adds none.
  - `unanswered and refused calls queue nothing`: `answered_at` null → 0 rows; `state='refused'` → 0 rows.
  - `crash-ended call queues and counts only completed turns`: one completed and one `running` turn, end with `end_reason='expired'` → pending; `claim` marks it `skipped`/`TOO_SHORT` (1 completed turn).
  - `claim skips short calls and returns the next`: first call 1 turn (skipped `TOO_SHORT`), second call 0 completed turns (`NO_TURNS`), third call 2 turns and 40 s → returned with `attempt=1`, two turns in order, `proposals` kinds, and `call.caller_e164`.
  - `write needs the live lease`: claim, `write` with a random lease → `{ok:false}`, row still `running`; `write` with the real lease → `done`, fields stored, `revision=2`.
  - `write after lease lost changes nothing`: claim, set `lease_until` to the past, `maintain` → `pending`; the old lease's `write` → `{ok:false}`.
  - `third failure is final`: claim+`fail` three times → `failed` with the code; `claim` then returns `null`.
  - `staff read, cannot edit; other org sees nothing`: as the web role for `h.staff` (copy the `asApp(h, who, org, sql, args)` helper defined at line ~99 of `tests/db/follow-up.test.ts`), select returns the row; update of `reason_en` affects 0 rows; as `h.bob` in `orgB`, select returns 0 rows; `h.alice` (owner) update affects 1.
  - `deleting the contact deletes the summary`.
  - `web role cannot run the worker function`: calling `app_private.call_summary` as the web role fails with `permission denied`.

- [ ] **Step 2: Run to see them fail**
  Run: `npm run test:local -- tests/db/call-summary.test.ts`
  Expected: FAIL (`relation "app.call_summary" does not exist`).

- [ ] **Step 3: Write `supabase/migrations/20261126100000_call_summary.sql`** with the table, indexes, RLS, grants, trigger function, trigger and `app_private.call_summary` as specified above. Follow the ownership and `revoke all ... from public` style of `20261122100000_follow_up_queue.sql`. The function owner must be able to read `app.call`, `app.call_turn` and `app.call_proposal`; grant only what it needs.

- [ ] **Step 4: Apply and pass**
  Run: `npm run db:migrate:local && npm run test:local -- tests/db/call-summary.test.ts && npm run db:verify-migrations`
  Expected: all tests PASS; verify reports one more table with row-level security (63 if main reports 62).

- [ ] **Step 5: Update the spec text** (three edits listed under Files) and commit
  ```bash
  git add supabase/migrations/20261126100000_call_summary.sql tests/db/call-summary.test.ts docs/superpowers/specs/2026-11-26-call-summary-design.md
  git commit -m "feat(calls): call summary table, queue trigger and worker function"
  ```

### Task 2: The switch

**Files:**
- Modify: `packages/contracts/src/hosting.ts` (beside `setupReader`, line ~219)
- Modify: `packages/inference/src/provider.ts` (beside `agentSetupReader`, line ~133)
- Modify: `packages/contracts/src/hosted-env.ts` (entry beside `JOMCALL_SETUP_READER`; `ANTHROPIC_API_KEY.required` and its description; `readiness` check beside line ~717)
- Modify: `infra/hosted/.env.hosted.example`
- Test: `tests/hosting/guards.test.ts`, `tests/hosting/readiness.test.ts`, `tests/inference/provider.test.ts`

**Interfaces:**
- Produces: `callSummary(env: Env = process.env): "disabled" | "anthropic"` in `hosting.ts`.
- Produces: `agentCallSummary(env: Env = process.env): "disabled" | "anthropic"` in `provider.ts`.
- Produces: hosted env entry `JOMCALL_CALL_SUMMARY`, services `["agent"]`, not secret, not required, description "Optional: disabled (default) or anthropic; the agent writes call summaries with Anthropic". `ANTHROPIC_API_KEY` becomes required when voice, the setup reader or call summaries are on; description names all three.

- [ ] **Step 1: Failing tests**
  - `guards.test.ts`: `callSummary({})` is `"disabled"`; `{JOMCALL_CALL_SUMMARY:""}` is `"disabled"`; `"anthropic"` is `"anthropic"`; `"yes"` throws `/^CALL_SUMMARY_UNKNOWN: JOMCALL_CALL_SUMMARY$/` and the message does not contain `yes`.
  - `provider.test.ts`: `agentCallSummary({JOMCALL_CALL_SUMMARY:"anthropic"})` throws `CALL_SUMMARY_KEY_MISSING: ANTHROPIC_API_KEY`; with `ANTHROPIC_API_KEY:"k"` returns `"anthropic"`.
  - `readiness.test.ts`: a hosted agent env with `JOMCALL_QUEUE_NAMESPACE` `staging` and again `prod`, `JOMCALL_CALL_SUMMARY=anthropic` and a key reports no finding for either name; without the key, a finding names `ANTHROPIC_API_KEY`; `JOMCALL_CALL_SUMMARY=yes` gives a finding naming the variable.
- [ ] **Step 2: Run, see fail:** `npm run test:local -- tests/hosting/guards.test.ts tests/hosting/readiness.test.ts tests/inference/provider.test.ts` → FAIL.
- [ ] **Step 3: Implement** `callSummary`, `agentCallSummary`, the env entries and the readiness `check("JOMCALL_CALL_SUMMARY", () => callSummary(hostedEnv))`; add to `.env.hosted.example` under the agent block: `JOMCALL_CALL_SUMMARY=` with a one-line comment (sends call turns to Anthropic for summaries; approved for staging and production, 2026-11-26).
- [ ] **Step 4: Pass:** same command → PASS; `npm run typecheck` passes.
- [ ] **Step 5: Commit** `feat(calls): JOMCALL_CALL_SUMMARY switch and readiness`.

### Task 3: Summarizer and guards

**Files:**
- Create: `packages/inference/src/call-summary.ts`
- Test: `tests/inference/call-summary.test.ts` (add to `test:offline` in `package.json`)

**Interfaces:**
- Consumes: `sharedAnthropicClient` and the `AnthropicLike` shape used in `packages/inference/src/setup-reader.ts`.
- Produces:
  ```ts
  export const summaryModel = "claude-haiku-5-5";
  export type SummaryInput = {
    outcome: string | null; transferResult: string | null; afterHours: boolean;
    callerE164: string | null; turns: { input: string; answer: string | null }[]; proposals: string[];
  };
  export type SummaryFields = {
    reason_en: string; reason_ms: string; outcome_en: string; outcome_ms: string;
    next_step_en: string | null; next_step_ms: string | null;
  };
  export type GuardCode = "QUOTE" | "PERSONAL_DETAIL" | "FALSE_SUCCESS" | "INVALID_OUTPUT";
  export function summaryRequest(input: SummaryInput): { system: string; messages: { role: "user"; content: string }[]; max_tokens: number };
  export function parseSummary(text: string): SummaryFields | { error: "INVALID_OUTPUT" };
  export function guardSummary(fields: SummaryFields, input: SummaryInput): GuardCode | null;
  export async function writeSummary(client: AnthropicLike, input: SummaryInput, opts?: { signal?: AbortSignal }): Promise<{ fields: SummaryFields; model: string } | { error: GuardCode | "MODEL_FAILED" | "MODEL_TIMEOUT" }>;
  ```
  `summaryRequest` never includes `callerE164` in the content (it is only for the guard). `writeSummary` calls `messages.create` with `summaryModel`, parses, guards, and returns the first error.

- [ ] **Step 1: Failing tests** (fake client returning fixed text; no network):
  - `request leaves out the caller number`: `summaryRequest({...callerE164:"+60123456789"})` content does not contain `123456789`; system text contains "never quote", "Do not repeat names, numbers, addresses", "asked to book", "left a message", "Reason unclear" (the prompt rules of spec 6.3 and D5, in the builder's wording; assert these five phrases).
  - `parse accepts strict JSON and trims`: valid six-field JSON → fields; missing `reason_ms`, empty `outcome_en`, a 301-character field, or non-JSON → `{error:"INVALID_OUTPUT"}`; `next_step_en: null` allowed.
  - `quote guard catches 8 words`: caller turn "saya nak tanya pasal servis kereta myvi hari sabtu ni boleh" and a reason containing "nak tanya pasal servis kereta myvi hari sabtu" → `"QUOTE"`; 7 of those words → `null`.
  - `quote guard catches a CJK run`: caller "我想问一下星期六可以保养我的车吗" and a reason containing 12 of those characters in a row → `"QUOTE"`.
  - `detail guard`: each of `"IC 900101-14-5678"`, `"012-345 6789"`, `"ali@example.test"` in any field → `"PERSONAL_DETAIL"`; "gave their address for the delivery" → `null`.
  - `detail guard with no caller number`: `callerE164: null` and a clean summary → `null`.
  - `false-success guard`: each of "booking confirmed", "has been booked", "tempahan disahkan", "telah ditempah", "预约成功", "message sent", "pesanan dihantar" → `"FALSE_SUCCESS"`; "confirmed their address" and "asked to book a slot" → `null`.
  - `writeSummary returns MODEL_TIMEOUT on abort` and `MODEL_FAILED` when the client throws.
- [ ] **Step 2: Run, see fail:** `npm run test:local -- tests/inference/call-summary.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `call-summary.ts`. Ask for JSON only with exactly the six keys; reason and outcome in one sentence each; next step null when there is none.
- [ ] **Step 4: Pass** and `npm run test:offline` passes.
- [ ] **Step 5: Commit** `feat(calls): call summarizer with quote, detail and false-success guards`.

### Task 4: Worker in the agent process

**Files:**
- Create: `engine/src/agent/call-summary.ts`
- Modify: `engine/src/agent/index.ts` (create beside `setupRead`, start its `run()`, close it on shutdown, same as `setupRead`)
- Test: `tests/engine/call-summary.test.ts`

**Interfaces:**
- Consumes: `app_private.call_summary` (Task 1), `agentCallSummary`/`callSummary` (Task 2), `writeSummary`, `SummaryInput` (Task 3).
- Produces:
  ```ts
  export type CallSummaryDeps = { env?: Env; enabled?: boolean; write?: typeof writeSummary; client?: AnthropicLike; maintainEveryMs?: number };
  export class CallSummaryWorker {
    static create(namespace: string, deps?: CallSummaryDeps): Promise<CallSummaryWorker>;
    tick(): Promise<boolean>;   // maintain when due, then at most one claim; true when a row was handled
    run(): Promise<void>;       // own loop: 1 s after a handled row, 5 s otherwise
    close(): Promise<void>;
  }
  ```
  Own `pg.Pool` on `AGENT_DATABASE_URL` through `databaseConnection(...)`, `max: 2`. Disabled: `tick` runs `maintain` only and never claims. Logs only `CALL_SUMMARY_TICK_FAILED`, `CALL_SUMMARY_FAILED <code>` and the row id.

- [ ] **Step 1: Failing tests** (`createPhase2Harness` as in `tests/engine/setup-reader.test.ts`, fake `write`):
  - `writes a summary for an ended call`: end a 2-turn 40 s call → `tick()` true → row `done` with the fake's fields and `model`.
  - `guard failure retries then fails`: fake returns `{error:"QUOTE"}` three times across three ticks → `failed`, `error_code='QUOTE'`; a fourth tick returns false.
  - `disabled worker claims nothing`: `enabled:false` → `tick()` false, row still `pending`.
  - `sends only completed turns and no caller number`: capture the fake's input → two turns, `callerE164` present only as the guard field, no running turn.
  - `close stops the loop promptly`.
- [ ] **Step 2: Run, see fail:** `npm run test:local -- tests/engine/call-summary.test.ts`.
- [ ] **Step 3: Implement** the worker and wire it in `index.ts` (`const summaryChoice = agentCallSummary();` at start so a missing key stops the agent with the code, as `agentSetupReader` does).
- [ ] **Step 4: Pass**, plus `npm run test:local -- tests/engine/setup-reader.test.ts tests/engine/agent-start.test.ts` still pass.
- [ ] **Step 5: Commit** `feat(calls): call summary worker in the agent process`.

### Task 5: API: read and edit

**Files:**
- Modify: `packages/contracts/src/phone.ts` (types and `callSummaryUpdate` schema)
- Modify: `packages/contracts/src/core.ts` (route `updateCallSummary`)
- Modify: `packages/domain/src/phone/routes.ts` (`/calls`, `/calls/:id`, `PATCH /calls/:id/summary`)
- Regenerate: `packages/contracts/openapi.json` with `npm run contracts:generate`
- Test: `tests/api/call-summary.test.ts`

**Interfaces:**
- Produces in `phone.ts`:
  ```ts
  export type CallAiSummary = {
    state: "pending" | "running" | "done" | "skipped" | "failed";
    reason_en: string | null; reason_ms: string | null; outcome_en: string | null; outcome_ms: string | null;
    next_step_en: string | null; next_step_ms: string | null;
    edited: boolean; created_at: string; completed_at: string | null; revision: number;
  };
  // CallSummary (list row) gains: reason_en: string | null; reason_ms: string | null  (only when state='done')
  // CallDetail gains: summary: CallAiSummary | null
  export const callSummaryUpdate = z.object({
    reason: z.string().trim().min(1).max(300).nullable(),
    outcome: z.string().trim().min(1).max(300).nullable(),
    nextStep: z.string().trim().min(1).max(300).nullable(),
    expectedRevision: z.number().int().positive(),
  }).strict();
  ```
- Produces in `core.ts`: `updateCallSummary: route("PATCH", "/calls/:id/summary", callSummaryUpdate.extend({ id: uuid }), out<CallAiSummary>())`.
- Behaviour: owner/admin only (staff 403, via `manager(ctx)`); row must be `done` else `409 SUMMARY_NOT_READY`; missing `404 NOT_FOUND`; stale revision `409 CONFLICT`; each given text is written to both `_en` and `_ms` columns; all three null means clear (all six null); sets `edited=true`, `edited_at=now()`, `revision+1`; through `command(...)` with an idempotency key and `audit(tx, ctx, "call_summary.updated", "call", id)` with no text in the audit data.

- [ ] **Step 1: Failing tests** (`createApiHarness`, a fake ended call with a `done` summary inserted by the cleanup connection):
  - detail as `h.alice` and as `h.staff` both include `summary` with the fields; staff `turns` is still `null`.
  - list rows carry `reason_en`/`reason_ms` for a `done` row and null for `pending`.
  - `h.staff` PATCH → 403; `h.bob` (org B) GET → 404.
  - `h.alice` PATCH `{reason:"Asked about Saturday servicing", outcome:null, nextStep:null, expectedRevision:2}` → 200; `reason_en === reason_ms === "Asked about Saturday servicing"`, `edited:true`, `revision:3`; repeat with revision 2 → 409 `CONFLICT`.
  - clear (all null) → six fields null, `edited:true`.
  - `edit on a pending summary is SUMMARY_NOT_READY` (409).
  - a call with no summary row → `summary: null`.
- [ ] **Step 2: Run, see fail:** `npm run test:local -- tests/api/call-summary.test.ts`.
- [ ] **Step 3: Implement** the types, route and handlers (left join `app.call_summary` on `call_id`); run `npm run contracts:generate`.
- [ ] **Step 4: Pass**, plus `npm run test:local -- tests/domain/contracts.test.ts tests/api/phone-numbers.test.ts` and `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(calls): call summary on the call read and an owner edit command`.

### Task 6: Screens

**Files:**
- Create: `web/lib/core/call-summary-rules.ts`
- Modify: `web/components/core/phone.tsx` (`CallDetail` block above the turns; list line under `outcomeText`)
- Modify: `web/app/core.css` (only if the block needs a style; reuse existing panel and label classes first)
- Test: `tests/domain/call-summary-rules.test.ts`

**Interfaces:**
- Consumes: `CallAiSummary`, `updateCallSummary` (Task 5).
- Produces:
  ```ts
  export type SummaryView = { kind: "hidden" } | { kind: "writing" } | { kind: "unavailable" }
    | { kind: "shown"; reason: string | null; outcome: string | null; nextStep: string | null; edited: boolean; cleared: boolean };
  export function summaryView(s: CallAiSummary | null, lang: "en" | "ms", now: number): SummaryView;
  ```
  `null` or `skipped` → hidden; `pending`/`running` younger than 10 minutes → writing, older → hidden; `failed` → unavailable; `done` → shown in `lang` (`cleared` when all six are null).

- [ ] **Step 1: Failing tests** for `summaryView`: each state above; `lang:"ms"` picks `_ms`; `old pending reads as hidden` (created 11 minutes before `now`); cleared row → `cleared:true`.
- [ ] **Step 2: Run, see fail:** `npm run test:local -- tests/domain/call-summary-rules.test.ts`.
- [ ] **Step 3: Implement** the rules and the screen. Copy (exact): heading "Summary" / "Ringkasan"; labels "Reason" / "Sebab", "Outcome" / "Hasil", "Next step" / "Langkah seterusnya", "None" / "Tiada"; tag "Written by AI" / "Ditulis oleh AI", or "Edited" / "Disunting" when `edited`; writing "Writing summary…" / "Menulis ringkasan…"; failed "Summary not available" / "Ringkasan tidak tersedia"; cleared "Summary cleared" / "Ringkasan dikosongkan". Owners and admins (not staff) see "Edit" / "Sunting" (three fields, Save "Save" / "Simpan", Cancel "Cancel" / "Batal") and "Clear" / "Kosongkan" (asks "Clear this summary?" / "Kosongkan ringkasan ini?"). Save and Clear send `expectedRevision` and one idempotency key per attempt, show the server error text on failure, and reload the call. The list line shows the reason in the viewer's language, one line, truncated with CSS.
- [ ] **Step 4: Pass**, then `npm run build:local`, `npm run build:mock` and `npm run build:hosted` (test `APP_ORIGIN=https://example.test`). Browser check in the local app at 375 px, English and Bahasa Melayu, light and dark, with a made-up call and summary inserted by SQL: shown, writing, unavailable, owner edit, clear, staff view without Edit.
- [ ] **Step 5: Commit** `feat(web): call summary on the call page and list`.

### Task 7: PDPA export

**Files:**
- Modify: `packages/domain/src/privacy.ts` (the `calls` query)
- Test: `tests/engine/privacy.test.ts` (extend the phone-calls export test)

**Interfaces:**
- Consumes: `app.call_summary` (Task 1).
- Produces: each exported call gains `summary: { state, reason_en, reason_ms, outcome_en, outcome_ms, next_step_en, next_step_ms, edited, created_at, completed_at } | null` (no lease, attempts, model or error code).

- [ ] **Step 1: Extend the test**: insert a `done` summary for the exported call; assert `calls[0].summary.reason_en`, `edited:false`, and that its keys are exactly the ten above; the other contact's summary text is absent.
- [ ] **Step 2: Run, see fail:** `npm run test:local -- tests/engine/privacy.test.ts`.
- [ ] **Step 3: Implement** a correlated `jsonb_build_object(...)` subselect in the existing calls query.
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** `fix(privacy): call summaries in the PDPA contact export`.

### Task 8: Paid check and QA record

**Files:**
- Create: `scripts/calls/check-summary.ts`, `scripts/calls/summary-cases.json`
- Modify: `package.json` (`"check:call-summary": "node --conditions=react-server --env-file-if-exists=.env.local --env-file-if-exists=.env.hosted --import tsx scripts/calls/check-summary.ts"`)
- Create after the run: `docs/qa/2026-11-26-call-summary.md`
- Test: `tests/inference/call-summary-check.test.ts` (argument parsing and scoring only; add to `test:offline`)

**Interfaces:**
- Consumes: `writeSummary`, `summaryRequest` (Task 3).
- Produces: `parseArgs(argv: string[]): { paid: boolean; dry: boolean; only?: string[]; out?: string } | { error: string }` and `scoreCase(c: SummaryCase, result: Awaited<ReturnType<typeof writeSummary>>): { pass: boolean; why: string[] }`, where `SummaryCase = { id: string; language: "ms"|"en"|"manglish"|"zh"; input: SummaryInput; reasonKeywords: { en: string[]; ms: string[] } }`.
- Behaviour, same as `scripts/setup/check-reader.ts`: no flag refuses with a message saying it costs money; `--dry` builds every request and sends nothing; `--paid` sends each case once and writes every output to `output/call-summary/<timestamp>.json` (gitignored `output/`).

- [ ] **Step 1: Write 16 made-up cases** in `summary-cases.json`: 4 each in BM, English, Manglish and Mandarin, covering a booking request, a message for staff, a handoff, a transfer, an after-hours call, a price question, an unclear call and a call where the caller gives an IC number, an address and an email. Fake names and numbers only.
- [ ] **Step 2: Failing tests** for `parseArgs` (no flag → error mentioning money; `--dry`; `--paid --only c01,c05`) and `scoreCase` (a guard error fails; a reason with no expected keyword in either language fails; a clean result with a keyword passes).
- [ ] **Step 3: Implement**, then pass `npm run test:offline` and run `npm run check:call-summary -- --dry`.
- [ ] **Step 4: Paid run, once, with the owner's go-ahead for the spend:** `npm run check:call-summary -- --paid`. Pass: 16 of 16 with no `QUOTE`, `PERSONAL_DETAIL` or `FALSE_SUCCESS`, and every reason with a keyword. Write `docs/qa/2026-11-26-call-summary.md`: date, model, command, counts, each case's six fields copied from the output file, failures and their codes, and "read by a person: not yet" until the owner reads them. If it fails, record it as is and stop for the owner; do not tune the prompt silently.
- [ ] **Step 5: Commit** `test(calls): paid check for call summaries and its record`.

### Task 9: Docs and owner steps

**Files:**
- Modify: `AGENTS.md` (Current state entry after the PDPA export entry; and the outbound-calls paragraph under "Frontend work": add the call-summary use of Anthropic, approved 2026-11-26 for staging and production, for summaries only)
- Modify: `.agent/handoff.md` (new top entry)
- Modify: `infra/hosted/RUNBOOK.md` (new step: apply `20261126100000_call_summary.sql` to staging with `npm run hosted:migrate` before the pull request is merged, rebuild the agent, then set `JOMCALL_CALL_SUMMARY=anthropic` for the agent when ready)
- Modify: `NOTES.md` (the two deviations above, dated)

- [ ] **Step 1: Write the entries.** Each says what was built, what was verified (commands and counts from this branch), what was not (no person has read summaries of real calls; nothing on staging; the privacy and terms text does not yet mention AI summaries: owner step).
- [ ] **Step 2: Final checks:** `npm run typecheck`, `npm run test:guards`, `npm run check:core` (run in the background; it takes over 10 minutes), `npm run db:verify-migrations`, the three builds. Expected: all pass; record the counts in the entries.
- [ ] **Step 3: Commit** `docs: call summaries in AGENTS, handoff, runbook and notes`, push with `git push -u origin feat/call-summary:refs/heads/feat/call-summary`, open the pull request against `main`. Do not merge.
