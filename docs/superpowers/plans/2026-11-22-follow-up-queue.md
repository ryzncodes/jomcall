# Follow-up queue and owner alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One list of every agent-created item from real calls and WhatsApp that the whole team can close, assign and confirm, plus emails (no customer data) to owner and admins for new items and to a member on assignment.

**Architecture:** A new `app.follow_up` table is filled by database triggers when a call or WhatsApp turn completes; all state changes go through security-definer SQL functions that enforce roles; a new outbox kind `follow_up.alert` is sent by the engine; web commands and one new screen sit on top.

**Tech Stack:** Postgres (Supabase local), TypeScript, Next.js web app, engine with pg-boss outbox, node:test.

**Spec:** `docs/superpowers/specs/2026-11-22-follow-up-queue-design.md` (approved 2026-11-22). Read it before any task.

## Global Constraints

- Emails carry no customer name, number or message text and no organization name (D4). Tests assert their absence.
- Copy in English and Bahasa Melayu (`w("EN","BM")` in components; engine mails EN then BM in one message).
- Times in `Asia/Kuala_Lumpur`; dates as `22 Nov 2026` / `22 Nov 2026` (BM month names as in `noticeDay`, e.g. `Dis`).
- Mobile first: the screen works at 390 px; light and dark themes.
- Roles are enforced in the database, not only in TypeScript (spec 5.1). Staff never gain read access to `app.call_turn`, `app.call_tool_step` or `app.call_proposal`.
- No new dependency, no new outbound service (mail uses `engine/src/mail.ts`).
- Never `select *` from `app.call` as the web role (billing columns are not granted).
- Production (`staging.jomcall.com`) gets the migrations only with the owner's explicit yes; nothing in this plan applies them there.
- Clean-room rule: names and copy are JomCall's own.
- Work in the worktree `/Users/faiz/Documents/project/call-agent/.claude/worktrees/follow-up-queue` on branch `feat/follow-up-queue`. Small Conventional Commits. Commit only after the task's tests pass.

## Decisions fixed by this plan (spec section 9 left them to the builder)

- **Screen name:** the sidebar entry and page are **"To follow up" / "Untuk disusuli"** at `/app/follow-ups`, matching the call page's existing heading. The mock-only "outbound" entry keeps its "Follow-up / Susulan" label; the two never share a name.
- **Mechanism for rights:** the web role gets `select` on `app.follow_up` through RLS and **no** direct `update`; all writes go through `app_private.follow_up_close`, `follow_up_reopen`, `follow_up_assign`, owned by `jomcall_jobs`, executable by `jomcall_app`, each reading `app.org_id` / `app.user_id` settings and `app_private.active_role`.
- **Creation point:** `after update of state` triggers on `app.call_turn` and `app.conversation_turn` (state becomes `completed`), so `agent_call` and `whatsapp_work` bodies are not patched.
- **Two migration files:** `20261122100000_follow_up_queue.sql` (Task 1) and `20261122100100_follow_up_alerts.sql` (Task 2); they ship together.
- **Booking confirm** uses booking source `staff` (no constraint change).

## Review Focus

1. A staff member who crafts an assign request (API or direct SQL as `jomcall_app`) must get `FORBIDDEN`, and the row must not change. Test in Task 1 (SQL) and Task 3 (API).
2. A WhatsApp chat flagged for a reason other than an agent item (for example a STOP notice or a billing refusal) must stay flagged when its items are closed. Test in Task 1.
3. Confirming a booking item whose start time has passed, is under 15 minutes away, or is now taken must leave the item open with the booking error (`INVALID_BOOKING_TIME`, `SLOT_UNAVAILABLE`) and create no booking. Test in Task 4.
4. A double tap on Done (two requests with the same revision) must close once: the second returns `CONFLICT` (or the stored receipt for the same key), and no extra alert or audit row appears. Test in Task 3.
5. An item whose contact is deleted, or which is closed, while its email is queued must send nothing. Test in Task 5.

---

### Task 1: Follow-up table, creation, rights and mirroring (SQL)

**Files:**
- Create: `supabase/migrations/20261122100000_follow_up_queue.sql`
- Test: `tests/db/follow-up.test.ts`

**Interfaces:**
- Produces table `app.follow_up`: `id uuid pk`, `org_id`, `namespace text`, `source text check in ('call','whatsapp')`, `call_id`, `call_proposal_id` (unique), `conversation_id`, `conversation_proposal_id` (unique), `contact_id` (nullable), `kind text check in ('booking','message','handoff')`, `details jsonb` (≤ 8192 bytes), `state text default 'open' check in ('open','done','dismissed')`, `closed_by uuid`, `closed_at`, `assignee_user_id uuid`, `due_at`, `assigned_by uuid`, `assigned_at`, `booking_id uuid`, `revision int default 1`, `created_at`, `updated_at`; `unique(org_id,id)`; check exactly one of the two proposal ids; foreign keys `(org_id,call_proposal_id) → app.call_proposal(org_id,id) on delete cascade`, `(org_id,conversation_proposal_id) → app.conversation_proposal(org_id,id) on delete cascade`, `(org_id,contact_id) → app.contact(org_id,id) on delete cascade`, `(org_id,booking_id) → app.booking(org_id,id) on delete set null (booking_id)`; indexes on `(org_id,state,created_at)` and `(org_id,assignee_user_id) where state='open'`.
- Produces SQL functions (owner `jomcall_jobs`, `security definer set search_path=''`, `execute` granted to `jomcall_app` only), each returning the updated row as `jsonb` and raising `NOT_FOUND`, `CONFLICT` (stale revision or wrong state) or `FORBIDDEN`:
  - `app_private.follow_up_close(p_id uuid, p_revision int, p_state text, p_booking uuid default null) returns jsonb` — any active member; `p_state in ('done','dismissed')`; a `booking` item may become `done` only with `p_booking` (else raise `BOOKING_CONFIRM_REQUIRED`); sets `closed_by` from `app.user_id`, `closed_at`, `booking_id`.
  - `app_private.follow_up_reopen(p_id uuid, p_revision int) returns jsonb` — any active member; clears `closed_*` and `booking_id`.
  - `app_private.follow_up_assign(p_id uuid, p_revision int, p_assignee uuid, p_due timestamptz) returns jsonb` — owner or admin only; `p_assignee` null or an active member of the same org (else `INVALID_ASSIGNEE`); sets `assigned_by`, `assigned_at`.
- Triggers produced: creation on turn completion (both turn tables); state mirroring to the source proposal (`open` → `pending` for calls, `open` for WhatsApp); clearing the conversation flag when its last open item closes (only when `attention_reason in ('BOOKING_PROPOSED','MESSAGE_LEFT','HANDOFF_REQUESTED')`; bump `app.conversation.revision`); clearing open assignments when `app.member.active` becomes false.

- [ ] **Step 1: Write the failing tests** in `tests/db/follow-up.test.ts`, using `createHarness()` and `h.cleanup` to build a call (insert pattern from `tests/db/core-tools-channels.test.ts:182`) with a running `call_turn`, a `message` `call_proposal`, then `update call_turn set state='completed'`; and a WhatsApp turn via the `liveTurn` helper from the same file. Assertions:
  - `follow-up created on call turn completion`: exactly one `app.follow_up` with `source='call'`, `kind='message'`, `details` equal to the proposal's, `state='open'`, `contact_id` equal to the call's.
  - `no follow-up while the turn runs, none after turn_cancel`: zero rows before completion; a proposal deleted by cancel leaves none.
  - `follow-up created on WhatsApp turn completion` with `source='whatsapp'`.
  - `back-fill`: the migration's back-fill is a function `app_private.follow_up_backfill() returns int` (owner `jomcall_jobs`, no grant to `jomcall_app`) that the migration calls once. Test: delete the follow-up of a completed call turn's proposal, call `follow_up_backfill()` as the database owner, the follow-up is back with the proposal's state mapped (`pending`/`open` → `open`, `done` → `done`, `dismissed` → `dismissed`); calling it again returns 0 and adds nothing; a proposal of a running turn gets none.
  - `close mirrors state`: `follow_up_close(... 'done')` as the staff user (via `h.sqlAsApp` with `app.org_id`/`app.user_id` set as staff) sets `state='done'`, `closed_by=staff`, and the proposal's state becomes `done`; reopen sets proposal back to `pending` (call) / `open` (WhatsApp).
  - `staff cannot assign`: `follow_up_assign` as staff raises `FORBIDDEN`; row unchanged. `direct update refused`: `update app.follow_up set state='done'` as `jomcall_app` raises permission denied.
  - `staff cannot read call proposals`: `select from app.call_proposal` as staff returns zero rows (unchanged rule); `select from app.follow_up` as staff returns the item.
  - `proposal update grants revoked`: `update app.call_proposal set state='done'` as owner via `jomcall_app` raises permission denied (same for `conversation_proposal`).
  - `booking done requires booking id`: closing a `booking` item as `done` without `p_booking` raises `BOOKING_CONFIRM_REQUIRED`.
  - `stale revision`: close with an old revision raises `CONFLICT`.
  - `chat flag cleared on last close`: a conversation with two open items and `attention_reason='MESSAGE_LEFT'` stays flagged after the first close, is cleared after the second. **Review Focus 2:** with `attention_reason='OPTED_OUT'` (the STOP reason) and again with `'SEND_FAILED'`, closing all items leaves `needs_attention` true and the reason unchanged.
  - `deactivation clears assignment`: assign to staff as owner, `update app.member set active=false` for staff, the item's `assignee_user_id` is null and `state` still `open`.
  - `contact deletion cascades`: deleting the contact removes its follow-ups; deleting the call proposal removes its follow-up.
  - `other org invisible`: Bob's org sees none of org A's follow-ups.

- [ ] **Step 2: Run to verify they fail**
  Run: `npm run -s test:local -- tests/db/follow-up.test.ts`
  Expected: FAIL (relation `app.follow_up` does not exist).

- [ ] **Step 3: Write the migration** `20261122100000_follow_up_queue.sql` with the table, RLS (`enable`/`force`; `tenant_read` select policy for `jomcall_app` as in `20261120100000_phone_number_request.sql:32-39`, plus `contact` not `deletion_pending` filter left to the read query in Task 3), grants (`select` to `jomcall_app`; `select,insert` to the trigger owner), the three functions, the four triggers, the back-fill function `app_private.follow_up_backfill()` and one call to it (proposals whose turn is `completed`; `pending`/`open` → `open`, else as is; no alerts), and `revoke update on app.call_proposal, app.conversation_proposal from jomcall_app`. Follow the owner-change pattern (`grant create on schema app_private to jomcall_jobs` … `alter function … owner to jomcall_jobs` … `revoke create`). The trigger functions need `select` on the proposal and turn tables and `update(state,revision)` on the proposal tables and `update(needs_attention,attention_reason,revision,updated_at)` on `app.conversation` for their owner; grant exactly those. Namespace comes from `app.call.namespace` or the conversation's channel namespace.

- [ ] **Step 4: Apply locally and run the tests**
  Run: `npm run db:apply-migration:local -- supabase/migrations/20261122100000_follow_up_queue.sql && npm run -s test:local -- tests/db/follow-up.test.ts`
  Expected: PASS. Then `npm run db:verify-migrations` → "Scratch migration replay passed".

- [ ] **Step 5: Commit**
  `git add supabase/migrations/20261122100000_follow_up_queue.sql tests/db/follow-up.test.ts && git commit -m "feat(follow-ups): follow-up table, creation on turn completion, rights"`

### Task 2: Alert queue (SQL)

**Files:**
- Create: `supabase/migrations/20261122100100_follow_up_alerts.sql`
- Test: `tests/db/follow-up-alerts.test.ts`

**Interfaces:**
- Consumes: `app.follow_up`, `app_private.follow_up_assign` (Task 1).
- Produces table `app.follow_up_alert`: `id`, `org_id`, `namespace`, `follow_up_id` (fk `on delete cascade`), `user_id`, `reason text check in ('new','assigned')`, `event_revision int`, `state text default 'queued' check in ('queued','sent','skipped','failed')`, `attempts int default 0`, `created_at`, `sent_at`; `unique(follow_up_id,user_id,reason,event_revision)`; RLS enabled and forced, no grant to `jomcall_app`.
- Produces outbox kind `follow_up.alert` (`resource_id` = alert id), added to `app_private.claim_outbox`'s kind list by the same text-replace technique as `20261115123000_channel_metering.sql:172`.
- Produces `app_private.follow_up_alert_payload(p_outbox uuid, p_namespace text) returns jsonb` (owner `jomcall_jobs`, execute to `jomcall_worker`): returns `{operationId, email, reason, kind, source, createdAt, followUpId}` or null; returns null and marks the alert `skipped` when the follow-up is gone or not `open`, the user is not an active member, or (for `assigned`) is no longer the assignee; email from `app_private.auth_user_email(user_id)`.
- Produces `app_private.ack_follow_up_alert(p_outbox uuid, p_namespace text, p_failed boolean) returns void`: marks `sent` (with `sent_at`) or `failed`; a no-op when the alert is gone.
- Queueing rules (triggers): on `app.follow_up` insert by the creation trigger (not by the back-fill), one `new` alert per active owner and active admin; on `assignee_user_id` change to a non-null user different from `assigned_by`, one `assigned` alert with `event_revision` = the new revision.

- [ ] **Step 1: Write the failing tests** in `tests/db/follow-up-alerts.test.ts` (promote `h.staff` to `admin` with `h.cleanup` where an admin is needed, since the harness has no admin user):
  - `new item queues one alert per owner and admin`: with staff promoted to admin, completing a turn yields two `new` alerts (alice, staff) and two `follow_up.alert` outbox rows; with staff as staff, one.
  - `self-assignment queues nothing; assigning staff queues one`.
  - `back-fill queues nothing`: delete a follow-up, run `app_private.follow_up_backfill()`, no alert or outbox row appears (the alert trigger skips inserts made inside the back-fill, for example through a transaction-local setting `jomcall.follow_up_backfill='on'` that the function sets).
  - `payload`: returns the alice email and no `details`, contact name or phone keys; after closing the item, returns null and the alert is `skipped`.
  - `payload for unassigned`: an `assigned` alert whose item was reassigned returns null, `skipped`.
  - `ack`: `ack_follow_up_alert(...,false)` marks `sent`; `true` marks `failed`.
  - `claim_outbox` returns `follow_up.alert` rows for the namespace.

- [ ] **Step 2: Run to verify they fail**
  Run: `npm run -s test:local -- tests/db/follow-up-alerts.test.ts`
  Expected: FAIL (relation `app.follow_up_alert` does not exist).

- [ ] **Step 3: Write the migration** with the table, triggers, payload and ack functions, the `claim_outbox` patch (fail loudly with `raise exception` if the text to replace is not found), and grants.

- [ ] **Step 4: Apply and run**
  Run: `npm run db:apply-migration:local -- supabase/migrations/20261122100100_follow_up_alerts.sql && npm run -s test:local -- tests/db/follow-up-alerts.test.ts tests/db/follow-up.test.ts`
  Expected: PASS. `npm run db:verify-migrations` passes.

- [ ] **Step 5: Commit** `feat(follow-ups): alert queue for new and assigned items`

### Task 3: Commands: list, count, close, reopen, assign

**Files:**
- Create: `packages/contracts/src/follow-up.ts`, `packages/domain/src/follow-up/routes.ts`
- Modify: `packages/contracts/src/core.ts` (commands), `packages/contracts/src/index.ts` (export), `web/lib/server/api.ts` (register `followUpRoute` before `contactsRoute`), `packages/contracts/openapi.json` (regenerate)
- Test: `tests/api/follow-ups.test.ts`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces type `FollowUp = { id: string; kind: "booking"|"message"|"handoff"; source: "call"|"whatsapp"; details: Record<string, unknown>; state: "open"|"done"|"dismissed"; revision: number; created_at: string; due_at: string|null; closed_at: string|null; closed_by: string|null; assignee: { userId: string; name: string }|null; booking_id: string|null; contact: { id: string; name: string; phone: string|null }|null; call_id: string|null; conversation_id: string|null }` and `FollowUpPage = { items: FollowUp[]; next: string|null }`, `FollowUpCount = { open: number; mine: number }`.
- Produces commands (in `commands`, core.ts):
  - `followUps: route("GET", "/follow-ups", z.object({ view: z.enum(["open","mine","done"]).default("open"), cursor: z.string().max(200).optional() }).strict(), out<FollowUpPage>())` — page size 50; `open`/`mine` oldest first by `(created_at,id)`, `done` newest first by `(closed_at,id)`; hides items whose contact is `deletion_pending`; never selects from `app.call`.
  - `followUpCount: route("GET", "/follow-ups/count", empty, out<FollowUpCount>())`.
  - `closeFollowUp: route("POST", "/follow-ups/:id/close", z.object({ id: uuid, expectedRevision, state: z.enum(["done","dismissed"]) }).strict(), out<FollowUp>())`.
  - `reopenFollowUp: route("POST", "/follow-ups/:id/reopen", z.object({ id: uuid, expectedRevision }).strict(), out<FollowUp>())`.
  - `assignFollowUp: route("POST", "/follow-ups/:id/assign", z.object({ id: uuid, expectedRevision, assigneeUserId: uuid.nullable(), dueAt: instant.nullable() }).strict(), out<FollowUp>())`.
- Produces `followUpRoute(tx, ctx, method, path, body, key, query)` in `packages/domain/src/follow-up/routes.ts`, and `loadFollowUp(tx, ctx, id): Promise<FollowUp>` (exported for Task 4). Writes use `command(tx, ctx, key, "followUp.<action>", input, …)` and `audit(tx, ctx, "follow_up.<action>", "follow_up", id)`.

- [ ] **Step 1: Write the failing tests** in `tests/api/follow-ups.test.ts` (create items with the Task 1 test technique; requests through `createApiHarness`):
  - list `open` as staff shows the item with contact name and phone; `done` empty; `mine` empty until assigned.
  - count returns `{open:1, mine:0}`, then `{open:1, mine:1}` for the assignee.
  - close as staff → 200, `state:'done'`; reopen → `open`.
  - **Review Focus 4:** two close requests with different idempotency keys and the same `expectedRevision` → first 200, second 409 `CONFLICT`; exactly one `follow_up.close` audit row; the same key twice returns the same body.
  - **Review Focus 1:** assign as staff → 403 `FORBIDDEN`; assign as alice to staff with a due time → 200; assign to Bob (another org) → 422 `INVALID_ASSIGNEE`.
  - Bob's org gets an empty list and 404 on close.
  - a contact marked `deletion_pending` hides its item from list and count.

- [ ] **Step 2: Run to verify they fail**
  Run: `npm run -s test:local -- tests/api/follow-ups.test.ts`
  Expected: FAIL (404 `NOT_FOUND` from the dispatcher).

- [ ] **Step 3: Implement** the contract types, commands, route module and registration. Map the SQL error codes `BOOKING_CONFIRM_REQUIRED` (409) and `INVALID_ASSIGNEE` (422) to `AppError` in the route.

- [ ] **Step 4: Regenerate and run**
  Run: `npm run contracts:generate && npm run -s test:local -- tests/api/follow-ups.test.ts && npm run -s test:offline && npm run typecheck`
  Expected: all PASS (`tests/domain/contracts.test.ts` sees the five commands).

- [ ] **Step 5: Commit** `feat(follow-ups): list, count, close, reopen and assign commands`

### Task 4: Confirm booking, call and chat reads, PDPA export

**Files:**
- Create: `packages/domain/src/follow-up/booking.ts`
- Modify: `packages/domain/src/booking/commands.ts` (extract the confirm branch of `bookingCommand` into `confirmBookingInTransaction`), `packages/contracts/src/core.ts`, `packages/contracts/src/follow-up.ts`, `packages/domain/src/follow-up/routes.ts`, `packages/contracts/src/phone.ts` (`CallDetail.proposals` → `followUps: FollowUp[]`), `packages/domain/src/phone/routes.ts:262-280`, the conversation detail type and `packages/domain/src/whatsapp/routes.ts:203-207`, `packages/domain/src/privacy.ts`
- Test: `tests/api/follow-up-booking.test.ts`; extend `tests/engine/privacy.test.ts`

**Interfaces:**
- Consumes: `loadFollowUp` (Task 3), `app_private.follow_up_close(…, p_booking)` (Task 1), `requestBookingInTransaction(tx, ctx, {contactId, resourceId, title, startAt}, "staff")`.
- Produces `confirmBookingInTransaction(tx, ctx, bookingId: string, expectedRevision: number): Promise<Booking>` (same clash check and errors as today's confirm; `bookingCommand` calls it).
- Produces command `confirmFollowUpBooking: route("POST", "/follow-ups/:id/confirm-booking", z.object({ id: uuid, expectedRevision }).strict(), out<FollowUp>())`: in one transaction, refuse unless `kind='booking'`, `state='open'` and a contact exists (`CONTACT_REQUIRED`, 409); request then confirm the booking from `details.resourceId`, `details.startAt`, `details.title`; close as `done` with the booking id; booking errors propagate unchanged and roll everything back.
- `reopenFollowUp` (Task 3) gains: when the item has `booking_id` and that booking is `confirmed`, set it `cancelled` (revision + 1, audit `booking.cancel`, the name every booking cancel uses) before reopening.
- Call detail returns `followUps` for **every role** from `app.follow_up` (fields of `FollowUp`); turns stay manager-only. Conversation detail returns `followUps` the same way.
- PDPA export gains `followUps: [{kind, source, details, state, created_at, closed_at, due_at}]` for the contact (no user ids).

- [ ] **Step 1: Write the failing tests** in `tests/api/follow-up-booking.test.ts` (use `bookingFixture()` for a resource and `slotStart`-style valid times; create the booking item with `details` `{resourceId, startAt, title}`):
  - confirm → item `done` with `booking_id`; `app.booking` row `confirmed`, `source='staff'`; the agent availability (`agent_call` action `availability` or the booking list) no longer offers that slot.
  - **Review Focus 3:** a slot already confirmed for another contact → 409 `SLOT_UNAVAILABLE`, item still `open`, no new booking row; a start time in the past or 10 minutes ahead → 422 `INVALID_BOOKING_TIME`, item `open`.
  - an item with no contact → 409 `CONTACT_REQUIRED`.
  - reopen a confirmed booking item → booking `cancelled`, item `open`, `booking_id` null.
  - `closeFollowUp` `done` on a booking item → 409 `BOOKING_CONFIRM_REQUIRED`; `dismissed` → 200 (Decline).
  - call detail as staff includes `followUps` with the message text and `turns: null`; as alice includes both.
  - conversation detail `followUps` shows the closed state after close.
  - privacy export (extend `tests/engine/privacy.test.ts`): `followUps` present for the contact, without `closed_by` or `assignee`.

- [ ] **Step 2: Run to verify they fail**
  Run: `npm run -s test:local -- tests/api/follow-up-booking.test.ts tests/engine/privacy.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces. Keep `bookingCommand`'s behaviour identical after the extraction (existing booking tests must still pass).

- [ ] **Step 4: Run**
  Run: `npm run contracts:generate && npm run -s test:local -- tests/api/follow-up-booking.test.ts tests/engine/privacy.test.ts tests/api/*.test.ts && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(follow-ups): confirm booking requests into the calendar; items on call and chat`

### Task 5: Engine sends alert emails

**Files:**
- Create: `engine/src/follow-up-alert.ts`
- Modify: `engine/src/engine.ts` (payload enum `:24`, dispatch near `:494`, failure handling near `:555`)
- Test: `tests/engine/follow-up-alert.test.ts` (text, pure) and `tests/engine/follow-up-alert-send.test.ts` (with `FakeSender`, pattern of `tests/api/phone-number-request.test.ts:200`)

**Interfaces:**
- Consumes: Task 2 payload and ack functions.
- Produces `parseFollowUpAlert(value: unknown): FollowUpAlert` and `followUpAlertMail(a: FollowUpAlert, appBase: string): { subject: string; text: string }` where `FollowUpAlert = { operationId: string; email: string; reason: "new"|"assigned"; kind: "booking"|"message"|"handoff"; source: "call"|"whatsapp"; createdAt: string; followUpId: string }`.
- Exact copy (fixed; `<when>` is `22 Nov 2026, 10:42` in Kuala Lumpur, BM month names as `noticeDay`; `<link>` is `${appBase.replace(/\/+$/,"")}/app/follow-ups?item=<followUpId>`):
  - Subject, new: `New follow-up in JomCall / Susulan baharu dalam JomCall`; assigned: `A follow-up was assigned to you / Satu susulan diberikan kepada anda`.
  - EN line: `The JomCall agent <action> <from> at <when>.` with action `took a message` / `recorded a booking request` / `asked for a staff member`, from `from a phone call` / `on WhatsApp`. Assigned adds the line `It has been assigned to you.`
  - BM line: `Ejen JomCall <action> <from> pada <when>.` with action `menerima mesej` / `merekodkan permintaan tempahan` / `meminta kakitangan`, from `daripada panggilan telefon` / `di WhatsApp`. Assigned adds `Susulan ini diberikan kepada anda.`
  - Then `Open: <link>` and `Buka: <link>`. EN block, blank line, BM block, as `billingNoticeMail` lays out.
- Engine: on `follow_up.alert`, call payload; if non-null, `mail.send({ to: email, subject, text, operationId })`; then ack `false`. On error with `job.retryCount >= 4`, ack `true` then fail, as for billing notices.

- [ ] **Step 1: Write the failing tests**
  - Text test: for each kind × source × reason, subject and text equal the exact copy; the text contains the link with the item id.
  - Send test: complete a turn with a `message` proposal whose contact is named `Pemanggil Rahsia` with phone `+60123334444` and text `Nombor akaun saya 12345`; tick the engine; exactly one mail to alice's confirmed email; subject and text contain none of `Pemanggil Rahsia`, `+60123334444`, `12345`, nor the organization name; alert `sent`. Ticking again sends nothing more.
  - **Review Focus 5:** close the item (second case: delete the contact) before the tick → no mail, alert `skipped` (or gone).

- [ ] **Step 2: Run to verify they fail**
  Run: `npm run -s test:local -- tests/engine/follow-up-alert.test.ts tests/engine/follow-up-alert-send.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** `follow-up-alert.ts` and the engine branch.

- [ ] **Step 4: Run**
  Run: `npm run -s test:local -- tests/engine/*.test.ts && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(follow-ups): engine emails for new and assigned items, no customer data`

### Task 6: Screens

**Files:**
- Create: `web/app/app/follow-ups/page.tsx`, `web/components/core/follow-ups.tsx` (`LocalFollowUps`)
- Modify: `web/components/experience.tsx` (screen union `:94` adds `"follow-ups"`), `web/components/core/local-app.tsx` (`:281-311` branch), `web/components/core/chrome.tsx` (`ActiveScreen` `:28`, nav item after `home` with key `"follow-ups"`, `Icon` from the existing phosphor set, label `t.followUps.nav`, open count badge from `followUpCount`; not shown in mock mode), `web/messages/en.json` / `ms.json` (`followUps.nav`: `To follow up` / `Untuk disusuli`), `web/components/core/phone.tsx:573-588`, `web/components/core/inbox.tsx:817-852`, `web/lib/core/home-rules.ts` (`NeedId` adds `"follow_ups"`, href `/app/follow-ups`), `web/components/core/home/load.ts` (read `followUpCount`)
- Test: extend `tests/domain/home-load.test.ts` (or the home-rules test) for the new need; component logic tests where the repo has them

**Interfaces:**
- Consumes: Task 3 and Task 4 commands via `client.execute`.
- The page follows spec 5.4 (layout sketch there): tabs Open / Mine / Done; per item kind label (`Message`/`Mesej`, `Booking request`/`Permintaan tempahan`, `Wants staff`/`Mahu kakitangan`), source and time, contact name (or `Unknown caller` / `Pemanggil tidak dikenali`) and number with `tel:` link, or `Open chat` / `Buka sembang`; text (message text, handoff reason, or booking title and time); assignee and due; buttons Done/Dismiss (Confirm booking/Decline for booking items, Decline only when there is no contact); `⋯` menu for owners and admins (assign to member from `workspaceMembers`, due Today/Tomorrow/date-time, clear). Undo toast `Done. Undo` / `Selesai. Buat asal` for about 5 seconds calls `reopenFollowUp`. `?item=<id>` scrolls to and highlights the item, or says `This item is already closed.` / `Item ini sudah ditutup.` Empty state: `Nothing to follow up. New messages and requests from the agent appear here.` / `Tiada apa untuk disusuli. Mesej dan permintaan baharu daripada ejen akan dipaparkan di sini.` A `CONFLICT` reloads the item and says `Someone changed this item. It has been reloaded.` / `Seseorang telah mengubah item ini. Item dimuat semula.`; booking errors use the existing error copy (`web/lib/core/error-copy` or equivalent).
- Call page and chat: replace raw `p.state` and the read-only list with each follow-up's state in words and the same Done/Confirm/Decline buttons.

- [ ] **Step 1: Write the failing test** for the home need: `needsYou` with `followUps: {open: 3, mine: 1}` yields a `follow_ups` need with count 3 and href `/app/follow-ups`; zero yields none.
- [ ] **Step 2: Run** `npm run -s test:local -- tests/domain/home-load.test.ts` → FAIL.
- [ ] **Step 3: Implement** the page, nav, home need, call page and chat changes.
- [ ] **Step 4: Run** `npm run typecheck && npm run -s test:local -- tests/domain/*.test.ts && npm run build:local && npm run build:mock && npm run build:hosted` (hosted with a test `APP_ORIGIN`) → PASS; the mock bundle has no follow-ups screen text.
- [ ] **Step 5: Browser check** in the local app (port 4182, made-up workspace, items created through a browser or typed test is not enough: create real items with the test SQL technique against the local database): 390 px and desktop; English and Bahasa Melayu; light and dark; Done with Undo; Confirm booking success and a clash error; assign as owner; staff view without the `⋯` menu; call page and chat buttons; sidebar count. Screenshot each and look at it.
- [ ] **Step 6: Commit** `feat(follow-ups): To follow up screen, sidebar count, call and chat buttons`

### Task 7: Records and full check

**Files:**
- Modify: `AGENTS.md` (Current state entry: what was built, verified, not verified, owner step to apply the two migrations before rebuilding the engine and web), `.agent/handoff.md` (entry), `docs/superpowers/specs/2026-11-22-follow-up-queue-design.md` (a dated build note listing any deviation), `NOTES.md` if deviations arose during build, `infra/hosted/RUNBOOK.md` (step: apply `20261122100000_follow_up_queue.sql` and `20261122100100_follow_up_alerts.sql`, then rebuild engine and web; the engine must not be rolled back past this change while `follow_up.alert` rows are queued)

- [ ] **Step 1: Run the full checks**
  Run: `npm run typecheck && npm run test:guards && npm run check:core && npm run db:verify-migrations && npm run build:local && npm run build:mock && npm run build:hosted`
  Expected: all pass (the known flickering guard `tests/local/model.test.mjs` "runtime ownership…" may fail once; rerun alone and record).
- [ ] **Step 2: Write the records** with the exact numbers from Step 1 and the browser check.
- [ ] **Step 3: Commit** `docs: follow-up queue records and runbook step`
