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

Recorded here as they happen.
