# Contact timeline: design (gap #4)

Date: 2026-11-24. Status: the owner asked for the builder's best guess
("just go with your best guess"), so every decision below is the builder's
call, not the owner's. Each one can be changed.

## Intent

An owner or staff member opens a contact just before calling the person back
or replying to them. They want to know what happened with this customer
lately, and what is still open. Today the facts are spread across Calls, the
Inbox, Bookings, Follow-ups and the contact panel. The timeline puts them in
one list on the contact panel, newest first.

## Goals

- One list per contact, newest first, of: calls, WhatsApp chats, bookings,
  notes (do-not-contact changes are saved as notes, so they appear too),
  consent records and follow-up items.
- Each entry gives one line of what happened, the time in Kuala Lumpur time,
  and a link to the full record where a screen for it exists.
- Open follow-up items and upcoming bookings are easy to see.
- Works for every role, and staff see only what they can already see
  elsewhere.

## Non-goals

- No new data and no migration. Every source table already has the contact
  and an index on it.
- No transcript in the timeline, for any role. Managers open the call to read
  what was said.
- Browser test sessions, unanswered-question (gap) rows and audit rows are
  left out: tests are not the customer, gaps are an agent-building task, and
  the audit log is managers only.
- The mock preview (4181) is unchanged.
- No search or filter inside the timeline yet.

## Anti-goals

- Staff reading call words through the timeline. That would break design D1
  of the follow-up queue ("staff see the item, not the call transcript").
- Showing records of a contact awaiting PDPA deletion that other screens hide
  (follow-up items).

## Approaches considered

1. **One read command that merges the sources in SQL (chosen).** A
   `contactTimeline` command runs one query: a `union all` of the six
   sources, each with its own small, indexed limit, sorted by time and paged
   with a keyset cursor. One round trip, one order, one cursor.
2. Have the screen call the existing list commands (calls, conversations,
   bookings, notes, consents, follow-ups) and merge in the browser. No new
   server code, but the call and chat lists cannot filter by contact today,
   paging across six lists in the browser is fragile, and it costs six
   requests per page.
3. A new timeline table written by triggers on each source. Fast to read,
   but a migration on staging, back-fill, and a second copy of personal data
   that PDPA export and delete would have to cover. Not worth it at this
   size.

## Design

### Read command

`contactTimeline`: `GET /contacts/:id/timeline`, input
`{ id, cursor? }`, output
`{ items: TimelineEntry[], next: string | null, open: TimelineEntry[] | null }`.
30 entries per page. `open` is filled on the first page only (no cursor):
the contact's open follow-up items, oldest first, at most 10, so an old open
item is never buried pages deep. On later pages it is `null`. Every role may call it. It answers 404 when the contact
is not in the workspace.

Each entry has `kind`, `id`, `at` (the time it is sorted by) and a few facts
for its one line:

| kind | sorted by | facts | link |
|---|---|---|---|
| `call` | `started_at` | state, refusal, outcome, duration, after hours, transfer result | `/app/calls?call=<id>` |
| `chat` | `last_message_at` (else `created_at`) | conversation state, owner, needs attention, last message's author and first 200 characters | `/app/inbox?conversation=<id>` |
| `booking` | `created_at` | title, start time, status | `/app/bookings?booking=<id>` |
| `note` | `created_at` | text | none |
| `consent` | `created_at` | channel, purpose, granted, evidence | none |
| `follow_up` | `created_at` | kind, state, due time | `/app/follow-ups?item=<id>` |

Rules:

- Calls select only the columns the web role is granted (the `SUMMARY`
  list of the call screen); never the billing columns, never call turns or
  proposals.
- A chat is one entry per conversation, not per message. Its last message
  text is shown to every role, because every member can already read it in
  the Inbox. Media messages show their kind, not a file.
- A chat sorts by its latest message, so it can move to the top of page one
  while someone is paging. A reader may then see it twice or miss it once.
  Accepted: the next load is correct.
- Follow-up items are left out while the contact awaits PDPA deletion, as on
  the follow-up screen. The other kinds still show, as the panel's notes and
  consent already do.
- The cursor holds the contact id, the sort time as text (as the follow-up
  list does, to keep microseconds) and the entry id; a cursor for another
  contact or a malformed one answers `INVALID_CURSOR` (422).
- The web role holds `select` on `app.call.contact_id` (checked on the
  local database on 2026-11-24), so filtering calls by contact needs no
  migration.
- Ties on time are broken by id. Ids are UUIDs from different tables, so a
  clash is not a practical concern.

### Screen

Order in the contact panel: header and editor, then "Still open" (the
`open` list, hidden when empty), then the existing Appointments section
(next 30 days, moved up so upcoming bookings are seen first), then a
"History" ("Sejarah") section, then notes, consent and privacy as today.
Notes and consent therefore show twice, in History and in their own
sections. That is on purpose: their sections hold the add forms and the
full consent list, and changing them is not part of this change. Each entry is one row: a short label (Call,
WhatsApp, Appointment, Note, Consent, Follow-up), its one line, the time,
and an "Open" link where there is one. Open follow-up items and bookings
that start in the future carry a small marker ("Open", "Upcoming"). A "Show
older" button appends the next page; entries already shown (same kind and
id) are dropped when a page is appended. Empty: "Nothing yet. Calls, chats,
appointments and notes for this person will show here." English and BM, as
every screen.

The call's one line reuses the call log's outcome wording, moved to a shared
helper so the two cannot drift.

`getContact` loses its unused `activityAvailable: false` placeholder.

## Risks (flagged before building)

1. **Staff seeing call words.** Covered by never joining call turns or
   proposals, and by a test that reads the timeline as staff.
2. **The web role's column grant on `app.call`.** Selecting a billing
   column would fail for every role. Covered by selecting the call screen's
   column list and by running the tests as the web role.
3. **Paging across six sources.** The cursor test sits inside each branch,
   before its own limit, on that branch's own sort time. Covered by a test
   with more than 30 entries across at least four kinds that checks strict
   order across the page boundary, with no repeats or gaps.
4. **Speed.** Each branch reads one contact through an existing index and
   stops at 31 rows; a chat's last message uses the existing per-conversation
   ordering. Not measured on staging.

## Left to the builder

Exact row layout and class names, icon choice, how much of a note's text to
show before cutting it.

## Follow-ups not in this change

- A link from the call page back to the contact (the call read has no
  contact id today).
- Filters on the call and chat lists by contact.
