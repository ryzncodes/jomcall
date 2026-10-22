# Frontend screens

All screens for the `web` service (Next.js + TypeScript). The sub-project number refers to the build order in `docs/superpowers/specs/2026-10-15-jomcall-design.md` §9.

## Priority

Build these first. They decide whether a business owner trusts the AI enough to forward their phone line to it:

1. Guided setup, especially the **browser test call** and **call forwarding check**.
2. Agent **test panel** (browser call + text chat with live transcript).
3. **Call log** with recording, transcript and summary.

## Preview status — 15 October 2026

`web/` now includes nine-stage guided setup (`/app/setup`), a dedicated browser-call/text-chat tester (`/app/test`), and the earlier call log/detail (now `/app/calls`). These use fictional data. Setup persists locally; call, forwarding, connection and payment operations are simulations. Voice auditions use installed local device voices when available. Real customer recording/playback and external integrations are not connected. Agent builder (`/app/agent`) and shared contact inbox (`/app/inbox`) are also implemented as local mocks, including knowledge/hours/routing/version controls and staff takeover/reply/delivery states. Contacts (`/app/contacts`), bookings (`/app/bookings`) and integrations (`/app/integrations`) now share persisted contact, consent, conversation, appointment and connection state. See [contacts-bookings-integrations.md](contacts-bookings-integrations.md) for scope and QA. Setup supports ten business categories. Official holiday data, real recording/playback and external integrations remain unbuilt. See [agent-builder-and-inbox.md](agent-builder-and-inbox.md) and [setup-and-testing.md](setup-and-testing.md) for verified scope and limits.

Phone numbers (`/app/phone-numbers`), WhatsApp settings (`/app/whatsapp`) and billing (`/app/billing`) now share setup routing, inbox template/channel gates and wallet/usage state. See [phone-whatsapp-billing.md](phone-whatsapp-billing.md) for mock behavior and QA.

Home dashboard (`/app`) and settings (`/app/settings`) now share daily activity, alerts, business/branch/team configuration, summary preferences, sample key lifecycle, recording retention and audit history. The call log moved to `/app/calls`; `/app?call=...` remains compatible. See [home-and-settings.md](home-and-settings.md) for scope and QA.

## Remaining inventory — updated 15 October 2026

The remaining screen groups are now implemented as connected local mocks: public pricing/guides/privacy/terms, email/Google access/recovery/invitations, outbound workflow editor/run monitor/review queue, hosted admin, and self-host readiness checks. Branch-specific hours and call-log filters/sample playback also have working previews. See [remaining-screens.md](remaining-screens.md) for routes, behavior and QA.

No screen group in the table below is wholly unbuilt. Production services remain unbuilt: real auth/RBAC, providers, payments, scheduled workers, official holiday data and customer recording/retention. Preview legal documents and illustrative rates are not launch-ready commercial policies. Component gallery, CI axe and real-device performance verification also remain outstanding.

## Whole-app review — 15 October 2026

All 26 routes and their major states were reviewed on desktop and mobile. Shared-state reconciliation, workflow delivery/billing, keyboard focus, touch targets and navigation fixes are documented in [whole-app-review.md](whole-app-review.md), with 830 screen/state variants and connected mock-flow checks.

## Screens

| Area | Screens and parts | Sub-project |
|---|---|---|
| Public site | Landing page (BM/EN), pricing in MYR, "call our AI" demo, docs, Privacy (PDPA), Terms | 7 |
| Sign-in | Sign up / log in (Google, email), forgot password, invite teammates, roles (owner / admin / staff) | 2 |
| Guided setup | Business type → paste website or Google Business link (AI drafts FAQs, hours, services) → languages and voice (with audio previews) → get a Malaysian number → connect WhatsApp (Meta embedded sign-up) → connect calendar → **test call in browser** → call forwarding guide per telco (Maxis, CelcomDigi, U Mobile, Unifi) with a verification call → free trial credit / top-up | 5 |
| Home dashboard | Calls today, bookings made, missed calls recovered, spend, alerts | 2-3 |
| Agent builder | Persona and instructions, greeting, AI and recording disclosure text, languages, voice picker, booking rules, transfer numbers, take-a-message, after-hours script | 2-3 |
| Agent builder › Knowledge base | FAQ editor, document upload, re-import from website | 2 |
| Agent builder › Hours | Business hours per branch, Malaysian public holidays by state | 3 |
| Agent builder › Test panel | Browser call and text-chat tester side by side, live transcript, which tools the agent used | 3 |
| Agent builder › Versions | Publish, version history, compare two versions, roll back | 2 |
| Inbox | WhatsApp threads and calls in one timeline per contact; staff take over and reply; handoff alerts | 4 |
| Call log | List with filters (outcome, language, date, number, branch); detail page with recording player, transcript, AI summary, outcome, transfer result, cost, agent version used | 3 |
| Contacts | List and profile, consent history, do-not-contact switch, PDPA export and delete | 2 |
| Bookings | Calendar view of AI-made appointments; reschedule and cancel | 3 |
| Phone numbers | Numbers list, forwarding mode (missed calls only / always), assigned agent and branch, forwarding status | 3 |
| WhatsApp | Connected number status, message templates and their approval status, quality rating | 4 |
| Integrations | Connect cards: Google Calendar, Cal.com, Google Sheets, Facebook / TikTok lead forms, webhooks; connection health | 3-6 |
| Outbound | Lead sources, visual follow-up workflow builder (wait, condition, send WhatsApp, call), enrollment rules, quiet hours, run monitor, review queue for sends with unclear outcome | 6 |
| Billing | Wallet balance in MYR, top-up (FPX / DuitNow), auto top-up, usage by voice minute and message, receipts | 5 |
| Settings | Organization, branches, team members, owner notifications (WhatsApp summaries), API keys, audit log, recording retention period | 2-5 |
| Admin (hosted only) | Tenant list, Malaysian number pool, abuse and spam monitoring, platform usage | 5 |
| Self-host | First-run setup page: checks API keys and SIP trunk, shows what is missing | 7 |

## Applies to every screen

- UI in BM and English (language switch, all copy in translation files).
- Mobile-first: owners check calls and replies on their phones.
- Live updates for calls in progress and new messages.
- Money shown as `RM 1,234.50`, stored as integer sen.
- Times shown in `Asia/Kuala_Lumpur`.
- Accessible: keyboard navigation, visible focus, readable contrast.
- Empty states that explain the next step (e.g. "No calls yet. Make a test call").
- Sample data in mocks is clearly fake (fake names, fake numbers).

## Not decided yet

- UI component library and design system.
- Auth provider (spec §10).
- Payment provider: Billplz, Stripe MY, or both (spec §10).
- Product name and branding.

## Local backend status — 2026-10-16

Bookings now uses persisted local resources, availability, reviewed confirmations and revision-aware rescheduling/cancellation. Contacts and home show real local bookings. Agent test supports frozen draft/published text sessions, citations, tool traces, cancellation/retry and reviewed proposals. Local inference remains experimental pending multilingual quality acceptance; no browser voice, WhatsApp, external calendar or payment integration is enabled. Mock preview keeps its existing independent interactive data. See [Phase 2 evidence](../qa/2026-10-16-local-agent-booking.md).
