# WhatsApp channel design

Date: 2026-11-14. Status: draft for owner review. Part of sub-project 4 (spec §9).

Requirements and sources: [whatsapp-go-live.md](../../research/whatsapp-go-live.md).

## 1. Goal and scope

A customer writes to an SME's WhatsApp number. JomCall's agent answers from the business's published knowledge, proposes bookings, takes messages and hands off to staff. Staff see the chat in a shared inbox and can take over.

**In this design, and built now:**

- inbound text, with agent replies through the same brain as the typed agent test;
- staff replies, takeover and hand-back;
- delivery statuses;
- consent, do-not-contact, the 24-hour window with template fallback, and AI disclosure;
- per-business channel settings with encrypted credentials;
- an in-memory fake provider and a local simulator.

**Later, separate pieces** (§12): Embedded Signup; missed-call text-back; the owner's daily summary; media download; outbound follow-up; billing of messages.

## 2. Switch and boundaries

`JOMCALL_WHATSAPP_PROVIDER` selects the provider (`packages/whatsapp/src/provider.ts`). This follows the pattern of `JOMCALL_MODEL_PROVIDER`.

| Value | Behaviour |
|---|---|
| `disabled` (default) | The webhook answers 404. The worker does nothing for WhatsApp. Settings show "not available". |
| `fake` | Webhooks are accepted and verified with a local secret. Sends go to an in-memory provider. No network call. |
| `cloud` | The real Cloud API client (`packages/whatsapp/src/cloud.ts`). **This is an outbound call to Meta and needs the owner's approval** (AGENTS.md: hosted services need an approved exception). It has never been run. |

Any other value is an error. There is no fallback.

**Process roles:**

- **Web** (`web/`, port 4182):
  - verifies webhook deliveries and stores them;
  - seals credentials on save;
  - serves channel and inbox commands.
- **Agent** (`engine/src/agent`):
  - holds the only code path that opens credentials and calls a provider;
  - runs agent turns and sends.
- **Mock preview** (4181) keeps its fictional WhatsApp screens. It must never import `packages/whatsapp/src/cloud.ts`; a guard test enforces this.

**Environment:**

| Variable | Used by | Purpose |
|---|---|---|
| `JOMCALL_WHATSAPP_PROVIDER` | web and agent | the switch |
| `WHATSAPP_APP_SECRET` | web | webhook signature key (Meta app secret; any 16+ characters in `fake`) |
| `WHATSAPP_VERIFY_TOKEN` | web | subscription handshake (16+ characters) |
| `WHATSAPP_CREDENTIALS_KEY` | web and agent | 64 hex characters; AES-256-GCM key for per-business tokens |

Readiness (`whatsappReadiness`) reports only the names of missing variables, never their values.

## 3. Data model

Migrations: `20261114120000_whatsapp_channel.sql` and `20261114120100_whatsapp_worker.sql`. Every table carries `org_id`, has row-level security enabled and forced, and uses the existing `app.org_id` and `active_role` policy pattern.

| Table | What it holds | Who writes |
|---|---|---|
| `whatsapp_channel` | One per organization: agent, location, `phone_number_id`, `waba_id`, state (`not_connected`, `pending`, `connected`, `failed`, `disabled`), `agent_enabled`, sealed `credentials` | owner/admin (RLS); worker (state after verification) |
| `whatsapp_template` | Name, language, category, purpose (`reengage` …), status recorded by staff, body, variable count | owner/admin |
| `conversation` | One open thread per customer (`wa_id`) per channel: owner (`agent` or `staff`), `needs_attention` + reason, `last_inbound_at`, `disclosure_message_id` | worker; members (takeover, hand-back, resolve) |
| `message` | Inbound and outbound messages, provider message id, status (`received`, `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, `blocked`, `unknown`) | worker; members may insert their own `queued` staff message only |
| `conversation_turn` | One agent run on a conversation, under a lease (as `test_turn`) | worker |
| `conversation_tool_step`, `conversation_proposal` | Tool trace and the booking/message/handoff proposals for staff | worker; members update proposal state |
| `whatsapp_event` | Raw verified webhook events awaiting processing. No tenant read access. Payload cleared after processing; rows deleted after 7 days | web (`whatsapp_intake`), worker |

**Rules enforced by the schema:**

- The web role has no SELECT grant on `whatsapp_channel.credentials`, so no query from the web process can return a token.
- `unique(namespace, phone_number_id)`: one organization per number. Webhooks are routed by this column.
- `unique(org_id, provider_message_id)` on `message`: the idempotency key for inbound messages and the lookup key for statuses.
- At most one queued and one running turn per conversation.
- `consent_record.actor_id` may be null. A customer's own STOP message has no staff actor.

**Deletion.** Conversations cascade from `contact`. The existing PDPA deletion job removes every message with the contact. The PDPA export includes conversations, messages and proposals.

## 4. Webhook intake

Route: `web/app/api/whatsapp/webhook/route.ts`. It sits outside `dispatchCore`, so it needs no session and no CSRF.

1. **GET.** `verifyChallenge` compares `hub.verify_token` in constant time and echoes `hub.challenge`; otherwise it answers 403.
2. **POST.** Read the raw body with a streamed cap of 3 MB (Meta's documented maximum). A larger body gets 413.
3. **Signature.** `verifySignature`: an HMAC-SHA256 with the app secret, compared in constant time. It checks the raw bytes first, then the `\uXXXX`-escaped form. Which form Meta uses is unconfirmed (go-live §3). A bad signature gets 401, and the body is never parsed.
4. **Parse.** `parseWebhook` reduces the delivery to events. A message becomes key `m:<wamid>`. A status becomes `s:<wamid>:<status>`. Unknown shapes are skipped.
5. **Store.** `app_private.whatsapp_intake` inserts with `on conflict do nothing`. **A retried or duplicated delivery is a no-op.** The route answers 200 once stored. If storing fails it answers 500, so Meta retries (for up to 7 days).

Nothing else runs in the request: no tenant lookup, no model call.

## 5. From event to agent turn (`whatsapp_work('ingest')`)

The agent worker processes pending events, messages before statuses. Each event runs in its own subtransaction, so one bad event is marked `failed` and the rest of the queue continues.

**Message events:**

1. **No match.** If no `connected` channel has this `phone_number_id`, mark the event `ignored`.
2. **Missing sender.** If `from` is absent (a username-only customer, go-live §3), mark it `ignored`. This is open item O3.
3. **Lock.** Take an advisory lock on the channel and `wa_id`. A message id already stored means a duplicate: mark the event `done`.
4. **Contact.** Find the contact by `+<wa_id>`, or create one, named after the WhatsApp profile name. A contact pending deletion is ignored.
5. **Conversation.** Find the open conversation. If the last customer message was more than 24 hours ago, close it and start a new one. A new conversation means a new AI disclosure, and the agent answers again.
6. **Store.** Insert the message. Set `last_inbound_at` to the latest provider timestamp, so out-of-order arrival cannot move it backwards.
7. **Decide**, in this order:
   - **STOP words** (`stop`, `unsubscribe`, `berhenti`, `henti`, `退订`, `停止`): record consent `granted=false` for service and marketing, sourced from the customer's message, and queue a fixed confirmation. **The confirmation is the last message sent.** After it, do-not-contact-style blocking comes from the consent record (§7).
   - **Staff words** (`staff`, `staf`, `human`, `manusia`, `人工`, `agent`): **hand off deterministically**. The owner becomes `staff`, the conversation needs attention (`HANDOFF_REQUESTED`), and a fixed acknowledgement is queued. The model is not involved. This is the "prompt, clear, direct escalation path" Meta requires.
   - **Staff owns the conversation, or the agent is switched off:** set needs attention (`CUSTOMER_REPLIED`). No turn.
   - **Text:** queue an agent turn. Messages arriving while a turn waits are appended to it, so several quick messages get one answer.
   - **Media and other types:** needs attention, plus a fixed "I can only read text" notice.

**Status events:**

- Find the outbound message by provider id. If it is not found yet, retry later with a backoff. Give up after 10 minutes (`orphaned`).
- **Statuses only move forward** (`sent` < `delivered` < `read`). A late `delivered` after `read` changes nothing.
- `failed` marks the message failed with `META_<code>`, needs attention, and clears the disclosure marker if the failed message carried it.

## 6. Agent turn

`engine/src/whatsapp/worker.ts` claims a turn (`turn_claim`).

- **Claim checks.** The claim re-checks the following under row locks:
  - contact present;
  - conversation open;
  - channel connected;
  - owner is `agent`;
  - agent enabled;
  - **a published agent version exists**. WhatsApp never answers from a draft; without a published version the turn is skipped with `AGENT_NOT_PUBLISHED`.
- **Brain.** The worker calls `runTextBrain` (`engine/src/agent/brain.ts`), extracted unchanged from the typed agent runner. It is not forked.
  - The rules are `agentRules` plus `whatsappChannelNote` (`packages/domain/src/whatsapp/texts.ts`). The note states that this is a real customer and not a test, that tools create proposals for staff, and asks for plain text.
  - The brain uses the same knowledge search, budget and tools (`executeTestTool`). The `ToolAccess` adapter records steps through `turn_record` under the turn's lease.
- **Proposals.**
  - A handoff proposal sets the owner to `staff` and silences the agent.
  - A booking proposal or a message proposal sets needs attention, for staff review.
  - **Nothing is booked automatically.**
- **Safety.** Before queuing, the answer goes through `claimsFalseSuccess` (`packages/domain/src/agent-test/safety.ts`). A flagged answer is not sent. The turn fails with `UNSAFE_ANSWER` and staff are alerted.
- **Late answer.** On `turn_complete`, if staff took over meanwhile, the answer is dropped (`cancelled`).
- **Disclosure.** `turn_complete` prepends the AI disclosure when the conversation has none yet, and records the message as `disclosure_message_id`. It uses the business's own AI introduction from the agent settings if set; otherwise fixed text in the contact's language (BM default). **The disclosure appears exactly once per conversation.** If its message fails or ends `unknown`, the marker is cleared so the next reply carries it.
- **Model.** The model comes from the same provider switch as text tests (`JOMCALL_MODEL_PROVIDER`). With the provider `disabled`, turns fail with `MODEL_DISABLED` and the conversation needs attention.
- **48-case gate.** **The gate has not been run with the WhatsApp channel note** (open decision D4).

## 7. Sending (`send_claim`, `decideSend`, `send_result`)

- **Claim.** `send_claim` takes the oldest queued message under locks and marks it `sending` with a 60-second lease. It returns the facts below.
- **Decide.** `decideSend` (`packages/domain/src/whatsapp/policy.ts`) decides:
  1. Channel not connected: blocked (`CHANNEL_NOT_CONNECTED`).
  2. Contact deleted or pending deletion: blocked.
  3. **Do-not-contact: blocked, even inside the window.**
  4. Opted out on WhatsApp (latest consent record `granted=false` for service): blocked (`OPTED_OUT`). The exception is the single STOP confirmation, which is queued before the record is read and carries `system` authorship.
  5. A template message needs an approved template, a non-authentication category, the right number of variables, and **a recorded `granted=true` consent for its purpose** (marketing or service). A missing record is not consent.
  6. A text message inside the 24-hour window is sent as text.
  7. A text message outside the window is **replaced** by the approved `reengage` utility template in the contact's language, if one exists and consent is recorded. The customer gets "please reply", and their reply reopens the window. Otherwise the message is blocked (`WINDOW_CLOSED`). The original text stays in the inbox.
- **Settle.** `send_result` records the outcome:
  - `sent` with the provider id;
  - `failed` or `blocked` with a code;
  - `unknown` for a timeout or 5xx. An unknown message is **never sent again by itself**: it goes to attention for a person to check (spec §4).
- **Restarts.** Maintenance turns a `sending` row whose lease expired into `unknown`. A late real result can still settle it.

**Fallback template wording.** The owner submits it in WhatsApp Manager. It is original text, utility category, with no variables:

| Language | Name | Body |
|---|---|---|
| `ms` | `jomcall_reply_request` | Kami ada balasan untuk pertanyaan anda. Sila balas mesej ini untuk menyambung perbualan. |
| `en` | `jomcall_reply_request` | We have a reply to your enquiry. Please reply to this message to continue the conversation. |
| `zh_CN` | `jomcall_reply_request` | 我们已回复您的询问。请回复此信息以继续对话。 |

Meta decides the category at review. The wording is UNCONFIRMED until approved.

## 8. Inbox and handoff

- **Commands.** New core commands in `packages/contracts/src/core.ts`. They avoid the `/whatsapp` and `/inbox` prefixes, which stay `CAPABILITY_UNAVAILABLE`:
  - `GET /channels/whatsapp`; `PUT /channels/whatsapp`, which saves the connection and seals the token; `POST /channels/whatsapp/disconnect`;
  - `GET/POST /channels/whatsapp/templates`; `PATCH /channels/whatsapp/templates/:id`;
  - `GET /conversations`; `GET /conversations/:id`;
  - `POST /conversations/:id/messages`, a staff reply, queued for the worker;
  - `POST /conversations/:id/takeover`, `/handback`, `/resolve`.
- **Roles.** Every active member may read and work the inbox. Only owners and admins change the channel and its templates.
- **Takeover.** It sets owner `staff`. Any running agent answer is then dropped. **Hand-back** sets owner `agent` and clears the alert.
- **Staff replies** go through the same send rules (§7).

## 9. Credentials

- **Sealing.** `sealCredentials` uses AES-256-GCM with `WHATSAPP_CREDENTIALS_KEY` and additional data `whatsapp:<org_id>`, so an envelope cannot be moved to another tenant.
- **Who sees what.** The web process seals and never opens. Only the agent opens, when sending or verifying.
- **API responses** show `credentialsSet: true/false` and the time. Never the token.
- **Verification.** Saving sets the state to `pending`. The agent verifies the number with the provider (`verifyNumber`: `GET /<phone_number_id>`). The state then becomes `connected` or `failed` with a reason. In `fake` mode the check always succeeds.

## 10. Simulator

```bash
npm run whatsapp:simulate -- --to <phone_number_id> --from 60123456789 --text "Pukul berapa buka?"
```

- It posts a signed, Meta-shaped delivery to `http://127.0.0.1:4182/api/whatsapp/webhook`, using the local `WHATSAPP_APP_SECRET`.
- It works only when `JOMCALL_WHATSAPP_PROVIDER=fake`.
- Fake numbers only.
- The worker answers through the fake provider. The reply appears in the inbox and in the conversation.
- The same script can post a status for a stored message id (`--status delivered --id wamid...`).

## 11. Owner decisions (with recommendations)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve Meta's Cloud API as a hosted exception (`JOMCALL_WHATSAPP_PROVIDER=cloud`) | Approve, once a public HTTPS host exists. It is the only allowed route to WhatsApp. |
| D2 | Onboarding model | Tech Provider with Embedded Signup. Pilot first with one business's own system-user token (no App Review needed). |
| D3 | PDPA cross-border basis for sending chats to Meta (US) and the model provider | Consent in the BM/English notice, plus processor terms. This is the same open decision as voice. |
| D4 | Gate the WhatsApp channel wording | Run the 48-case gate with `whatsappChannelNote` before the first real customer (needs the hosted model; not run here). |
| D5 | Who pays Meta | Each SME pays Meta directly (Tech Provider model). JomCall bills only its own fee. |
| D6 | Unofficial self-host connector | Do not build it. Change spec §8 to "not planned" (go-live §9). |
| D7 | Opt-in for templates | Require a recorded consent for every template, including the reply-request. The customer's own first message is not recorded as consent automatically. |
| D8 | Staff and STOP keywords | Keep the fixed lists in §5; extend them as staff report misses. |

## 12. Open items and later pieces

- **O1, Embedded Signup.** Needs the app ID and `config_id`. The browser part loads Meta's SDK, so it is a second approval point. Not built.
- **O2, `subscribed_apps` call** after connecting. A small addition to the cloud client and the verification step. Not built.
- **O3, username-only customers** (business-scoped user IDs). Contacts are keyed on phone numbers, so such messages are ignored today. Store `user_id` and send with `recipient` once confirmed.
- **O4, media.** Stored by id and type only, never downloaded. Download would need the 5-minute URL and storage.
- **O5, missed-call text-back.** Needs the phone line. It will queue a `missed_call` template through the same send path.
- **O6, owner daily summary.** A scheduled job sends the `owner_summary` template to the owner's number. The owner's own consent is recorded when they enable it.
- **O7, billing.** Record a `usage_event` per delivered message from status `pricing`.
- **O8, template sync.** Read status from `GET /<WABA_ID>/message_templates` instead of staff recording it.
- **O9, mark as read and typing indicator.**
- **O10, mTLS on the webhook**, and a rate limit per IP.

## 13. Stubbed until Meta access exists

- The real client is written and unit-tested against a fake `fetch`, but has never reached Meta.
- The signature form, payload fields, error codes and Graph version come from documentation read on 2026-11-14.
- The checklist in go-live §10 lists the first real checks (step 13: non-ASCII signature).
