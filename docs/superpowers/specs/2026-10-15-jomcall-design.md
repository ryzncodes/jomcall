# JomCall — Architecture Design

- **Date:** 2026-10-15
- **Status:** Draft for review
- **Product name:** JomCall (chosen 2026-10-22; previously the codename `call-agent`)
- **License:** FSL-1.1-ALv2 (changed 2026-10-22 from AGPL-3.0)

## 1. Purpose

JomCall answers a Malaysian business's phone calls and WhatsApp messages 24/7 with an AI agent that speaks the caller's language, answers questions, books appointments, takes messages and hands off to staff.

- **Primary business:** inbound — incoming calls and incoming WhatsApp messages.
- **Secondary (still in v1):** outbound lead follow-up on the same core.
- **Audience:** Malaysian SMEs (clinics, dental, salons, workshops, property, tuition) that miss calls and reply late.
- **Delivery:** a hosted, self-serve SaaS (sign up, pay in MYR, set up without help), with the full code public under a source-available licence so anyone can read it and self-host it for their own business.

### Success criteria

1. A new business gets its first AI-answered test call within 15 minutes of signing up.
2. The AI starts replying within about 1.2 s of the caller finishing speaking (typical case, measured).
3. BM, English, Manglish and Mandarin callers are understood well enough to book correctly, as measured on the Malaysian speech test set (§9, sub-project 1).
4. No call ends in dead air: any stall over 3 s triggers a fallback.
5. Self-hosters can run the whole stack with `docker compose` plus their own SIP trunk and API keys.

### Decisions made

| Topic | Decision |
|---|---|
| Delivery model | Hosted SaaS, code public and source-available |
| Core use case | Inbound calls and WhatsApp; outbound follow-up secondary |
| v1 scope | Inbound voice, inbound WhatsApp and outbound follow-up all in v1, built in the order of §9 |
| Stack | Next.js / TypeScript web app and workers; Python voice worker |
| Voice | LiveKit (server + SIP) with LiveKit Agents; providers swappable |
| WhatsApp | Official Cloud API for hosted; optional unofficial connector for self-hosters only |
| License | FSL-1.1-ALv2 (source-available; Apache-2.0 after two years). Decided 2026-10-22, replacing AGPL-3.0 |

## 2. Architecture

One monorepo, four runtime parts:

| Part | Language | Responsibility |
|---|---|---|
| `web` | Next.js / TypeScript | Sign-up and onboarding, agent builder, inbox, call logs and recordings, billing UI; REST API; receives all webhooks |
| `engine` | TypeScript worker | Post-call jobs, missed-call text-backs, summaries, outbound workflows, retries, quiet hours. Queue stored in Postgres (pg-boss) so self-hosters need no Redis |
| `voice` | Python (LiveKit Agents) | Answers and places calls over a Malaysian SIP trunk; runs the published agent with swappable speech-to-text, LLM and text-to-speech |
| Postgres | — | All data; row-level security per tenant; pgvector for knowledge search |

`engine` and `voice` are long-running processes and cannot run on serverless functions.

### Shared core (same for every channel)

- **Agent:** prompt, languages, voice, knowledge base, disclosure text, and tools:
  `check_availability`, `book_slot`, `take_message`, `transfer_call`, `update_contact`, `request_call`, `handoff_to_human`.
- **Contacts and conversations:** one record per person, holding calls and WhatsApp threads together.
- **Connectors:** each integration is described by a declarative manifest (how it authenticates, how events arrive, which actions it supports). v1 connectors:
  - Booking: Google Calendar, Cal.com
  - Lead sources (outbound): Facebook/TikTok lead forms, generic webhook, Google Sheets
  - Channels: voice SIP, WhatsApp Cloud API, WhatsApp unofficial (self-host only)

## 3. Inbound call flow

1. **Forwarding.** The business keeps its existing number and forwards calls to its JomCall number on a local SIP trunk, either on no-answer/busy (missed calls only) or always (AI answers first).
2. **Answer.** LiveKit receives the call and dispatches a `voice` job. The job loads the configuration for the dialled number (published `agent_version`, location hours, knowledge base) from an internal API, cached.
3. **Greeting.** The agent plays an AI and recording disclosure, then the greeting.
4. **Conversation.** The language is detected per turn and the reply follows the caller. The agent answers FAQs, checks availability and books, takes messages, or transfers.
5. **After the call** (`engine` job): summary and outcome (booked / message / transferred / FAQ / spam), billing once the provider confirms the call, WhatsApp summary to the owner, WhatsApp confirmation to the caller via an approved utility template.
6. **Missed-call text-back:** if the AI is off or the call drops, the caller gets a WhatsApp message within one minute.

### Voice pipeline

- Default: three steps (speech-to-text → LLM → text-to-speech) for language control and swappable providers.
- Optional per-agent mode: a speech-to-speech model.
- Provider defaults are chosen from the benchmark in sub-project 1, not assumed.

### Business hours

- Per-location hours and a Malaysian public-holiday calendar that varies by state.
- Outside hours the agent runs an after-hours script (take a message, or book the next open slot).

### Transfer

`transfer_call` rings a staff number. If nobody answers within a configurable timeout, the agent takes a message and both caller and owner get a WhatsApp message.

### Failure handling

| Failure | Behaviour |
|---|---|
| `voice` worker unavailable | SIP trunk falls back to forwarding the call to the owner's number |
| Speech-to-text or LLM timeout | Short fallback line, take the caller's number, WhatsApp text-back |
| Any silence over 3 s | Fallback line; never dead air |
| Call drops | Missed-call text-back |

## 4. Inbound WhatsApp

- The same agent answers incoming chats with the same knowledge base and tools.
- Free-form replies are only sent inside the window WhatsApp allows; outside it, approved templates are used.
- A message counts as delivered only when the provider confirms delivery. A send with an unclear outcome goes to a review queue and is never automatically resent.

## 5. Outbound follow-up (secondary)

- New leads from a lead-source connector are enrolled in a follow-up workflow.
- A WhatsApp template goes out within one minute; the agent qualifies the lead in chat.
- A call is scheduled only when the lead engages or asks for one (unknown-number calls have low pickup in Malaysia).
- Workflow rules:
  - A contact is enrolled at most once per workflow unless re-entry is enabled, and re-entry starts only after the previous run has finished.
  - Publishing a workflow creates a new revision; runs already in progress keep the revision they started on.
  - Quiet hours (Malaysia time) and the do-not-contact list are enforced before every send or call.

## 6. Data model

Every table carries `org_id`. Row-level security limits each signed-in user to their organization; workers use a service role and always filter by organization explicitly.

| Area | Tables | Notes |
|---|---|---|
| Tenants | `organization`, `member`, `location` | Roles: owner, admin, staff. Location holds hours, holidays, time zone (default `Asia/Kuala_Lumpur`) |
| Channels | `phone_line`, `whatsapp_channel` | Phone line: number, forwarding mode, location, agent. WhatsApp: provider `cloud` or `unofficial` |
| Agent | `agent`, `agent_version`, `knowledge_item`, `transfer_target` | Publishing creates an immutable `agent_version`; every call and conversation records the version it used |
| People | `contact`, `consent_record` | Phone numbers in E.164; preferred language; do-not-contact flag |
| Activity | `call`, `conversation`, `message`, `booking` | Call: direction, agent version, duration, transcript, outcome, transfer result, cost. Recordings in S3-compatible storage with a retention period |
| Connectors | `connector`, `webhook_endpoint` | Manifest id plus encrypted credentials |
| Workflows | `workflow`, `workflow_revision`, `workflow_run` | Outbound follow-up |
| Billing | `usage_event`, `wallet_ledger` | `usage_event` records a generic billable unit as reported by the provider (voice minute, WhatsApp message, LLM call). Ledger is append-only, amounts in sen (integers) |
| Audit | `audit_log` | Agent changes, data exports and deletions |

Billing rule: an event is billed once, and only after the provider confirms it.

## 7. Compliance

- AI and recording disclosure at the start of every call.
- Consent records per contact and channel.
- Do-not-contact list, checked before every outbound send or call.
- Quiet hours in Malaysia time.
- PDPA: data export and deletion per contact; recording retention period; audit log of access.

## 8. Self-serve, hosting and source availability

### Onboarding (target: first test call within 15 minutes)

1. Sign up (Google or email).
2. Pick a business type; a starter agent is loaded.
3. Paste a website or Google Business link; the AI drafts FAQs, hours and services for the owner to edit.
4. Pick languages and voice.
5. Get a Malaysian number (hosted number pool).
6. Connect WhatsApp through Meta's embedded sign-up.
7. Connect a calendar.
8. Test call in the browser (LiveKit WebRTC).
9. Set up call forwarding with per-telco instructions, then a verification call confirms it works.
10. Free trial credit, then wallet top-up.

### Hosted vs self-hosted

Same code. Hosted adds the number pool, Meta Tech Provider onboarding, billing, and abuse monitoring. Self-hosted runs `docker compose` (Postgres, `web`, `engine`, `voice`, LiveKit server) with the operator's own SIP trunk and API keys; billing is disabled.

### Unofficial WhatsApp connector

A separate package, off by default, clearly labelled as against WhatsApp's terms with a ban risk. It cannot be enabled in hosted mode.

### License

FSL-1.1-ALv2 for the whole repository. Each release becomes Apache-2.0 two years after publication. A version published briefly on 22 October 2026 was under AGPL-3.0; copies of it keep that grant.

## 9. Build order (sub-projects)

Each sub-project gets its own plan and ends in a demo.

1. **Speech benchmark (spike).** Build a test set of Malaysian speech (BM, Manglish, Mandarin, numbers, place names) and score speech-to-text and text-to-speech candidates. Output: chosen default providers. Needs its own question-and-probe approval.
2. **Core platform.** Monorepo, Postgres with RLS, auth, organizations and locations, agent and versions, knowledge base.
3. **Inbound voice.** LiveKit and SIP trunk, `voice` worker, browser test call, booking, transfer, post-call summary.
4. **WhatsApp.** Cloud API, missed-call text-back, AI chat, owner summaries; then the unofficial self-host connector.
5. **Self-serve and billing.** Onboarding flow, forwarding verification, MYR wallet, payment provider.
6. **Outbound.** Lead-source connectors, workflows, scheduled calls.
7. **Public release.** `docker compose`, docs, contribution policy, demo.

## 10. Open decisions

| Decision | Notes |
|---|---|
| Contributor agreement (CLA) | Needed only if dual-licensing may happen later; decide before accepting outside contributions |
| Default LLM provider and model | If Anthropic, take model IDs from the current API reference, not from examples; never hardcode in more than one place |
| Auth provider | e.g. Supabase Auth, Auth.js, or other |
| Payment provider | Billplz, Stripe MY, or both |
| Default calendar | Google Calendar, Cal.com, or a built-in calendar |
| Hosting and region | Long-running `engine` and `voice` need container hosting; region near Malaysia (likely Singapore) for latency |
| Data residency | PDPA cross-border transfer rules for recordings and transcripts |
| Product name | Decided 2026-10-22: JomCall |

## 11. Assumptions to verify

These shaped the design but have not been checked against current sources:

- WhatsApp Business pricing model and unit (per conversation vs per message) — affects `usage_event` units only.
- WhatsApp Business calling availability in Malaysia.
- Malaysian DID availability from SIP trunk providers, and paperwork required.
- Call-forwarding codes (`**61*`, `**67*`, `**21*`) and behaviour on each Malaysian telco.
- MCMC rules on unsolicited and automated calls; recording-consent requirements.
- Meta Tech Provider approval process and timeline.
- Billplz and Stripe MY features for wallet top-ups.
- LiveKit Agents and SIP features needed for transfer and inbound dispatch.

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Speech-to-text quality on Manglish and mixed languages | Wrong bookings, bad experience | Benchmark first (sub-project 1); per-agent provider choice |
| Getting Malaysian numbers on a SIP trunk | Blocks inbound | Verify providers early; support bring-your-own trunk |
| Telco forwarding differs by network | Setup failures | Per-telco instructions plus verification call |
| Meta Tech Provider approval time | Delays hosted WhatsApp | Start application early; self-host path unaffected |
| Per-minute cost vs MYR pricing | Thin or negative margins | Meter every unit; price after the benchmark shows real costs |
| Latency target from Malaysia | Unnatural calls | Host near Malaysia; measure per provider |
| Unofficial WhatsApp connector | Number bans, terms violation | Separate package, off by default, blocked in hosted mode |
| Scope: all three channels in v1 | Slow launch | Shared core; strict build order; each sub-project demoable |

## 13. Testing

- Unit tests for every tool and connector.
- Scripted text-mode conversations against each agent version.
- Malaysian speech test set re-run on every provider change.
- Load test of concurrent calls before launch.
