# Call summary: design

Date: 2026-11-26. Status: draft for the owner's approval; owner decisions D1-D5 recorded. Item 4 of the build order in the CRM gap report ("AI summary, reason and outcome on each call, beside the transcript").

## 1. Intent

An owner checking calls on a phone should understand a call in seconds without reading every turn. After each answered call, JomCall writes a short AI summary: why the person called, how it ended, and the next step for the business. It sits on the call page above what was said, marked as written by AI.

Why now: the follow-up queue (#89), the contact timeline (#91) and the call export (#92) made the call record useful; the summary is the most visible piece still missing. Every competitor in the CRM report writes something back after a call, and none publishes how accurate it is in Malay or Manglish, so JomCall's own checks are the evidence.

## 2. Owner decisions (2026-11-26)

- **D1. Every member sees the summary**: owners, admins and staff. What was said word for word stays owners and admins only, as today. To keep that rule meaningful, **the summary never quotes the caller**: plain paraphrase, no verbatim sentences.
- **D2. Free.** JomCall absorbs the model cost. No price row, no `recordUsage`, no wallet check; a summary is written whatever the wallet state.
- **D3. A background worker** in the agent process writes the summary after the call ends (approach 1 in section 5).
- **D4. New outbound use approved**: with `JOMCALL_CALL_SUMMARY=anthropic`, the agent process sends a call's turns to Anthropic (`claude-haiku-5-5`) to write the summary. Off by default; the agent process holds `ANTHROPIC_API_KEY` as it already does for voice and the setup reader; the web service gets no key. Approved for hosted staging and production alike (owner, 2026-11-26), so `hosted:readiness` does not refuse it in either; it still needs the key and is off unless set. This is for call summaries only and is not permission for any other outbound call.

- **D5. No personal details in the summary** (2026-11-26). Beyond D1's ban on quotes, the summary leaves out what staff cannot otherwise see: names, IC or passport numbers, phone numbers, email and street addresses, account or card numbers, health and money details. It says what kind of detail was given ("gave their address for the delivery"), not the detail. Booking and message details staff already see through the follow-up queue are not repeated.

## 3. Goals, non-goals, anti-goals

Goals
- A summary on every answered real phone call with at least one completed turn, within about a minute of the call ending.
- Fields: reason (why they called), outcome (one sentence), next step (or none). Each in English and Bahasa Melayu.
- Shown on the call page for every member, marked "Written by AI" / "Ditulis oleh AI"; the call list shows the reason under the outcome.
- Owners and admins can correct or clear a summary.
- Covered by the PDPA contact export and deleted with the contact.
- A paid check on fake BM, English, Manglish and Mandarin calls before the switch goes on in staging.

Non-goals (this round)
- WhatsApp chats: staff already read the whole chat in the Inbox.
- Browser voice test calls (builder's call after review, 2026-11-26): a voice test is an `app.test_session` with no recorded end (no stop command; the same session can be restarted and mixes typed and spoken turns) and is deleted after 24 hours, so there is no clean call to summarize. Adding a call boundary is its own change. Until a phone line exists on staging, the feature is seen in the local app with fake calls.
- Filling contact fields, caller memory, urgency flags, sentiment, lead status (later items in the report).
- Emailing the summary to owners.
- Summaries for calls that ended before this ships (no back-fill).

Anti-goals: what would make this a failure even if it works
- A summary that states something that did not happen: a booking "confirmed" when it was only requested, a promise to call back the agent never made. Same false-success rule as the agent gates.
- A summary that quotes the caller or repeats a personal detail, leaking to staff what D1 and D5 keep from them.
- A model failure or slow model that delays hang-up, billing or the call record.
- A summary on a dropped or near-empty call that invents a reason.
- An AI summary that changes how the customer is treated (do-not-contact, refusal). It is read-only text.

## 4. Constraints

- Mobile-first; EN and BM UI; times in `Asia/Kuala_Lumpur`.
- The web role (`jomcall_app`) reads `app.call` column by column without the billing columns; a new column on `app.call` would need a grant. Use a separate table instead.
- Only the agent process holds model keys.
- Calls are deleted with their contact (`on delete cascade`); the summary must follow.
- No customer data in logs: log ids and codes only.
- No real call audio or transcripts in git: tests and the paid check use made-up calls.
- PDPA guidelines of 30 April 2026 on automated decisions (CRM report): staff must be able to correct AI-derived data; the summary takes no action.

## 5. Approaches considered

1. **Background worker after the call ends (chosen, D3).** Ending a call (`call_end` or the `maintain` crash path in `app_private.agent_call`) inserts a pending summary row. A worker in the agent process claims one with a lease, sends the turns to the model, and writes the result through an `app_private` function that re-checks the lease. Same shape as the setup reader. Hang-up and billing are untouched; a model failure only leaves the summary missing or failed. Cost: a migration and a worker.
2. **Write it inside call end.** Fewest parts, but call end also bills the call; a slow or failing model would slow or break billing, and a worker crash leaves nothing. Rejected.
3. **Write it when someone first opens the call.** The web app has no key and would need a new path to the agent process; the first viewer waits. Rejected.

## 6. Design

### 6.1 Data

New table `app.call_summary` (one row per summarized call):

- `id`, `org_id`, `namespace`
- `call_id` (unique), foreign key cascading on delete of the call
- `state`: `pending`, `running`, `done`, `skipped`, `failed`
- `skip_reason`: `TOO_SHORT`, `NO_TURNS` (when skipped)
- `reason_en`, `reason_ms`, `outcome_en`, `outcome_ms`, `next_step_en`, `next_step_ms` (text, each capped, next step may be null meaning "none")
- `model`, `attempts`, `lease_token`, `lease_until`, `error_code`
- `edited_at`, `edited` (boolean: an owner or admin changed or cleared it; the screen then says "Edited" instead of only "Written by AI")
- `created_at`, `completed_at`, `revision`

Row-level security: every active member of the organization reads rows (D1). Owners and admins may update the six text fields and `edited` (correct or clear). An edit is one text per field written by the owner in either language and stored in both language columns, so every member sees the corrected text whatever their screen language (builder's call after review: a correction must reach the BM screen too). Clear empties all six and marks it edited. The agent jobs role inserts and updates through `app_private` functions only.

### 6.2 When a summary is queued

- Real call: a trigger (`call_summary_queue`) on `app.call` inserts a `pending` row in the same transaction when an answered call ends (`call_end`, or `maintain` after a crash). Unanswered and refused calls get no row.
- Skip rule (builder's call on the number, start point): fewer than 2 completed turns or under 15 seconds answered: row written as `skipped` with `TOO_SHORT`; no model call. The screen says nothing for skipped calls.

### 6.3 The worker

- Runs in the agent process beside the setup reader, both modes. With the switch off it claims nothing and summaries stay `pending` (the screen shows nothing for pending rows older than ten minutes when the switch is off; builder's call).
- Claims the oldest pending row, one at a time per tick, lease 60 seconds; at most 3 attempts, then `failed` with a code. A failed summary shows "Summary not available" / "Ringkasan tidak tersedia".
- Input to the model: the turns (caller input and agent answer, in order), the call outcome code, transfer result, after-hours flag, and the proposals' kinds. Not the agent snapshot, the caller's number or the contact's name.
- Output: strict JSON with the six fields, validated (length caps, no field empty except next step). One model call returns both languages.
- Prompt rules: paraphrase, never quote; describe only what happened in the turns; a booking request is "asked to book", never "booked", unless the outcome says a booking was made; a message for staff is "left a message", never "sent"; if the call is unclear, say so plainly ("Reason unclear") rather than guess.
- Guards (builder's call after review): a real call never creates an `app.booking` row, only a `booking` proposal (outcome `booking_proposed`), so the summary may never say a booking was made. The guard rejects booking-confirmation phrases on every real call ("booking confirmed", "booked for", "has been booked", "tempahan disahkan", "telah ditempah", and the Mandarin equivalents) and "message sent" / "pesanan dihantar" phrases; plain words like "confirmed their address" pass. The prompt says "asked to book" and "left a message".
- Prompt rule for D5: name the kind of detail, never the detail.
- After writing, a code check rejects a summary that contains any run of 8 or more consecutive words from a caller turn (quote guard), a personal-detail pattern (a run of 7 or more digits with spaces or dashes allowed, a Malaysian IC pattern `\d{6}-?\d{2}-?\d{4}`, an email address, or the caller's number in any format) (detail guard); rejected output counts as a failed attempt.

### 6.4 Screens

- Call page (`web/components/core/phone.tsx`, `CallDetail`): a "Summary" / "Ringkasan" block above the turns, with reason, outcome and next step in the viewer's UI language, and a small "Written by AI" / "Ditulis oleh AI" label (or "Edited" / "Disunting"). While pending: "Writing summary…" / "Menulis ringkasan…". Owners and admins see Edit and Clear.
- Call list: the reason (one line, truncated) under the outcome text.
- Contact timeline: calls show the reason as their one-line description (if cheap; else later).

Sketch, call page on a phone:

```
+60 12-345 6789
Today 10:42 · 2 min 13 s · Left a message
AI disclosure played

Summary                      Written by AI
Reason: Asked whether the shop can service
        a Myvi this Saturday.
Outcome: Left a message asking for a call back.
Next step: Call back before Saturday.
                               Edit · Clear

Caller: ...
Agent: ...
```

### 6.5 Privacy

- PDPA export: each exported call gains its `summary` (the six text fields, state, edited flag, times).
- Deletion: cascades with the call, which cascades with the contact.
- Privacy notice: the terms and privacy text should say calls are summarized by AI. Legal text is the owner's; this design flags it and does not edit it.

### 6.6 Checks

- Unit and database tests with a fake summarizer: queueing on end and crash, skip rule, lease, retries, quote guard, success-word guard, RLS (staff read, staff cannot edit, other org cannot read), export, cascade.
- Paid check (`npm run check:call-summary -- --paid`): about 16 made-up calls across BM, English, Manglish and Mandarin, including a booking request, a message, a handoff, a transfer, a dropped call and an unclear call. Pass: no quote-guard, detail-guard or false-success failure (cases include a caller giving an IC number, an address and an email), and each reason contains at least one expected keyword from the case's list (EN and BM keywords per case); all 16 outputs are also written to the QA record and read by a person. No model is used as a judge (builder's call: that would be another Anthropic use). Run once and recorded in `docs/qa/`.

## 7. Left to the builder

- The exact skip thresholds, length caps, lease time and retry count.
- Whether the contact timeline shows the reason this round.
- Prompt wording within the rules in 6.3.
- Migration and function names, following the existing style.

## 8. Owner steps after merge

- Apply the migration to staging before the web deploy reads `app.call_summary` (runbook step to be added).
- Set `JOMCALL_CALL_SUMMARY=anthropic` for the agent on staging when ready.
- Update the privacy and terms text to mention AI summaries.
