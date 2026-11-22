# Follow-up queue and owner alerts: design

Date: 2026-11-22. Status: approved by the owner on 2026-11-22. Branch `feat/follow-up-queue` (from `main` at `6316470`).

## 1. Why

When the agent takes a message, records a booking request or asks for staff, the item is saved but nobody is told and nobody can close it. Call items (`app.call_proposal`) are visible to owners and admins only and have no command to change their state. WhatsApp items (`app.conversation_proposal`) are visible to every member and are shown read only in the inbox ("Read-only: no command acts on a chat's proposals yet", `web/components/core/inbox.tsx`). The engine sends no email about them. The CRM research (`reports/CRM layer for Malaysian SMEs.md`, untracked, build order items 2 and 3) ranks this as the first CRM gap: the caller was promised a callback and the business may never see it.

Success: every item the agent creates appears in one list the whole team works, the owner and admins hear about it by email within minutes, and an item can be assigned, given a due time, and closed.

## 2. Decisions taken with the owner (2026-11-22)

- **D1. The whole team works the list.** Every active member (owner, admin, staff) sees each item and can mark it done or dismissed. Staff see the item, not the call transcript. Owners and admins assign an item to a member and set a due time.
- **D2. Alerts, option A.** Every new item emails the owner and every active admin. Assigning an item to a member emails that member. No morning summary yet (a later addition).
- **D3. One new follow-up table** (approach 1 below).
- **D4. Emails carry no customer details** (option B): the kind of item, where it came from and the time, plus a link. No caller name, number or message text. This matches the existing rule for billing emails.
- **D5. Booking requests are confirmed into JomCall's own calendar** (option B, Claude's recommendation, taken by the owner). A booking item offers **Confirm booking** and **Decline** instead of Done and Dismiss. Confirm creates a confirmed `app.booking` for the item's contact, resource and start time through the existing booking code (`packages/domain/src/booking/commands.ts`: request then confirm, with its clash check against confirmed bookings on the same resource), links it to the follow-up, and closes the item as done. If the slot was taken in the meantime, or the resource no longer exists, nothing is created, the item stays open and the screen says why. Undo of a confirmation cancels that booking. Decline closes the item as dismissed and creates nothing. Without this, the agent's availability check (which counts only confirmed bookings) would keep offering a slot staff had already agreed by phone. "No calendar sync" in this design means no external calendar (Google, Outlook); JomCall's own calendar is used. A booking item without a contact (withheld caller ID) cannot be confirmed from the list, since a booking needs a contact; it offers Decline and a link to Bookings.

Proposed by Claude and not objected to (the owner may still change them while reading):

- A new page **Follow-ups / Susulan** in the sidebar for every role, with an open-item count.
- Tabs **Open** (default), **Mine** (assigned to me and open) and **Done** (done and dismissed, newest first). Open is oldest first, so the longest-waiting caller is on top.
- Done and Dismiss have a few seconds of Undo (a reopen).
- The call page and the WhatsApp chat show each item's state with a Done button, so staff need not switch pages.
- Resolving a WhatsApp chat leaves its items open: a callback may still be owed.

## 3. Goals, non-goals, anti-goals

Goals
- One list of every agent-created item from real phone calls and WhatsApp, with state, assignee and due time.
- An email to the owner and admins for each new item, and to a member when an item is assigned to them.
- The item's state shown and changeable on the call page and the chat.

Non-goals (this round)
- Items from browser or typed agent tests (`app.test_proposal`): tests already have their own apply flow.
- Manual follow-ups created by staff, reminders when an item is overdue, a morning summary, web push, a native app, notification settings, per-member language.
- Calendar booking, SMS or WhatsApp to the caller.
- Items for calls with no contact are included (see 5.1); a merge of contacts is not.

Anti-goals (a failure even if it works)
- Customer data in an email (D4).
- Staff gaining access to what was said on a call (turns, tool steps) through this feature.
- An item that silently disappears: a follow-up must survive everything except contact deletion, a retried agent turn (which deletes the agent's own item before re-creating it) and organization deletion.
- A second email for the same event, or an email about an item already closed when the email is sent.

## 4. Approaches considered

1. **One new `app.follow_up` table (chosen, D3).** Created by the database when the agent saves a call or WhatsApp item; holds the copied item details, state, assignee, due time, who closed it and when. One visibility rule (every active member reads), one state machine, one source for alert emails. Cost: the item details are stored twice, so the PDPA export and deletion must cover the new table; deletion follows from cascades.
2. **Add the columns to both existing tables and union them in a read function.** No copy, but every screen and command handles two state names (`pending` and `open`) and two visibility rules, and staff need a special route to read call items without the transcript. More places to get privacy wrong.
3. **A database view over both tables.** Rejected: the call table's row-level security hides call items from staff, and a view that bypasses it to show them is a privacy hole that is hard to see in review.

## 5. Design

### 5.1 Data

New table `app.follow_up` (names are the builder's to adjust):

- `id`, `org_id`, `created_at`, `updated_at`, `revision` (optimistic concurrency, as elsewhere).
- Source: `source` (`call` or `whatsapp`), exactly one of `call_proposal_id` / `conversation_proposal_id` (each unique, each a foreign key to its proposal **on delete cascade**, so a retried turn that deletes its proposal also deletes the follow-up), plus `call_id` or `conversation_id` for links.
- `contact_id`, nullable, foreign key to the contact **on delete cascade** (PDPA deletion). A call with a withheld caller ID has no contact; its item still appears, shown as "Unknown caller".
- `kind` (`booking`, `message`, `handoff`) and `details` (a copy of the proposal's details: booking `{resourceId,startAt,title}`, message `{text}`, handoff `{reason}`; at most 8 KB as on the source tables).
- `state` (`open`, `done`, `dismissed`), `closed_by` (member user id), `closed_at`.
- `assignee_user_id` (an active member of the organization, or null), `due_at` (null or a time), `assigned_by`, `assigned_at`.
- `booking_id`, nullable: the confirmed booking created by Confirm booking (D5).

Creation (builder check, Claude's call): a follow-up is created **when the agent's turn completes**, not when the proposal row is inserted. Call proposals are inserted while a turn is still running and are deleted again if the caller talks over the agent or the turn is cancelled; a turn left running at `call_end` is marked cancelled without deleting its proposals; WhatsApp proposals from a failed or interrupted attempt are never deleted. Creating on completion means only items the caller or customer actually heard become follow-ups, no email is sent for an item that is withdrawn seconds later, and a WhatsApp retry does not leave a duplicate from the failed attempt. Concretely: when a `call_turn` or `conversation_turn` moves to `completed`, its proposals (for WhatsApp, those of the completed attempt) get follow-ups in the same transaction, and their alerts are queued then. Call booking proposals already exist only after a confirmed read-back. The proposal foreign keys keep `on delete cascade` as a safety net; an alert whose follow-up no longer exists is marked `skipped` (or cascades away) and sends nothing. Existing proposal rows of completed turns are back-filled once by the migration: pending or open ones as `open`, done and dismissed as they are; the back-fill queues no alerts.

State mirroring (one direction, Claude's call): when a follow-up's state changes, the source proposal's `state` is set to match (`open` maps to `pending` for calls and `open` for WhatsApp), so older readers (the PDPA export of WhatsApp proposals, any code still reading proposals) stay correct. The follow-up is the only place state is written: the web role's unused `update(state,revision)` grants on `app.call_proposal` and `app.conversation_proposal` are revoked, so nothing can write the proposal side directly and no reverse trigger is needed.

Member changes (Claude's call): when a member is deactivated, their open assignments are cleared (the item returns to "Unassigned" and appears in everyone's Open tab). A role change keeps the assignment, since every role sees the list.

Contacts pending deletion (Claude's call): follow-ups of a contact with `deletion_pending` are hidden from the list and counts, as the contact itself is.

Withheld caller ID (Claude's call): such items have no contact and stay until their call is deleted. There is no call retention rule yet (phone line design, open decision 8), so today they are kept indefinitely; this is recorded, not solved here.

Visibility and changes, enforced in the database, not only in the web layer:
- Every active member of the organization reads follow-ups.
- Any active member may close or reopen (state, `closed_by`, `closed_at`).
- Only owners and admins may change `assignee_user_id`, `due_at`, `assigned_by`, `assigned_at`; the assignee must be an active member of the same organization.
- Staff gain no read access to `call_turn`, `call_tool_step` or `call_proposal`.
- The agent roles create follow-ups only through the trigger.

The builder picks the mechanism (column grants plus policies, or narrow security-definer functions as the billing code does); the rule above is what tests must prove.

Caller name and number are read from the contact at display time (members already read contacts), not copied, so a corrected name shows everywhere.

### 5.2 Commands (web)

Following the existing command pattern in `packages/contracts/src/core.ts` and `packages/domain`:

- `followUps` (GET): filter `open` | `mine` | `done`, cursor paging, page size 50. Each row: id, kind, source, details, state, created_at, assignee (id and display name), due_at, closed_by/closed_at, contact (id, name, phone) or null, call_id or conversation_id.
- `followUpCount` (GET): open count, and open-and-mine count, for the sidebar badge and Home.
- `closeFollowUp` (POST): `{id, expectedRevision, state: "done" | "dismissed"}`; for a booking item, `done` is refused (use `confirmFollowUpBooking`).
- `confirmFollowUpBooking` (POST): `{id, expectedRevision}`; creates and confirms the booking (D5) and closes the item in one transaction; errors for a taken slot, a missing resource or no contact.
- `reopenFollowUp` (POST): `{id, expectedRevision}` (Undo, and reopening from the Done tab); reopening a confirmed booking item cancels its booking.
- `assignFollowUp` (POST): `{id, expectedRevision, assigneeUserId | null, dueAt | null}`; owners and admins only.

Each write takes an idempotency key and writes an audit row, as other commands do. A stale revision returns `CONFLICT`; the screen reloads the item.

The call detail and conversation reads return each item's follow-up id, state and revision so their Done buttons use the same commands.

### 5.3 Alerts

- Queue: a new `app.follow_up_alert` row per recipient and event, plus one `app.outbox` row of a new kind (for example `follow_up.alert`), written by the database in the same transaction as the event. The outbox namespace comes from the source (`app.call.namespace` or the WhatsApp channel's namespace).
  - **New item:** one alert for each active owner (the schema allows one) and each active admin.
  - **Assigned:** one alert for the new assignee, unless they assigned it to themselves.
- Dedupe: at most one alert per follow-up, recipient and event (an assignment event is identified by the follow-up's revision at assignment time).
- Sending (engine): resolve the recipient's email at send time (`app_private.auth_user_email`), check again before sending, and mark the alert `skipped` with no email when the follow-up is no longer open, the recipient is no longer an active member, or (for an assignment) is no longer the assignee. Retries and the failed state follow the billing notice pattern (four retries).
- Content (D4): no customer name, number or text, no organization name. English then Bahasa Melayu in one message, as the billing emails do. Subject, for example, "New follow-up in JomCall / Susulan baharu dalam JomCall". Body: the kind ("a message", "a booking request", "a request for staff"), the source ("from a phone call" / "from WhatsApp"), the time in Kuala Lumpur (for example "22 Nov 2026, 10:42"), and for an assignment "assigned to you". Link: `<app origin>/app/follow-ups?item=<id>` (the id is not personal data).
- Mail goes through the existing engine mail transport (`engine/src/mail.ts`); on hosted, that is the Resend relay already approved. No new outbound service.

### 5.4 Screens (local and hosted apps; not the mock preview)

- **Sidebar:** "Follow-ups / Susulan" for every role, with the open count. Placed after Home. The existing hidden "outbound" entry stays hidden; if its label also says "follow-up", rename one of them so two entries never share a name.
- **Follow-ups page** (`/app/follow-ups`), mobile first (390 px), English and Bahasa Melayu, light and dark:

```
Follow-ups (4 open)        [Open] [Mine] [Done]
──────────────────────────────────────────────
● Message · Call · 10:42 · Due today
  Aisyah  +60 12-333 0001  [Call]
  "Can someone call back about the service price?"
  Assigned: Faiz            [Done] [Dismiss] [⋯]
● Wants staff · WhatsApp · 09:15
  Mr Tan  +60 16-222 0102  [Open chat]
  Reason: complaint about last visit
  Unassigned                [Done] [Dismiss] [⋯]
```

  - "Call" is a `tel:` link; "Open chat" goes to the conversation in the inbox. A call item links to its call page; staff see the call row there as today, without what was said.
  - "⋯" (owners and admins): assign to a member, set a due time (Today, Tomorrow, or a date and time in Kuala Lumpur), clear either.
  - Done and Dismiss show "Done. Undo" for about five seconds.
  - `?item=<id>` scrolls to and highlights that item; if it is closed, the page says so.
  - Empty state: "Nothing to follow up. New messages and requests from the agent appear here."
- **Call page** (`web/components/core/phone.tsx` "To follow up" list): the call detail reads its items from the follow-up table **for every role** (today it returns `proposals: null` to staff); staff therefore see the call's items, including message text, but still not what was said. Show the state in words and a Done button instead of the raw `p.state`.
- **WhatsApp chat** (`web/components/core/inbox.tsx`): show open items from the follow-up table with a Done button; closed items are no longer shown as open.
- **Closing WhatsApp items and the chat's flag** (Claude's call): when the last open follow-up of a conversation is closed, the conversation's "needs staff" flag (`needs_attention`, `attention_reason`) is cleared, so the inbox and the list agree. Closing a handoff item does **not** hand the chat back to the agent: a person took the chat over, and only the existing Hand back action returns it, so the customer is never surprised by the agent cutting back in.
- **Home:** the "Needs you" panel counts open follow-ups (and "assigned to you") with a link to the page.

### 5.5 PDPA

- Export: the contact export gains `followUps` (kind, source, details, state, created_at, closed_at, due_at; not the staff user ids). Branch `fix/privacy-export-calls` (not merged) adds `calls` to the same export; whichever merges second resolves the conflict in `packages/domain/src/privacy.ts`.
- Deletion: covered by the cascade on `contact_id`; a follow-up for a withheld-caller call has no contact and goes with its call's retention.
- Alert rows hold no customer data (ids, recipient user id, reason, state).

## 6. Constraints

- **Production:** `staging.jomcall.com` is production since 2026-11-20. The migration is applied there only with the owner's explicit yes, migration before the engine and web rebuild (`infra/hosted/RUNBOOK.md`). The back-fill emails nobody: alerts are queued only for items created after the migration.
- **The web role reads `app.call` column by column** (billing columns excluded); nothing here reads `app.call` with `select *`.
- Clean-room rule: names and copy are JomCall's own.
- Malaysia first: times in `Asia/Kuala_Lumpur`, EN and BM copy, mobile first.
- No new dependency and no new outbound service.

## 7. Risks

- **Role checks done only in TypeScript** would let a staff member assign through a crafted request. Tests must call the database as staff.
- **Email volume:** a busy business could get many emails an hour. Accepted for this round; the morning summary and settings come later.
- **Duplicate items** if the agent records the same request twice in one call; shown as two items (the agent's own behaviour, not this feature's).
- **Shared phone numbers:** the item shows the oldest contact with that number (existing contact rule).
- **Mirroring:** a bug in state mirroring would make older readers and the list disagree; tests cover follow-up to proposal mirroring, the revoked proposal grants, and the cleared chat flag.

## 8. Testing

- Database: each role's read and write rights as above (staff can close, cannot assign, cannot read turns); cascade on contact deletion and on proposal deletion; back-fill; mirroring; one alert per recipient per event; no alert on back-fill or on self-assignment.
- Booking items: Confirm creates a confirmed booking and closes the item; a clash leaves the item open with an error; Undo cancels the booking; the agent's availability no longer offers the confirmed slot; no-contact items cannot be confirmed.
- Domain and API: each command, idempotency, `CONFLICT` on a stale revision, filters and paging.
- Engine: alert sent to the right addresses with no customer data in subject or body (assert the caller's name, number and text are absent); skipped when closed, when the recipient left or was unassigned; retries.
- PDPA: export contains `followUps`; deletion removes them.
- Browser (local app, made-up workspace): the page at 390 px and desktop, EN and BM, light and dark; Done with Undo; assign as owner; staff view without assign; the call page and chat buttons.
- The agent's prompts, tools and packs are unchanged, so the paid 48-case gates are not re-run.

## 9. Left to the builder

- Exact table, column, function and command names; trigger versus function placement; the mechanism for column-level rights.
- Whether `followUpCount` is its own command or part of an existing Home read.
- Copy wording within the rules above (EN and BM, no customer data in email).
- How the Done tab is ordered beyond "newest first" and how many rows it shows.

## 10. Build note (2026-11-22, branch `feat/follow-up-queue`)

Built in seven tasks (commits `f30914d` to the records commit). Deviations from this design and limits found while building:

**Deviations**
- Back-filled done or dismissed items have no `closed_by` or `closed_at` (unknown); the Done tab sorts by `coalesce(closed_at, created_at)`.
- A caller with no active role in the organization gets `NOT_FOUND`, not `FORBIDDEN` (hides whether the item exists); staff on assign still get `FORBIDDEN`.
- Reopening a confirmed booking item first checks the revision, reopens, then cancels the booking, all in one transaction. The screen asks "Cancel the booking for ...?" before it does (button "Cancel booking and reopen").
- A booking item sent to confirm that is not a booking gets `INVALID_STATE` (422). An unknown resource on confirm gives 404, the same as a missing item; the screen reloads the item to tell them apart.
- An alert for a contact whose deletion is pending is skipped. An alert for a recipient with no email address is skipped.
- The follow-up list excludes items whose contact is pending deletion; direct SQL by staff can still see them.
- The Done tab offers Reopen (the design mentions reopening, the brief listed no button).
- No single-item read exists. `?item=` and the reload after a conflict read the open list (up to 10 pages of 50).
- "Today" and "Tomorrow" due times mean 23:59 Kuala Lumpur on that day.
- Undo after Confirm booking reads "Booking confirmed." because Undo also cancels the booking.

**Known limits**
- A send that succeeds but whose acknowledgement fails can email twice (same as billing notices).
- A demoted admin still gets a `new` email that was queued while they were admin.
- `follow_up_close` accepts a booking id from another contact; reopen only cancels a confirmed booking of the item's own contact.
- At 390 px the quick bar shows Home / To follow up / Inbox (or Calls); Calls moves into the menu.
- Home can count a WhatsApp handoff twice (as a follow-up and as a chat waiting).
- The sidebar count does not poll; it updates on navigation.
- `?item=` searches the first 500 open items; beyond that it reads as closed.
- The assignee is shown by email address.
- The local sidebar shows both "To follow up" and the older outbound "Follow-up" (the latter is hidden in hosted).
- Saving an unchanged assignment from the menu re-sends it, bumps the revision and may email the assignee again.
- The agent's prompts, tools and packs are unchanged, so the paid 48-case gates were not re-run.

**Not verified**: no person has used it; the staff view, the WhatsApp chat buttons, the `?item=` highlight and the Bookings link (booking item without a contact) were not seen in a browser; no real email was sent (local mail catcher and fake sender only); nothing was applied to hosted staging.
