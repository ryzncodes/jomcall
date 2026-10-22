# Backend connection roadmap

Date: 2026-10-15; decision update: 2026-10-16. Status: owner accepted the proposed defaults, with an overriding **local-only, no cloud spending** constraint. No product code, infrastructure or provider accounts were changed while planning.

Phase 1 was implemented through `b4496e6`; see its [QA report](../../qa/2026-10-16-local-core-platform.md). Phase 2 is now proposed in the [local agent/booking design](../specs/2026-10-16-local-agent-booking-design.md) and [implementation plan](2026-10-16-local-agent-booking.md). No Phase 2 code or model installation has started.

Phase 1 scope is [Phase 1 local design](../specs/2026-10-16-local-core-platform-design.md) and its [implementation plan](2026-10-16-local-core-platform.md). Supabase Auth/Postgres runs locally; Next.js API and TypeScript engine run on the same machine. Google Calendar first and one Billplz wallet adapter remain future defaults, not permission to open accounts, deploy or spend. Hosting, region and storage provisioning are deferred. Mock preview stays independently usable.

## 1. Goal and existing decisions

Turn the current frontend into a hosted Malaysian SME front desk: a business signs in, publishes an agent, receives a real enquiry, books or takes a message, and sees the same durable history and usage on every device. Preserve the existing design, BM/English UI, MYR amounts, Kuala Lumpur business times and mock preview.

The architecture in `../specs/2026-10-15-jomcall-design.md` remains the baseline: Next.js web/API, TypeScript engine, Python LiveKit voice worker, Postgres with RLS and pgvector, pg-boss, and S3-compatible recording storage. Inbound remains first; outbound remains in v1 but comes later. The owner instructed us to follow this architecture and accepted the roadmap defaults. Its historical “Draft for review” header does not override the current local-only constraint or authorize any paid provider work.

This roadmap decomposes that architecture. Each implementation milestone needs its own focused specification and executable plan; this is not a claim that every unresolved provider choice is approved.

## 2. Original inventory, verified on 2026-10-15 before Phase 1

| Existing asset | Reuse | Production gap |
| --- | --- | --- |
| 26 public/product routes and responsive design | Layouts, translations, interaction patterns, empty/error states | Actual server loading, authorization, pagination and asynchronous operation states |
| `web/lib/api/product-types.ts`, `builder-types.ts` | Setup fields, business categories, agent drafts and immutable-version concept | `SetupDraft` combines organization, agent, channels, credentials-adjacent settings and wallet into one client-owned object |
| `web/lib/api/crm.ts`, `inbox.ts`, `outbound.ts` | Consent, booking, takeover, delivery and workflow behavior as acceptance examples | Nested contact event arrays; simulated delivery; browser time and local state drive mutations |
| `web/lib/api/service.ts` | Idempotency intent and integer-sen display | Browser can mark payments paid, set usage prices, charge wallet and simulate automatic credit |
| `web/components/product/provider.tsx`, `crm-provider.tsx` | Shared screen state and cache entry points | Whole-snapshot localStorage writes; cross-tab events are not multi-user synchronization; billing currently reconciles in a React effect |
| `web/components/product/access.tsx` | Login/signup/invite/recovery forms | Local member selection is not authentication. Signup adds an admin to the sample organization rather than creating an owned tenant |
| `web/lib/api/client.ts` | Formatting utilities and fixture read shape | Its single `listActivity` interface does not cover the app's many direct mutations; replacing this file alone is insufficient |
| QA report and fixtures | Existing journeys and rule examples | Browser QA does not prove server isolation, concurrency, webhook authenticity or provider behavior |
| `spike/speech-benchmark` branch | Separate benchmark harness exists | No product dependency; no committed provider decision found in this checkout. Handover says keys and recordings remain outstanding |

At that initial inspection, no API route handlers, database migrations, engine, production voice service or deployment compose files existed. Phase 1 has since added local auth, database, API and engine code; use its QA report and Phase 2 baseline for the current state. Voice/channel integrations remain unbuilt.

## 3. Architecture options and recommendation

1. **Accepted now: keep the specified service split, run the core locally.** Next.js web/API, TypeScript engine and local Supabase Auth/Postgres require no cloud account. Keep SQL migrations and domain rules portable. Managed hosting near Malaysia, object storage and LiveKit Cloud are future evaluation options only, after the owner reopens online spending.
2. **Self-managed infrastructure from day one.** Same application architecture with local/self-hosted auth, Postgres, storage and LiveKit SIP. Better early deployment parity, but networking, mail delivery, backups and media operations compete with proving the product. Keep a local compose path early, but do not make full production self-host operations the first milestone.
3. **Browser-first backend-as-a-service access.** Potentially less CRUD code, but a poor main boundary for money, external sends, agent tools and workflow scheduling. Use one application command layer for all these operations instead.

Accepted auth default: Supabase Auth with reproducible local Auth/Postgres services. Managed Postgres remains a possible future hosted choice. Its self-hosted auth adds infrastructure beyond the original small compose sketch. If a minimal bare-Postgres deployment is mandatory, evaluate an application-owned auth library before locking foundation; do not implement two auth systems. Supabase documents both [Next.js server-side auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) and [Docker self-hosting](https://supabase.com/docs/guides/self-hosting/docker).

Proposed code boundaries:

```text
web/                         existing UI + REST handlers + auth callbacks/webhooks
packages/contracts/          validated request/response schemas + OpenAPI
packages/domain/             tenant-scoped commands and policies, no React
packages/db/                 repositories, transaction context and local test fixtures
supabase/migrations/         sole SQL migration source, including RLS
packages/connectors/         calendar, messaging, payments, lead adapters
engine/                      pg-boss consumers, schedules, reconciliation
voice/                       new Python LiveKit worker, generated API client
infra/                       local compose, service configuration, runbooks
```

The browser calls authenticated commands. Web and engine share domain services. Voice calls a narrow internal API with short-lived credentials bound to its call, tenant and agent version; it does not carry a database service key. LiveKit media travels directly between the browser/phone and media service, not through Next.js request handlers.

## 4. Server authority and durable data

Keep the spec's tenant tables and add supporting records only when their milestone needs them:

- **Identity:** application user mapping, membership and invitations. Organization creation and initial owner membership are atomic. Verify sessions server-side; check active membership on every request. Owner/admin/staff permissions apply in both API and database access paths. Platform administrators are separate from tenant administrators.
- **Isolation:** tenant-owned rows carry `org_id`; foreign keys bind `(org_id, referenced_id)` to prevent cross-tenant references. Application database roles cannot own tables or bypass RLS. Establish tenant/user context inside each transaction and test connection-pool reuse. Workers also require explicit tenant scope. Global identity/provider catalogs and platform number inventory require separate policies rather than fake tenant IDs.
- **Agents:** drafts, immutable published versions, versioned knowledge snapshots/chunks, ingestion jobs and transfer targets. Pin the version and knowledge set at session start. UI locale never translates or rewrites stored business data.
- **CRM:** contacts, channel identities, conversations, messages, internal notes, calls, transcript segments and consent evidence. A contact can have multiple conversations/channels. Do not equate a phone match with verified personal identity. Migrate `phone_e164: null` to validated nullable E.164 plus separate provider identity. Replace numeric call outcomes with named values and an explicit unknown/unclassified state.
- **Scheduling:** service/resource calendars, branch schedules/closures, bookings, operation attempts and provider references. Store UTC instants and the relevant IANA time zone. Public-holiday import needs a verified source plus owner overrides; do not derive capacity from opening hours alone.
- **Connections:** connector accounts, encrypted credential references, granted scopes, capability flags, external IDs, subscription expiries, health and sync cursors. Plaintext tokens never enter frontend responses, audit payloads or logs.
- **Reliability:** webhook receipts, transactional outbox, external-operation attempts and reconciliation records. Include provider account, external event ID, tenant, correlation ID and processing state. Deduplicate within the correct provider/account scope.
- **Money:** payment attempts, raw provider usage, versioned retail rates, wallet ledger, reservations and refunds/adjustments. Keep posted customer amounts in integer sen; retain provider units/currency and sufficient precision before rounding. Provider expense and customer charge are different fields. Confirmed usage must not disappear because the wallet is empty: reserve/cap before dispatch, then settle usage and record any shortfall.
- **Privacy:** export/deletion jobs, recording/object metadata and access audit. Deletion must cover recordings, transcript copies, search embeddings and connector sync; retain only explicitly justified accounting/audit records with minimized identifying data. Define backup expiry and restore-time deletion replay before launch.

Database uniqueness, transactions and operation identities enforce idempotency. Queue delivery alone cannot make an external API call exactly once. Authenticated webhook receipt and outbox work must be durable before returning success. Use retries for safe reads/known failures; ambiguous external writes enter reconciliation and are never blindly repeated.

## 5. Connect every screen

| Screen group | Server reads/commands | Real events and jobs |
| --- | --- | --- |
| Login, signup, recovery, invite | Session, create organization, accept single-use invite, recover account | Auth provider callbacks and transactional email |
| Setup | Workspace bootstrap; save individual settings; onboarding progress | Knowledge ingestion, connector authorization, test results, number reservation and forwarding probe |
| Builder and test panel | Edit draft, ingest source, publish/restore as a new version, start test session | Real model chat; scoped LiveKit token; transcript/tool events; test result bound to tested configuration |
| Home and call log | Paginated activity, date/branch metrics, call detail, authorized recording URL | Call lifecycle, post-call summary, usage settlement and recording readiness |
| Inbox and contacts | Search, channel conversations, send, takeover/release, notes, consent/DNC, export/delete | Incoming/status webhooks; per-conversation serialization; cancel or invalidate queued AI replies after staff takeover |
| Bookings and branch hours | Availability, create/reschedule/cancel/request, schedule changes | Calendar write/reconciliation, external changes, watch renewal and conflict alerts |
| Integrations | Authorize, choose resources, reconnect/revoke, inspect health | OAuth callbacks, refresh, webhook registration, sync and token revocation |
| Phone numbers | Available inventory, reserve/assign, route, verify forwarding | SIP provisioning, expiring reservations, trunk status, correlated verification calls |
| WhatsApp settings | Onboarding, channel capabilities, template submit/status, calling permission | Meta events and template/quality changes; calling eligibility independent of chat readiness |
| Billing | Balance/ledger, checkout creation, payment status, receipts, funding preferences | Verified callbacks, provider reconciliation, usage settlement and refund adjustments |
| Settings | Workspace, branches, membership, notification policies, scoped keys, retention, audit | Invites, owner summaries, exports/deletions and retention jobs |
| Outbound | Workflow draft/publish, enroll/pause, run/review history | Scheduled workers; recheck DNC, consent, funds, quiet hours and channel capabilities immediately before dispatch |
| Hosted admin / self-host | Separately authorized platform actions / server-observed installation health | Number inventory, abuse limits, tenant pause, provider health; hosted billing disabled in self-host mode |
| Public pages | Approved public plans, documentation, safe demo session | Rate-limited isolated demo; public legal/pricing copy updated before commercial launch |

Replace `update(draft => ...)` and `setData(...)` with named commands such as `publishAgent`, `sendMessage`, `createBooking`, `createTopUp` and `requestContactExport`. Do not expose `saveWholeWorkspace` or accept client-supplied payment/usage/permission outcomes.

Use resource versions/ETags for edits, stable idempotency keys for commands, cursor pagination, and structured errors for validation, expired auth, forbidden access, edit conflicts, rate limits and unknown provider outcomes. Show “saved” only after server acknowledgement. Start cross-device refresh with query invalidation and bounded polling; add authenticated resumable SSE for active calls/inbox when needed. A stream disconnect must recover by fetching persisted records.

Keep explicit demo and real transports implementing the same command contracts. Demo fixtures stay isolated from real tenants, and no fixture data is imported automatically. A real API failure must show an error, never silently fall back to mock success. Keep theme/language locally; stop storing production CRM, session authority and wallets in localStorage. Server deployment configuration controls demo availability.

## 6. Integration order and limits

| Integration | Proposed first implementation | Evidence or gate |
| --- | --- | --- |
| Speech/LLM | Swappable configuration selected by the speech benchmark; text-tool runner before telephony | No provider default inferred from UI voice labels. Measure Malaysian speech, end-of-turn latency, interruptions and fallback; inspect current model IDs at implementation |
| LiveKit + Malaysian SIP | Browser WebRTC first, then one verified +60 trunk/number and owner forwarding | Obtain supplier/account evidence for DID availability, paperwork, caller ID, transfer, fallback and forwarding. [LiveKit transfer docs](https://docs.livekit.io/telephony/features/transfers/) describe mechanisms, not proof our trunk supports them |
| Google Calendar | First scheduling connector; Cal.com next for businesses already using it | OAuth, selected calendar, free/busy, local reservation, final check and provider write. Google supports [caller-supplied event IDs](https://developers.google.com/workspace/calendar/api/guides/create-events) for duplicate prevention; [watch channels](https://developers.google.com/workspace/calendar/api/guides/push) need lifecycle management |
| WhatsApp chat | Official Cloud API; one authorized test business before self-serve embedded onboarding | Verify account permissions, webhook signatures, templates, media and status semantics. Direct Meta pricing/onboarding pages returned HTTP 429 in this review; current pricing and entitlement remain unverified |
| WhatsApp calling | Separate capability-gated milestone after chat and SIP | [LiveKit's connector](https://docs.livekit.io/telephony/connectors/whatsapp/) requires LiveKit Cloud and explicit outbound permission. Self-hosted media needs a separate evaluated adapter. Revalidate +60 eligibility and channel-valid staff handoff; never assume PSTN transfer works |
| Own SaaS wallet | Provisional first choice: one Billplz top-up adapter, subject to merchant eligibility and payment-method confirmation; Stripe remains an alternative | Verify signed callbacks and query uncertain payments. Billplz documents [callbacks/signatures](https://www.billplz.com/api/). Do not implement both gateways initially or assume a visible DuitNow button proves entitlement |
| Automatic top-up | Disabled until a supported saved payment method/mandate and explicit authorization exist | Stripe documents [FPX as non-recurring](https://docs.stripe.com/payments/fpx). No simulated instant wallet credit in real mode |
| Outbound sources | Signed generic lead webhook, then Google Sheets, then authorized Meta/TikTok lead integrations | Lead import preserves consent evidence; importing a lead does not grant permission to call/message. Provider access/review is a separate gate |
| Later candidates | Cal.com, Microsoft 365, external CRM, commerce/order context and booking deposits | Follow customer demand. Booking deposits are merchant funds and a separate scope from funding JomCall's own wallet |

Google Calendar does not provide a transaction spanning our DB and every outside calendar editor. Local locking prevents our own concurrent bookings; external changes can still race. Keep a pending state until provider confirmation, detect external conflicts and reconcile. Without a calendar, create a booking request awaiting staff confirmation.

PSTN missed calls do not automatically grant permission to send WhatsApp messages. The spec's automatic text-back/confirmation promises must be conditional on current channel consent, template and policy eligibility. If ineligible, create a visible staff task. Similarly, the one-minute outbound target is conditional on eligibility and quiet hours.

Provider status and billing confirmation are distinct: an accepted send is not delivered; a delivered event does not by itself establish the final provider price. The preview's flat 5-sen message charge is illustrative. Version pricing rules and record provider evidence. [Stripe webhook documentation](https://docs.stripe.com/webhooks) also explicitly warns about duplicate and out-of-order events; apply equivalent defensive processing to each provider's documented semantics.

## 7. Build milestones and proof

| Milestone | Deliverable | Acceptance gate |
| --- | --- | --- |
| 0 — decisions and external feasibility | Confirm auth/hosting/storage defaults; continue isolated speech benchmark; start SIP, Meta, OAuth and merchant eligibility checks | Written choices and confirmed access/limits; missing supplier approval does not block local foundation |
| 1 — real core platform | Workspace packages, migrations/RLS, real sessions, owner/admin/staff, locations, agent drafts/versions, contacts, audit, demo/real transport and basic durable job runner | Two independent businesses on two browser profiles; persistence across restart; cross-tenant IDs denied; revoked member denied; concurrent edit conflict; immutable publish; no real-mode fixture fallback |
| 2 — agent tools and booking | Knowledge ingestion/search, text test, typed tool API, Google authorization and booking requests/confirmed bookings | Server rejects cross-tenant tool targets; model cannot bypass permissions; duplicate booking attempt creates one event; timeout/revoke/conflict visible; publishing pins knowledge; URL ingestion blocks private-network targets and unsafe redirects |
| 3 — inbound voice | Python worker, browser microphone call, SIP dispatch, disclosure, transcript/recording, staff transfer, fallback, post-call processing and shadow usage | Real incoming call reaches agent; booking/message appears in CRM; disconnect and worker failure recover; latency measured against ~1.2 s target and >3 s silence fallback; provider usage reconciled without customer charging |
| 4 — WhatsApp chat | Official incoming chat, AI/staff replies, templates, conditional missed-call text-back and owner summaries | Duplicate/out-of-order webhook proof; staff takeover prevents queued AI send; expired reply window enforced server-side; uncertain sends stay in review; revoked token cannot send |
| 5 — hosted self-serve and billing | Embedded onboarding, number pool/forwarding verification, trial policy, checkout, wallet settlement/limits, retention/export/delete | Closing payment tab does not lose confirmed credit; repeated webhook credits once; confirmed usage survives low balance; refund/failed payment reconciles; no duplicate number assignment; deletion completes across stores |
| 6 — outbound and optional WhatsApp voice | Immutable workflow revisions, durable waits, lead imports and eligibility-gated calling adapter | Restart resumes jobs; DNC/quiet hours checked at dispatch; re-entry rules enforced; unclear result never blindly resent; WhatsApp call permission and staff handoff proven separately |
| 7 — release hardening | Hosted deployment, self-host compose, backups/restore, observability, quotas, CI, operational and public documentation | Restore drill, concurrent-call load test, outage drills, tenant isolation suite, device/Safari checks, approved legal/pricing/data-processing policies |

Billing ledger primitives and usage capture start before paid calling; charging begins only at milestone 5. Local compose and secrets/config conventions start in foundation; release-grade self-host documentation and operations finish at milestone 7. Cal.com can follow the first booking connector independently; it need not delay inbound voice.

## 8. First sub-project to specify next

**Core platform and real-data bridge.** Scope: auth, tenants/RLS, branches, server commands, agent draft/publish, contacts/notes/consent, audit, durable jobs and frontend transport cutover. Exclude live telephony, external calendar writes and real payments from this first demo.

First end-to-end demo: sign up → create an owned organization → configure business/branch → save and publish an agent → add a contact/note → reload from another authenticated browser session → verify another organization cannot read or change it. Existing mock demo remains available separately.

The follow-on product proof is one real incoming call → pinned agent version → successful calendar booking or explicit booking request → contact timeline → call log → confirmed usage. This is the first useful vertical slice; connecting every advertised connector before that would delay validation.

Accepted for the next phase: local Supabase Auth/Postgres, local Next.js API/TypeScript engine, isolated mock/real transports, Google Calendar first and a single Billplz wallet adapter in later milestones. No online resources or subscriptions now. Hosting/storage region, speech provider, Malaysian trunk, merchant eligibility and WhatsApp calling capability remain deferred and evidence-driven. Phase 1 is planned in the linked local-core documents; later milestones do not start automatically.
