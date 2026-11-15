# WhatsApp inbox screen (local and hosted app)

Date: 2026-11-15. Branch `claude/whatsapp-inbox-341dbf`. Design: [WhatsApp channel design](../specs/2026-11-14-whatsapp-channel-design.md) §7 and §8.

## What exists

- The inbox commands exist and are not changed in behaviour: `conversations`, `conversation`, `replyConversation`, `takeoverConversation`, `handbackConversation`, `resolveConversation`, all in `packages/contracts/src/core.ts` and `packages/domain/src/whatsapp/routes.ts`.
- Every active member may read and work the inbox (design §8; row-level security on `conversation`, `message`, `conversation_turn`). Only owners and admins change the channel. No role may be shown less message text than another, so the screen adds no role gate of its own; a `FORBIDDEN` answer is shown plainly.
- A staff reply is only queued. The agent process decides each send later with `decideSend` (`packages/domain/src/whatsapp/policy.ts`) and records `blocked` with a code (`DO_NOT_CONTACT`, `OPTED_OUT`, `WINDOW_CLOSED`, `CONSENT_REQUIRED`, `CHANNEL_NOT_CONNECTED`, `CONTACT_UNAVAILABLE`) or `sent`. Outside the 24-hour window the worker itself replaces the text with the approved reply-request (`reengage`) template when consent is recorded. There is no command to send a template by hand, and this plan adds none.

## Plan

1. **One read change, no new command.** `conversation` (detail) gains, computed on the server:
   - `compliance`: the contact's do-not-contact and pending-deletion flags and the latest WhatsApp consent answer for service and for marketing (the same subqueries the worker's `send_claim` uses);
   - `reply_outlook`: the result of `decideSend` for a plain staff text on those same facts (channel state, contact, consent, the same `reengage` fallback filter, `last_inbound_at`, now). It is a prediction; the worker's later decision stays authoritative and the screen says so;
   - per message, `notice` (the fixed notice kind for system messages: opt-out, handoff, unsupported media) and `disclosure` (true for the message that carried the AI introduction).
2. **Screen** `web/components/core/inbox.tsx`, rendered for the `inbox` screen in the local and hosted app (replacing the "This channel comes next" placeholder there):
   - list in the server's order (waiting for staff first, then newest), name or masked number, last message, Kuala Lumpur time, needs-staff marker with reason, agent or staff handling;
   - conversation: messages with author and delivery state, refusal codes in plain BM and English, system lines for the AI introduction, STOP and handoff;
   - reply box showing the server's outlook before sending and the worker's answer after; take over, hand back, mark resolved;
   - compliance strip (consent, opt-out, do-not-contact) with a link to the contact's record;
   - states: WhatsApp not connected (link to WhatsApp settings), empty, loading, error with retry; no mock data;
   - polling while the page is visible (list every 15 s, open conversation every 5 s); no new dependency.
3. **Navigation.** `docs/frontend/screens.md` defines one Inbox ("WhatsApp threads and calls in one timeline per contact"), so the existing Inbox entry gains WhatsApp conversations rather than a new entry. In the local and hosted app it is hidden unless the `channels` command reports WhatsApp on, like the WhatsApp entry.
4. **Tests.** API tests in `tests/api/whatsapp-inbox.test.ts` for the new detail fields and the worker's refusals; guard tests in `tests/local/whatsapp-inbox.test.mjs` (both languages on every string, no mock import, no provider or policy import in the web screen, the navigation rule).
5. **Docs.** `AGENTS.md`, `web/README.md`, `docs/frontend/remaining-screens.md`, `.agent/handoff.md`.

## Not in this plan

- Unread tracking: the schema has no read state. The needs-staff marker stands in for it.
- Acting on the agent's booking and message proposals from the inbox (no command exists for conversation proposals).
- Media, template sync, outbound campaigns, calls in the same timeline.

## Deviations

- The Send button is disabled while the server's outlook says the reply would be refused, so staff do not queue a message that is certain to be blocked. A refusal can still come from the agent process if the facts change between the check and the send (for example the 24-hour window closes); the screen then shows the blocked message with its reason. Checked in the browser by pausing the agent process.
- "Mark resolved" was added because the `resolveConversation` command exists and a closed chat needs a visible end; the screen explains that a new customer message starts a new chat.
- The disclosure flag also marks a fixed notice (for example the handoff acknowledgement) when that notice was the first message to carry the AI introduction. The system line says "The reply below starts with the AI introduction" in both cases.

## Review fixes (2026-11-15)

After the review of pull request #25:

- **Queue-time refusal (decision for the owner to overrule).** `replyConversation` now refuses a staff reply before storing it when the outlook gives a hard refusal: `DO_NOT_CONTACT`, `OPTED_OUT`, `CONSENT_REQUIRED`, `CONTACT_UNAVAILABLE` or `REPLY_REQUEST_SENT`, answered as 409 with that code. Nothing is stored, the chat is not taken over and the needs-staff marker stays. `WINDOW_CLOSED` (no reply-request template) and `CHANNEL_NOT_CONNECTED` are still queued and refused by the agent process, which stays the final gate for every send. Previously every staff reply was queued and only the worker refused it.
- **One reply-request per silence.** While a reply would go out as the reply-request template, the outlook refuses with `REPLY_REQUEST_SENT` once such a template went out (or a reply is still queued) since the customer's last message; the server applies the same rule at queue time.
- **Shared SQL and the database clock.** The outlook's consent and fallback subqueries live in `packages/domain/src/whatsapp/send-facts-sql.ts`; a guard test fails if they drift from `send_claim`. The outlook uses the database `now()`, not the Node clock.
- **Messages** carry `reply_request` (the reply-request template went out in place of the text).
- **Screen:** one idempotency key per draft (the exact first request is resent after a lost response, a new key after a definite refusal or an edit, rules in `web/lib/core/inbox-rules.ts`); numbers masked to the last four digits and a name that is the number treated as no name; a sequence counter so a slow poll cannot overwrite newer data; the textarea stays editable when Send is refused; a UTF-8 byte counter; header action errors shown under the header; 403 wording about workspace access; caps notes at 100 chats and 200 messages; Back on a phone returns to the list; pending deletion shown; `dir="auto"` on names, snippets and bodies; BM wording fixes.
