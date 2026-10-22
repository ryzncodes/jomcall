# JomCall — agent handover

The product name is **JomCall**. Use `JomCall` in user-facing text and `jomcall` (or `jomcall_`, `JOMCALL_`) in code identifiers.

It answers Malaysian SMEs' phone calls and WhatsApp messages 24/7 with an AI agent that speaks the caller's language (BM, English, Manglish, Mandarin), answers questions, books appointments, takes messages and transfers to staff. Inbound is the core business; outbound lead follow-up is secondary. Delivered as a hosted self-serve SaaS (MYR billing) with the full code public under FSL-1.1-ALv2 (source-available; each release converts to Apache-2.0 after two years).

## Read first

| Doc | What it is |
|---|---|
| `docs/superpowers/specs/2026-10-15-jomcall-design.md` | Approved architecture spec: services, flows, data model (§6), compliance, build order (§9), open decisions (§10), unverified assumptions (§11), risks (§12) |
| `docs/frontend/screens.md` | Every frontend screen to build, grouped by area, with priorities |
| `docs/research/voice-options.md` | Text-to-speech options and techniques for natural-sounding calls |
| `docs/superpowers/plans/2026-10-15-speech-benchmark-spike.md` | Plan for the speech-provider benchmark (sub-project 1) |

## Current state (2026-10-16)

- A developed frontend preview now lives in `web/`: marketing, a mock call log/detail, nine-stage guided setup, a dedicated browser-call/text-chat test panel, an agent builder with version snapshots, a shared contact inbox, contacts with consent history and local PDPA actions, a booking calendar, six mock integration connectors, phone-number routing, WhatsApp channel/template settings, a shared wallet with simulated payments and usage, a daily home dashboard, and connected business/branch/team/notification/key/privacy/audit settings. These share fictional records in browser storage. Remaining inventory now includes public pricing/guides/preview policies, sample access/recovery/invitations, outbound workflow editor/runs/review, hosted admin, self-host readiness, branch schedules and call filters/sample playback. See `web/README.md` and `docs/frontend/remaining-screens.md`. A local Phase 1 backend now exists: Supabase Auth/Postgres, constrained application roles, tenant APIs, agent versions, contacts/consent, privacy jobs and local invitation mail. Voice/channel/calendar/payment integrations remain unbuilt; the full sub-projects 2-7 in spec §9 are not complete.
- Phase 2 adds local capacity-one bookings, frozen text tests, a separate constrained agent worker and an optional pinned native model. All integrations remain disconnected. Model quality is experimental until the 48-case gate passes; see `docs/qa/2026-10-16-local-agent-booking.md`. Mock 4181 stays independent of local 4182.
- Sub-project 1 (speech benchmark) lives on branch `spike/speech-benchmark` under `spikes/speech-benchmark/`. It is throwaway Python, waiting on the owner's API keys and recordings. Do not build on it or import from it.
- There is no git remote yet.

## Frontend work: how to start

- Stack per spec: Next.js + TypeScript (`web` service). UI component library, auth provider and payment provider are open decisions (spec §10); pick sensible defaults and note them, or ask the owner.
- Keep server-selected modes isolated: mock preview at 4181 uses existing fictional browser data; local app at 4182 uses named commands from `packages/contracts/src/core.ts`. Never fall back to mock records on a local error. Unsupported integrations stay explicitly unavailable. Read root `README.md`, `infra/local/README.md` and the Phase 1 spec/plan before backend work. All runtime services stay local unless the owner explicitly changes that constraint.
- Start with the screens that decide whether an owner trusts the product: guided setup with browser test call, agent test panel, call log (see `docs/frontend/screens.md`).

## Rules

- **Original work only.** Write everything from scratch. Do not copy code, endpoint paths, schemas, names, prompts, copy text or assets from other products.
- **No secrets in git.** Keys go in local `.env` files only (gitignored). Never print or commit keys or tokens.
- **No personal data in git.** No real call audio, transcripts or customer data; use clearly fake sample data (fake names, fake numbers).
- **Malaysia first.** UI in BM and English; amounts in MYR (store as integer sen); times in `Asia/Kuala_Lumpur`; phone numbers in E.164; mobile-first, because owners check calls on their phones.
- **Compliance is visible in the UI:** AI and recording disclosure setting, consent records, do-not-contact switch, PDPA export and delete.
- **License:** FSL-1.1-ALv2 (see `LICENSE.md`). Only add dependencies whose licenses allow use in commercial, source-available software (MIT, Apache-2.0, BSD, ISC and similar). Avoid GPL/AGPL dependencies.
- Commits: small, Conventional Commits style. Work on a feature branch, not `main`.
