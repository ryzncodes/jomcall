# Roadmap

This is the public plan for `JomCall`, a source-available AI front desk for Malaysian small businesses. It answers phone calls and WhatsApp messages in BM, English, Manglish and Mandarin. It answers questions, books appointments, takes messages and hands off to staff.

The roadmap is honest about where things stand. "Done" means built and verified on a local machine with fake data. Nothing here has been connected to a real phone line, a real WhatsApp number, a real calendar or real money yet.

There are no dates. Each milestone ends with a demo and an acceptance gate. A milestone is done when its gate passes, not when a deadline arrives.

- **Architecture baseline:** [design spec](docs/superpowers/specs/2026-10-15-jomcall-design.md)
- **Detailed backend plan:** [backend connection roadmap](docs/superpowers/plans/2026-10-15-backend-roadmap.md)
- **Integration research:** [channel and integration roadmap](docs/research/integration-roadmap.md)

## Status at a glance

| Milestone | What it delivers | Status |
|---|---|---|
| [M0](#m0--decisions-and-external-feasibility) | Decisions, speech benchmark, supplier checks | Partial: waiting on recordings, keys and supplier answers |
| [M1](#m1--core-platform) | Accounts, workspaces, roles, agents, contacts, consent, privacy jobs | **Done (local)** |
| [M2](#m2--agent-tools-and-booking) | Knowledge, text agent, tools, bookings, calendar connector | Partial: bookings done; model quality gate failing |
| [M3](#m3--inbound-voice) | The AI answers real phone calls | Not started |
| [M4](#m4--whatsapp-chat) | The AI answers WhatsApp chats | Not started |
| [M5](#m5--self-serve-onboarding-and-billing) | Sign up, get a number, pay in MYR | Not started |
| [M6](#m6--outbound-follow-up-and-whatsapp-calling) | Lead follow-up workflows, WhatsApp calling | Not started |
| [M7](#m7--release-hardening-and-self-host) | Hosted launch, `docker compose` self-host, operations | Not started |
| [R](#r--source-available-and-build-in-public-track) | Licence, contributing, CI, public demo | Started |

The frontend preview runs ahead of the backend. Every screen in the [screen inventory](docs/frontend/screens.md) has a working mock with fictional data. Most milestones below are about making those screens real.

### Status labels

| Label | Meaning |
|---|---|
| Done (local) | Built, tested and verified on a local machine with fake data. Not deployed. |
| Partial | Some deliverables are done; the acceptance gate has not passed. |
| Not started | Designed in the spec, but no backend code yet. A mock screen may exist. |
| Blocked | Cannot finish without something outside the code: an account, an approval, a supplier answer. |
| Candidate | A possible later addition. Not committed. |

### Numbering

Older documents in this repo use three numbering schemes. They map like this:

| This roadmap | Design spec §9 sub-project | Older docs call it |
|---|---|---|
| M0 | 1. Speech benchmark | "Sub-project 1", "spike" |
| M1 | 2. Core platform | "Phase 1" |
| M2 | 2. Core platform (agent and knowledge parts) | "Phase 2" |
| M3 | 3. Inbound voice | — |
| M4 | 4. WhatsApp | — |
| M5 | 5. Self-serve and billing | — |
| M6 | 6. Outbound | — |
| M7 | 7. Open-source release | — |

## Guiding rules

These rules apply to every milestone. They are acceptance criteria, not preferences.

1. **Inbound first.** Answering the business's own incoming calls and chats is the product. Outbound follow-up comes later and is secondary.
2. **Never pretend.** The agent never confirms a booking without a durable record. A sent message is not a delivered message. A green "connected" badge is never shown without a successful recent check. A mock never stands in for a failed real service.
3. **Bill only what was confirmed.** Usage is charged once, only after the provider confirms it. Money is stored as integer sen. Ambiguous outcomes go to a review queue and are never retried blindly.
4. **Compliance is visible.** AI and recording disclosure, consent records, do-not-contact, quiet hours, and PDPA export and deletion are on screen, not hidden in settings.
5. **Malaysia first.** BM and English UI. MYR. `Asia/Kuala_Lumpur` times. E.164 phone numbers. Mobile-first, because owners check calls on their phones.
6. **Tenants are isolated.** Every tenant row carries `org_id`, row-level security is forced, and every milestone adds tests proving one business cannot see or change another's data.
7. **Providers are swappable.** Speech-to-text, language model, text-to-speech, calendar and payment providers sit behind adapters. Defaults are chosen from measurements, not assumptions.
8. **Self-hosting stays possible.** Hosted-only features (number pool, billing, Meta onboarding, abuse monitoring) are switchable. The rest runs on your own machine.

---

## M0 — Decisions and external feasibility

**Goal:** answer the questions that code cannot answer. Which speech providers understand Malaysian callers? Can we get Malaysian phone numbers? Will Meta and a payment provider approve us?

**Status:** Partial. Most product decisions are made. The speech benchmark harness exists but is waiting on recordings and provider keys. Supplier checks have not started.

### Done

- [x] Architecture decided: Next.js web/API, TypeScript `engine` worker, Python LiveKit `voice` worker, Postgres with row-level security, pg-boss queue in Postgres.
- [x] Auth decided: Supabase Auth, run locally for development.
- [x] Development constraint decided: everything runs locally, with no cloud accounts or paid services, until the owner reopens spending.
- [x] Calendar default decided: Google Calendar first, Cal.com second, and a "booking request awaiting staff confirmation" mode when no calendar is connected.
- [x] Payment default decided (provisional): one Billplz wallet top-up adapter, subject to merchant eligibility. Stripe stays an alternative.
- [x] Speech benchmark plan written: [speech benchmark plan](docs/superpowers/plans/2026-10-15-speech-benchmark-spike.md).
- [x] Text-to-speech options researched: [voice options](docs/research/voice-options.md).

### Remaining

- [ ] **Malaysian speech test set.** Record or source consented, fake-content clips in BM, English, Manglish and Mandarin. Cover numbers, prices, dates and times, phone numbers, and place names such as SS15, Cyberjaya and KLCC.
- [ ] **Speech-to-text scoring.** Word error rate per language, accuracy on numbers and names, end-of-turn latency, and behaviour on 8 kHz phone audio.
- [ ] **Text-to-speech blind listening test.** Malaysian listeners rate naturalness at phone quality. Candidates: commercial voices with Malay support and open Malaysian models whose licences allow commercial use.
- [ ] **Choose default speech providers** from the measurements and write down the reason.
- [ ] **Choose the default language model** for the hosted product. Measure tool-calling reliability in all four languages and latency from Malaysia.
- [ ] **SIP trunk and Malaysian numbers.** Confirm a supplier can provide +60 DIDs, the paperwork needed, caller ID, transfer support and price per minute.
- [ ] **Telco call forwarding.** Verify the forwarding codes (`**61*`, `**67*`, `**21*`) and their behaviour on Maxis, CelcomDigi, U Mobile and Unifi.
- [ ] **Meta Tech Provider.** Start the application for hosted WhatsApp onboarding. It is known to take time.
- [ ] **Payment merchant.** Confirm Billplz (or Stripe Malaysia) merchant eligibility, FPX and DuitNow support, and signed callbacks.
- [ ] **Regulation check.** MCMC rules on automated and unsolicited calls, call-recording consent, and PDPA rules on sending recordings and transcripts outside Malaysia.

### Acceptance gate

Written decisions with evidence for: speech-to-text default, text-to-speech default, language model default, SIP supplier, and payment provider. Missing supplier approval does not block M1 or M2.

### Blocked on

- Consented Malaysian speech recordings.
- Provider API keys for the benchmark (free tiers are enough).
- Supplier, Meta and merchant replies.

---

## M1 — Core platform

**Goal:** real accounts and real data. Two businesses can use the app at the same time and never see each other's records.

**Status:** **Done (local).** Evidence: [M1 QA report](docs/qa/2026-10-16-local-core-platform.md). Design: [M1 design](docs/superpowers/specs/2026-10-16-local-core-platform-design.md). Plan: [M1 plan](docs/superpowers/plans/2026-10-16-local-core-platform.md).

### Done

- [x] Monorepo with `web`, `engine` and shared packages (`contracts`, `domain`, `db`, `inference`).
- [x] Local Supabase Auth and Postgres, with constrained application roles that cannot bypass row-level security.
- [x] Email sign-up with confirmation, password recovery, HTTP-only sessions and workspace switching.
- [x] Organizations, branches, weekly schedules and closures.
- [x] Owner, admin and staff roles, checked in both the API and the database.
- [x] Invitations, delivered to local Mailpit only.
- [x] Agent drafts, text knowledge, immutable published versions and restore-to-draft.
- [x] Contacts, internal notes, channel-specific consent and do-not-contact history.
- [x] Audit log for agent changes, exports and deletions.
- [x] Durable PDPA export and deletion jobs with expiry, retries and download authorization.
- [x] Named server commands and validated contracts. The browser never sends "save the whole workspace".
- [x] Strict separation between the mock preview (port 4181) and the local app (port 4182). A local error never falls back to mock data.

### Acceptance gate (passed)

Two independent businesses in two browser profiles. Data persists across restarts. Cross-tenant IDs are denied. A revoked member is denied. Concurrent edits produce a conflict instead of silently overwriting. Publishing is immutable. Real mode never loads fixture data.

### Left for later milestones

- Google sign-in (M5).
- Hosted email delivery (M7). Local mail stays in Mailpit.
- Platform-admin roles separate from tenant admins (M5).

---

## M2 — Agent tools and booking

**Goal:** the agent can answer questions from the business's own knowledge and safely propose bookings, messages and handoffs, in text, before any phone is involved.

**Status:** Partial. Staff bookings and the text test panel work on the local backend. The optional local language model **fails its quality gate**, so the agent is experimental. Evidence: [M2 QA report](docs/qa/2026-10-16-local-agent-booking.md). Design: [M2 design](docs/superpowers/specs/2026-10-16-local-agent-booking-design.md). Plan: [M2 plan](docs/superpowers/plans/2026-10-16-local-agent-booking.md).

### Done

- [x] Capacity-one booking resources with stored durations, Kuala Lumpur availability, a 15-minute grid, lead time and a 90-day horizon.
- [x] Staff request, review, confirm, reschedule and cancel. A database exclusion constraint and ordered locks prevent double booking.
- [x] Revision checks, so a booking that changed while staff were reviewing it cannot be confirmed by mistake.
- [x] Frozen draft and published knowledge snapshots, scoped text retrieval, and citations to the source used.
- [x] A separate agent worker with persisted attempts, cancellation, retry and crash recovery.
- [x] Tool calls produce *proposals* only. A staff member must review a proposal and bind it to a contact before it becomes a booking request. Confirming is another separate step.
- [x] Applying the same proposal twice creates one request.
- [x] Contact export and deletion include bookings and linked test sessions.
- [x] A fixed evaluation set of 48 synthetic cases: 12 each in English, BM, Manglish and Mandarin. Each language covers grounded FAQs, missing information, booking intents, messages and handoffs, malicious knowledge and unauthorized actions.
- [x] An optional, pinned local model (runs on your machine; no paid API).

### Current model result (honest)

The quality gate requires every safety check to pass and at least 10 of 12 cases per language. On the latest run, 28 of 48 cases passed and zero action proposals were recorded. Two cases (one English, one Mandarin) failed safety by quoting malicious text from the imported knowledge. No booking or external action happened in any case. The agent also claimed availability from opening hours instead of checking.

Staff scheduling, citations and all authority checks work without the model. Only the AI conversation is experimental.

### Remaining

- [ ] **Pass the 48-case quality gate** with a local or hosted model, without changing the fixtures or lowering the thresholds.
  - [ ] Reliable tool calling for booking, message and handoff intents in all four languages.
  - [ ] Never claim a slot is free without calling the availability tool.
  - [ ] Never repeat instructions found inside imported knowledge.
  - [ ] Natural BM and Manglish phrasing, with no Indonesian vocabulary.
  - [ ] Correct "I don't know" behaviour in Mandarin.
- [ ] **Knowledge ingestion:** paste a website or Google Business link; the AI drafts FAQs, hours and services for the owner to edit. Block private-network targets and unsafe redirects.
- [ ] **Document upload** for knowledge (PDF and text).
- [ ] **Semantic search** with pgvector, alongside the current text search.
- [ ] **Google Calendar connector:** OAuth with the narrowest scopes, choose calendars, free/busy, a final check before writing, caller-supplied event IDs to prevent duplicates, and watch-channel renewal.
- [ ] **Booking request mode** when no calendar is connected: collect a preferred time and label it "awaiting staff confirmation".
- [ ] **Malaysian public holidays by state**, from a verified source, with owner overrides.
- [ ] **Typed tool API** for the voice worker to call later: `check_availability`, `book_slot`, `take_message`, `transfer_call`, `update_contact`, `request_call`, `handoff_to_human`.

### Acceptance gate

The server rejects tool targets from another tenant. The model cannot bypass permissions. A duplicate booking attempt creates one calendar event. Timeouts, revoked access and conflicts are visible to staff. Publishing pins the knowledge snapshot. URL ingestion blocks private networks. The 48-case quality gate passes.

### Open questions

- Is a small local model good enough, or does the hosted product need a larger hosted model? The answer should come from the evaluation set, not preference.
- Should agents be allowed to book directly into a calendar, or always create a request for staff on the first release?

---

## M3 — Inbound voice

**Goal:** a real phone call to the business is answered by the agent, which books or takes a message, and the call shows up in the call log with a transcript and summary.

**Status:** Not started. The call log, call detail, browser test panel and phone-number screens exist as mocks.

### Deliverables

- [ ] **Python `voice` worker** on LiveKit Agents, with swappable speech-to-text, language model and text-to-speech.
- [ ] **Browser test call** over WebRTC, using a short-lived token scoped to one test session.
- [ ] **SIP inbound** on one verified Malaysian number, dispatching a job per call.
- [ ] **Narrow internal API** for the worker, with short-lived credentials bound to one call, tenant and agent version. The worker never holds a database service key.
- [ ] **Disclosure first:** every call begins with the AI and recording disclosure, then the greeting.
- [ ] **Per-turn language detection.** The reply follows the caller's language, including mid-sentence code-switching.
- [ ] **Natural speech techniques** from the [voice research](docs/research/voice-options.md):
  - [ ] Stream the reply and synthesize the first sentence first.
  - [ ] Pre-render fixed lines (greeting, disclosure) as audio.
  - [ ] Short filler lines while a tool runs ("Okay, jap ya, saya check slot...").
  - [ ] Malaysian number reading ("kosong satu dua...", "RM dua ratus lima puluh", "pukul tiga petang").
  - [ ] A pronunciation dictionary for local place names.
  - [ ] Turn detection, barge-in and short backchannels.
  - [ ] Judge everything at 8 kHz phone quality.
- [ ] **Staff transfer:** ring a staff number. If nobody answers within the timeout, take a message.
- [ ] **Business hours and after-hours script:** take a message or book the next open slot.
- [ ] **Failure handling:**
  - [ ] Worker unavailable: the trunk forwards to the owner's number.
  - [ ] Speech or model timeout: a short fallback line, then take the caller's number.
  - [ ] More than 3 seconds of silence: a fallback line. Never dead air.
  - [ ] Call drops: a missed-call follow-up task (a WhatsApp text-back comes in M4).
- [ ] **Recording and transcript** stored with a retention period, in S3-compatible storage. Authorized, expiring playback links only.
- [ ] **Post-call job:** summary, outcome (booked, message, transferred, FAQ, spam, unknown), and the agent version used.
- [ ] **Shadow usage metering:** record provider minutes and costs without charging anyone yet.
- [ ] **Latency measurement** from Malaysia against the targets.
- [ ] **Telco forwarding guide** per network, with a verification call that proves forwarding works.

### Targets (not yet measured)

- The agent starts replying within about 1.2 seconds after the caller stops speaking, in the typical case.
- No call has more than 3 seconds of silence.
- BM, English, Manglish and Mandarin callers are understood well enough to book correctly, as measured on the M0 speech test set.

### Acceptance gate

A real incoming call reaches the agent. A booking or message appears in the contact timeline and call log. Disconnects and worker failures recover. Latency is measured and reported against the targets. Provider usage is reconciled, without charging customers.

### Blocked on

- M0 speech provider decision.
- A SIP trunk with a Malaysian number.

---

## M4 — WhatsApp chat

**Goal:** the same agent, knowledge and tools answer incoming WhatsApp chats. Staff can take over any conversation.

**Status:** Not started. The shared inbox, WhatsApp settings and template screens exist as mocks.

### Deliverables

- [ ] **Official WhatsApp Cloud API** for one authorized test business first, then self-serve embedded sign-up in M5.
- [ ] **Signed webhooks:** verify signatures, deduplicate by provider event ID, and handle out-of-order events.
- [ ] **AI replies** within the window WhatsApp allows. Outside the window, only approved templates. The server enforces this, not the UI.
- [ ] **Staff takeover:** a staff reply cancels or invalidates any queued AI reply. Release hands the conversation back.
- [ ] **One message at a time per conversation**, so replies never arrive out of order.
- [ ] **Delivery states kept separate:** accepted, sent, delivered, read and failed. Only confirmed provider events move the indicator.
- [ ] **Uncertain sends** go to a review queue and are never resent automatically.
- [ ] **Template management:** submit, track approval status and quality rating.
- [ ] **Missed-call text-back**, only when consent, template and policy allow it. A normal missed phone call does not by itself permit a WhatsApp message. When not allowed, create a visible staff task.
- [ ] **Owner summaries** over WhatsApp, on the owner's chosen schedule.
- [ ] **Booking confirmations** to the caller, via an approved utility template, when allowed.

### Acceptance gate

Duplicate and out-of-order webhooks are handled. Staff takeover prevents a queued AI send. The expired reply window is enforced on the server. Uncertain sends stay in review. A revoked token cannot send.

### Blocked on

- A Meta business account and test number. Hosted self-serve onboarding needs Meta Tech Provider approval.

---

## M5 — Self-serve onboarding and billing

**Goal:** a Malaysian business owner signs up, sets up and pays without talking to anyone, and gets their first AI-answered test call within 15 minutes.

**Status:** Not started. The nine-stage guided setup, billing, wallet, phone-number and hosted-admin screens exist as mocks with simulated payments.

### Deliverables

- [ ] **Google sign-in** alongside email.
- [ ] **Guided setup on real data:**
  1. Pick a business type; a starter agent loads.
  2. Paste a website or Google Business link; review the AI draft.
  3. Pick languages and voice, with audio previews.
  4. Get a Malaysian number from the hosted pool.
  5. Connect WhatsApp through Meta embedded sign-up.
  6. Connect a calendar (optional).
  7. Make a test call in the browser.
  8. Set up call forwarding with per-telco steps, then a verification call.
  9. Trial credit, then wallet top-up.
- [ ] **Number pool:** reserve, assign and release numbers, with no duplicate assignment. Reservations expire.
- [ ] **MYR wallet:**
  - [ ] Top-up checkout through one payment provider (FPX and DuitNow where eligible).
  - [ ] Verified, signed callbacks. A browser redirect is never proof of payment.
  - [ ] Append-only ledger in integer sen.
  - [ ] Versioned retail rates. Provider cost and customer charge are stored separately.
  - [ ] Reserve or cap before a call or send. Settle after the provider confirms usage. Confirmed usage is never lost because the balance ran low; any shortfall is recorded.
  - [ ] Refunds and adjustments.
  - [ ] Receipts.
- [ ] **Automatic top-up** stays off until a supported saved payment method and explicit authorization exist. (FPX is not recurring.)
- [ ] **Trial policy** and abuse limits.
- [ ] **Hosted admin:** tenant list, pause and resume, number inventory, abuse review and platform usage. Platform admins are separate from tenant admins.
- [ ] **Retention, export and deletion across every store:** database, recordings, transcript copies, search embeddings and connector sync. Backups expire, and deletions are replayed after a restore.

### Acceptance gate

Closing the payment tab does not lose confirmed credit. A repeated webhook credits once. Confirmed usage survives a low balance. Refunds and failed payments reconcile. No number is assigned twice. Deletion completes across every store.

### Blocked on

- Payment merchant approval.
- Number supply from the M0 SIP supplier.
- Meta Tech Provider approval for embedded WhatsApp sign-up.

---

## M6 — Outbound follow-up and WhatsApp calling

**Goal:** new leads get a fast, polite follow-up that respects consent and quiet hours. Optionally, the agent can take WhatsApp voice calls.

**Status:** Not started. The outbound workflow editor, run monitor and review queue exist as mocks.

### Outbound deliverables

- [ ] **Lead sources, in order:** signed generic webhook, Google Sheets, then Facebook/Instagram and TikTok lead forms once access is approved.
- [ ] **Consent evidence kept with each lead.** Importing a lead is not permission to call or message.
- [ ] **Workflow revisions:** publishing creates a new revision; runs in progress keep the revision they started on.
- [ ] **Durable waits** that survive restarts.
- [ ] **Enrollment rules:** at most once per workflow unless re-entry is enabled; re-entry starts only after the previous run finishes. One active run per contact.
- [ ] **Checks immediately before every send or call:** do-not-contact, consent, wallet funds, quiet hours in Malaysia time, and channel capability.
- [ ] **WhatsApp template first,** within one minute when eligible. Calls only when the lead engages or asks, because unknown-number calls get low pickup in Malaysia.
- [ ] **Unknown outcomes** freeze the run and go to review. Never resent blindly.

### WhatsApp calling deliverables

- [ ] Treat WhatsApp calling as a separate, capability-checked channel, not ordinary call forwarding.
- [ ] Verify Malaysian eligibility with a real +60 sender before advertising it.
- [ ] Staff transfer through a browser or VoIP session. The documented WhatsApp calling path cannot bridge to normal phone numbers.
- [ ] A self-hostable media path, because the ready-made connector we evaluated requires a hosted media service.

### Acceptance gate

Restarts resume jobs. Do-not-contact and quiet hours are checked at the moment of dispatch. Re-entry rules hold. Unclear results are never resent. WhatsApp call permission and staff handoff are proven separately from chat.

### Open questions

- MCMC rules on automated outbound calls need checking before any outbound calling ships (see M0).

---

## M7 — Release hardening and self-host

**Goal:** a hosted service people can trust, and a self-hosted path anyone can run.

**Status:** Not started. A mock self-host readiness page exists.

### Deliverables

- [ ] **Hosted deployment** near Malaysia (likely Singapore) for latency. `engine` and `voice` are long-running and need container hosting, not serverless functions.
- [ ] **Data residency review** for recordings and transcripts under PDPA.
- [ ] **Self-host with `docker compose`:** Postgres, `web`, `engine`, `voice` and a LiveKit server, with your own SIP trunk and API keys. Billing is off in self-host mode.
- [ ] **Self-host first-run page** that checks database, speech, model and SIP configuration and shows what is missing.
- [ ] **Backups and a tested restore drill.**
- [ ] **Observability:** logs without personal data, metrics, traces and alerting.
- [ ] **Quotas and rate limits** per tenant.
- [ ] **Load test** of concurrent calls.
- [ ] **Outage drills** for each provider.
- [ ] **Full tenant-isolation test suite** in CI.
- [ ] **Device checks:** Safari, iOS, and mid-range Android on 4G, with measured Core Web Vitals.
- [ ] **Accessibility checks** (axe) in CI.
- [ ] **Hosted email delivery** for invitations, recovery and summaries.
- [ ] **Legal pages reviewed:** privacy notice, terms, data processing terms and pricing. The current pages are clearly marked previews.

### Acceptance gate

Restore drill passes. Concurrent-call load test passes. Outage drills pass. Tenant-isolation suite passes. Device and Safari checks pass. Legal, pricing and data-processing policies are approved.

---

## R — Source-available and build-in-public track

This track runs alongside the milestones. It makes the repo safe and useful to publish.

### Before the repo goes public

- [x] Choose a licence: FSL-1.1-ALv2 (source-available; each release becomes Apache-2.0 after two years). A version published briefly on 22 October 2026 was AGPL-3.0.
- [ ] Register the "JomCall" trademark with MyIPO.
- [ ] Decide on a contributor licence agreement (CLA) or a Developer Certificate of Origin (DCO). This must be decided before accepting outside contributions, because it is hard to add later.
- [ ] Add `SECURITY.md` with a private way to report vulnerabilities. The app handles personal data and phone calls.
- [ ] Add `CONTRIBUTING.md`: how to run the mock preview and local stack, commit style (Conventional Commits), the fake-data-only rule, and how to propose a connector.
- [ ] Add a `CODE_OF_CONDUCT.md`.
- [ ] Check licences of bundled fonts and images and add attribution where needed.
- [ ] Audit the full git history for secrets and personal data before the first push.

### After going public

- [ ] CI on every pull request: typecheck, both production builds, guard tests and migration replay.
- [ ] Issue and pull request templates. Labels for good first issues, by milestone.
- [ ] A hosted public demo of the mock preview, with fictional data only.
- [ ] A short demo video per milestone.
- [ ] Public progress notes: what changed, what was measured, what failed.
- [ ] Translation contributions for BM and English copy, and later Mandarin and Tamil UI.
- [x] Choose a product name: JomCall.

---

## Later candidates

These are possible additions, chosen by customer demand. None are committed.

| Area | Candidate | Notes |
|---|---|---|
| Calendar | Cal.com | For businesses already using it. Connect existing accounts only. |
| Calendar | Microsoft 365 / Outlook | Staff and room availability for businesses on Microsoft. |
| Calendar | Built-in calendar | Only if it can become the authoritative source: capacity, conflicts, holidays and cancellations. |
| Automation | Signed outgoing webhooks and n8n | Emit contact, call-summary, handoff and booking events into existing tools. |
| Spreadsheets | Google Sheets export | Append call outcomes for businesses that run from a spreadsheet. |
| CRM | HubSpot | Contact and activity sync, with clear field ownership. A phone-number match never merges people silently. |
| Commerce | Shopify (read-only first) | Answer "where is my order?" after verifying the customer. |
| Payments | Deposit payment links | Collect a booking deposit through a hosted payment link. This is the merchant's money, separate from the wallet. |
| Voice | Speech-to-speech mode | Better rhythm and emotion. Test the Malay accent first. |
| Voice | Custom Malaysian voice | Cloned from a hired voice actor with written consent. Never a voice resembling a real person without consent. |
| Language | Tamil | Spoken and UI support, after the four launch languages work well. |
| Insights | Call analytics | Peak hours, common questions, missed-opportunity reports. |

## Non-goals

These are out of scope, so effort stays on the core product:

- A general-purpose workflow builder or marketing automation suite.
- A full sales CRM with pipelines and deal stages.
- Cold calling or bulk unsolicited messaging.
- Unofficial WhatsApp connections in the hosted product.
- Voices that imitate real people without their written consent.
- Storing real customer data in this repository, in any form.

## How to help

- **Run the mock preview** and open an issue for anything confusing, broken or not Malaysian enough.
- **Malaysian speech:** consented, fake-content recordings for the M0 test set are the most valuable contribution right now.
- **Telco knowledge:** confirmed call-forwarding behaviour on your network.
- **Translations:** natural BM copy, not formal or Indonesian-sounding BM.
- **Small businesses:** tell us what your front desk actually handles. It shapes the agent's defaults.
