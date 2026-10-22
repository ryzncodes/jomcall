# Phase 1: local core platform and real-data bridge

Date: 2026-10-16. Status: proposed detailed design for owner review. The owner approved the backend roadmap defaults and requested local-only, zero cloud spend. This document narrows those decisions into Phase 1; it does not authorize deployment or paid services.

Baseline: [architecture](2026-10-15-jomcall-design.md), [backend roadmap](../plans/2026-10-15-backend-roadmap.md), and [screen inventory](../../frontend/screens.md). Phase 1 here implements architecture sub-project 2; the separate speech spike remains sub-project 1 and is never imported.

## 1. Outcome and boundaries

A person can create and verify a local email account, create an organization, invite a teammate, configure branches and an agent, publish immutable versions, and manage contacts, notes and consent. Another signed-in browser sees committed data. A different organization cannot access it. The worker performs durable contact export/deletion jobs. Restarting services retains data. The existing complete mock preview continues to work without any backend.

Included: real local Supabase Auth/Postgres, server-side session verification, owner/admin/staff roles, tenant RLS, manual knowledge editing and text-document upload, version history/compare/restore-to-draft, contact search/edit/notes/consent/DNC/export/delete, branch schedules, audit, and a pg-boss worker with transactional outbox.

Excluded from this phase: cloud accounts, deployments, Google OAuth, website fetching, embeddings/model inference, browser audio, SIP, WhatsApp, external calendar writes, payments, API keys, notifications sent outside localhost, outbound automation and hosted administration. Google Calendar first and one Billplz wallet adapter remain later-phase defaults, subject to provider access; nothing connects to them now. AI testing remains a simulation only in mock mode. Saving or publishing a real agent does not mean it has passed a voice test or is live on a phone line.

## 2. Local topology and operating constraints

| Service | Endpoint | State |
| --- | --- | --- |
| Existing mock preview | `http://127.0.0.1:4181` | Existing localStorage fixtures; no auth/database dependency |
| Real-data web/API | `http://127.0.0.1:4182` | Own build output, verified local sessions, real local DB |
| Supabase auth gateway | `http://127.0.0.1:54621` | Project `jomcall-local`; no linked remote project |
| Postgres | `127.0.0.1:54622` | Dedicated named volumes, application schemas and queue |
| Optional Studio | `127.0.0.1:54623` | Off in the default lean profile |
| Captured mail inbox | `http://127.0.0.1:54624` | Confirmation, recovery and invitation email stays local |
| Optional local SMTP publish | `127.0.0.1:54625` | Only if needed for the host worker to reach this project's Mailpit; check before use |
| Engine | No public listener | Host Node process, queue and DB access only |

Ports were free when inspected; startup checks again. Existing unrelated Supabase projects and Postgres containers must not be stopped, reused, reset or reconfigured. Docker is running; Node 24.15.0, npm 11.12.1 and Supabase CLI 2.98.2 are installed. About 14 GiB filesystem space is available. These are observations, not minimum requirements or capacity guarantees.

Use the installed CLI version for the first reproducible local setup and pin its service-image versions. Do not auto-upgrade globally. Keep Auth, Postgres, gateway and Mailpit; disable Realtime, Storage, image proxy, Studio, metadata UI, Edge Runtime, analytics, log collector and connection pooler unless a documented dependency requires one. No model downloads, audio datasets or object-storage container in Phase 1. Plain-text knowledge lives in Postgres; exports are generated from DB records on authenticated download.

Create a dedicated Docker bridge with default host binding `127.0.0.1`, and pass its network ID to the CLI. Inspect actual published bindings before declaring the stack ready; any public IPv4/IPv6 binding fails the check and stops only this project's newly started services. This is required because the inspected CLI source specifies host ports without an explicit host IP. Do not change Docker's global network defaults.

Startup uses a free-space gate (at least 10 GiB before new pulls, stop further downloads below 5 GiB), checks Docker capacity and existing cached images, and reports actual download/storage needs when known. These are conservative project guardrails, not estimates of image size. If capacity is insufficient, stop with the measured shortfall; do not prune unrelated images/volumes or silently start a cloud substitute. Downloads use official registries once; ordinary application execution is local. Disable app telemetry, external SMTP and optional auth/model providers. This is not a claim that Docker's bridge blocks all host egress; test application requests and provider configuration explicitly.

`local:stop` preserves volumes. Reset is a separate guarded command targeting a disposable test database or an explicitly approved local reset. Never use `supabase stop --all`, `--no-backup`, remote `link/login/push`, or broad Docker prune. CLI output containing local keys must be captured directly into gitignored mode-0600 env files, never printed in logs or chat. Preview remains usable if the local DB is stopped.

## 3. Mode boundary and frontend reuse

Mode is a server configuration enum, `JOMCALL_MODE=mock|local`, never a URL/localStorage override. Default remains mock for the existing preview. Separate outputs `.next-mock` and `.next-local` allow both processes to run; existing port 4181 process is restarted only when its own build is ready. A mock process denies real-data endpoints. A local process never mounts ProductProvider/CrmProvider or reads their fixture keys. A malformed mode fails startup.

Extract presentation from persistence: `WorkspaceChrome`, navigation, form sections, version list and contact profile accept typed view models and named commands. Existing AppShell/preview controllers supply mock values. A local controller supplies server responses. Do not render a second divergent visual design, and do not make `SetupDraft` the server database schema. Migrate supported views incrementally; leave unsupported features behind capability guards in local mode. A capability guard applies before mounting the component, so hidden buttons cannot leave simulated effects running.

Real-mode routes:

| Routes | Phase 1 behavior |
| --- | --- |
| `/login`, `/signup`, `/forgot-password`, `/invite` | Real local email auth, confirmation/recovery/invite flows; Google option disabled with explanation |
| `/app` | Real organization/setup progress and contact count; channel metrics explicitly unavailable, never fictional statistics |
| `/app/setup` | Save business/branch, manual knowledge, languages and agent settings; external steps marked unavailable, never marked complete |
| `/app/agent` | Draft, manual FAQ/services, UTF-8 text document content, publish/history/compare/restore; no provider voice audition promise |
| `/app/contacts` | Server list/profile/edit/create, private notes, channel-specific consent, DNC, export/delete jobs |
| `/app/hours`, `/app/settings` | Organization, branches/hours/manual closures, members/invites, audit; provider notifications/keys/recording jobs unavailable |
| Other application routes, `/admin`, `/self-host` | Clear unavailable-in-local-phase message and navigation back; no mock provider success, fabricated health or hidden mutation |
| Marketing/pricing/docs/policies | Existing sample content remains labeled preview; entry links use the current server mode; no promise of live channels |

Use BM/English and existing light/dark styles. Preserve all mock routes and store keys; never bulk-import browser fixtures into real tenants. Shared named command interfaces are used by mock and HTTP implementations for migrated views. Legacy snapshot mutation remains only behind the mock boundary for unmigrated views. Failure in local mode is an error state, not a fallback to sample data. Data refresh is on mount, after mutations and window focus; visible contact/team lists may poll every 15 seconds, cancelled on unmount/hidden tab. Do not add realtime infrastructure yet.

## 4. Auth and authorization

Use Supabase Auth as the identity provider and the Next.js API as a backend-for-frontend. Browser forms call same-origin auth endpoints. Keep tokens in scoped HttpOnly, SameSite=Lax cookies; Secure outside explicitly loopback HTTP. Never persist passwords or tokens in browser storage. Cookie names are project-specific (ports do not isolate cookies). Auth callbacks allow only configured local paths, with state/PKCE or provider token-hash verification as appropriate. All state-changing app endpoints validate Origin and CSRF token, including login and logout. Use no-store responses for identity/business data; no static caching of authenticated pages.

Verify token signatures/expiry using the selected Supabase SDK's verified method; use fresh user lookup for confirmation status. Check the token's `session_id` remains present for that user before business commands, so logout/recovery revocation is not inferred from an unexpired JWT. Do not use `getSession().user` or user-editable metadata for authorization. Request context comes from verified identity, not headers naming an arbitrary actor. Missing, expired, revoked and malformed sessions return 401; absent membership cannot distinguish another tenant's object from a nonexistent one.

Each user can belong to several organizations. First workspace creation chooses a primary organization and location; subsequent reads use an explicitly selected membership. API validates membership rather than trusting the selected ID cookie. Account creation and organization creation are separate resumable operations: confirmed user with no organization is sent to workspace creation. Creating the organization, initial owner, primary location and initial agent is one application DB transaction. A client-generated idempotency key prevents duplicate organization creation after a timeout. No auth-user trigger silently creates a tenant.

Roles:

| Action | Owner | Admin | Staff |
| --- | --- | --- | --- |
| Read workspace, published agent, contacts and notes | Yes | Yes | Yes |
| Create/edit contacts, notes and consent/DNC | Yes | Yes | Yes |
| Edit workspace/branches/manual knowledge; publish/restore agent | Yes | Yes | No |
| View agent drafts and version history | Yes | Yes | No |
| Invite/revoke/change non-owner members | Yes | Yes, staff only | No |
| Promote admin / change ownership | Admin promotion yes; ownership transfer deferred | No | No |
| Export/delete contacts and read audit | Yes | Yes | No |

Owner cannot be removed or demoted in Phase 1. Serialize membership changes on the organization row, and recheck both actor and target after acquiring locks. Invitation tokens are random, stored hashed, single-use, seven-day expiry, tied to org/email/role; acceptance requires a matching confirmed identity. A DB-backed local mail outbox sends invite links only to Mailpit. For retryable delivery, keep the raw token encrypted with AES-256-GCM in a short-lived invitation delivery field, using a project-local key outside the database; queue payloads contain only the invitation ID. Purge ciphertext after delivery, acceptance, revocation or expiry. An explicit resend rotates the token and invalidates the old link. App audit never records tokens or ciphertext. Supabase handles signup/recovery mail using its local mail capture path. Recovery links are single-use and do not allow arbitrary redirect URLs.

## 5. Database shape and trust boundaries

One migration source: `supabase/migrations/`, created with CLI-generated timestamps. Repository code lives in `packages/db`; do not create a competing migration system. Private `app` schema is not exposed by PostgREST; revoke access from anon/authenticated/service roles that do not need it. The local public Data API must not provide a second path around application commands.

| Table | Essential data/invariants |
| --- | --- |
| `organization` | UUID id, self `org_id = id`, name, business type, revision, created/updated timestamps |
| `member` | org, auth user UUID, role, revision, active/revoked; unique org/user |
| `invitation` | org, normalized email, permitted role, token hash, expiry, accepted/revoked state |
| `location` | org, name, primary flag, address, state, IANA timezone, revision, archived timestamp; one active primary per org; primary/in-use locations cannot be archived |
| `location_schedule` | org/location, seven weekday intervals and dated closures; strict HH:mm ordering; no invented holiday feed |
| `agent` | org, primary location, editable draft JSON with validated fields, revision, published version FK |
| `knowledge_item` | org/agent, kind FAQ/services/text-document, name, UTF-8 content, revision; limits below |
| `agent_version` | org/agent, sequence number, immutable snapshot including all knowledge/settings/disclosure, timestamp, actor; unique agent/sequence |
| `contact` | org, name, nullable E.164, preferred language, DNC, revision, created/updated timestamps |
| `contact_note` | org/contact, text, author, timestamp; internal only |
| `consent_record` | org/contact, channel, purpose, grant/revoke, source/evidence text, actor, recorded_at; append-only |
| `audit_log` | org, actor or job identity, action, target type/id, safe metadata, timestamp; no raw notes, secrets or tokens |
| `command_receipt` | org or bootstrap actor scope, actor, command, idempotency key, request hash, resource/status references only, expiry; no contact content |
| `outbox` | org, server-controlled execution namespace, event kind, resource id, operation id, delivered_at, attempts; committed with domain changes |
| `privacy_job` | org, nullable contact FK plus stable target UUID, requested_by, type export/delete, pending/running/completed/failed, expiry, safe error code; durable status |

All tenant children use `(org_id, id)` unique references and composite foreign keys. Auth's own tables, queue internals and private global lookup functions are explicit exceptions to tenant row layout. Install pgvector but do not generate embeddings or invent a dimension/model choice in this phase. Storing snapshot knowledge makes published versions immutable even if the draft changes.

Use `jomcall_app` for app queries (LOGIN, NOINHERIT, NOBYPASSRLS, not table owner). `withUserTransaction(identity, orgId, fn)` begins a transaction, sets transaction-local verified actor/session/org context with parameterized `set_config(..., true)`, checks active session and membership, calls the repository and commits/rolls back before returning the connection. RLS covers SELECT, INSERT, UPDATE USING/WITH CHECK and DELETE. API role checks and RLS agree; setting org alone is insufficient. Test reusing a one-connection pool across different users and failures.

Membership/session lookup policies must not recursively query themselves. Use narrowly scoped private authorization functions owned by a NOLOGIN role with SELECT only on membership and the required auth session fields. Any BYPASSRLS privilege for this helper owner is restricted by those grants; the application never inherits it. Fix search_path, qualify table names, revoke PUBLIC EXECUTE, and grant only the necessary runtime roles. Bootstrap is a separate tightly scoped function: requires a verified active session, allows creating only an organization with that user as owner, uses idempotency, and cannot join an existing tenant or accept an arbitrary owner ID. Bootstrap uses its own NOLOGIN function-owner role with only the necessary tenant creation/receipt grants; it does not expand the read-only authorization helper. Do not solve ordinary permission failures with SECURITY DEFINER. The application DB credential and verified request-context setter remain trusted server boundaries: SQL context variables are not cryptographic identities and must never be exposed to browser-supplied SQL.

Queue access has its own credentials/schema. The engine's business role is not the migration owner: it may access only outbox/privacy/mail work through job-specific functions, with org/resource IDs resolved from stored jobs. It has no arbitrary agent publishing or membership mutation permission. Global queue claims are privileged internal operations; payload org IDs alone are never authority. Provision runtime role passwords from local secrets after migrations, not literal committed SQL.

API mutations validate strict schemas, reject unknown privileged fields, enforce payload limits, and check expected revision. Updates use `WHERE revision = expected` and return 409 on conflict. POST commands require an idempotency key; same key/request replays the logical result reference and HTTP status (with its current authorized representation), same key/different request returns 409. A deleted/revoked resource is not resurrected by replay. Reauthorize before returning a stored response, so a revoked actor cannot replay sensitive results. General receipts expire after 24 hours; immutable publish numbering, invite acceptance and privacy job identities have durable constraints.

Limits: names 1–120 characters; notes 1–5,000; knowledge items at most 100 per agent, each at most 100,000 UTF-8 bytes, total 1 MiB; text uploads `.txt`/`.md` only, reject NUL/binary/invalid UTF-8. Render content as text, never executable HTML. These are explicit Phase 1 capacity limits. PDFs, website import and vector retrieval remain later work. Normalize phone fields without guessing a country; a supplied phone must be E.164, nullable when unknown. Duplicate phone values warn but do not auto-merge people. Consent grants require channel, purpose and evidence; DNC blocks future outbound eligibility independently of older grants.

## 6. Durable jobs and privacy

Commit privacy_job plus outbox event in one transaction. The engine claims outbox rows with locking, sends pg-boss jobs using a stable operation identity, then marks enqueue state. A crash between enqueue and marking can produce a duplicate job: handlers deduplicate using privacy_job state, not an exactly-once assumption. Retry transient DB failures with bounded exponential backoff; after five attempts expose failed/retry state. New retry resumes the same logical operation. Runs do not depend on an open browser. Normal local work uses execution namespace `local`; automated test API/worker instances use a random test namespace and fixture-only cleanup. Namespace is private server configuration, never browser input; test and development workers cannot consume each other's outbox jobs.

Export jobs prepare a versioned, authorized export manifest; download serializes current non-deleted contact data, notes and consent as JSON. Include both job preparation time and actual serialization time in the export; this is a current-data export, not a historical snapshot. No public file URL or customer content inside queue payloads. Only an active owner/admin in the job's org can download; expire after 24 hours. Audit download. If a contact is deleted, invalidate all export jobs immediately. This avoids introducing object storage for a small local export.

Deletion first marks a job pending and blocks new contact edits/notes/consents for that contact; worker locks the record and removes the contact, notes and consent records and invalidates export access. Scrub any cached command responses that contain deleted contact content, and retain only minimal deletion audit metadata and the job outcome. Phase 1 has no recordings, embeddings or external copies; later adapters must extend deletion before storing those. Recovery tests prove a duplicate/deferred job cannot resurrect data. UI must distinguish requested deletion from completed deletion.

## 7. API surface and errors

All business endpoints are under `/api/v1`, authenticated and tenant-scoped. Tenant resource routes require `X-Organization-Id`; it selects a scope but never grants access. Organization path IDs must match that scope. Session, organization-list/create and invitation-accept endpoints are pre-tenant exceptions that still require verified identity. Cookie auth and CSRF are mandatory for business mutations. Single-use provider-verified auth link callbacks are explicit GET exceptions to the normal POST/CSRF rule. Unknown tenant/object uses 404; signed-out uses 401; known membership with insufficient permission uses 403; validation 422; stale revision or idempotency mismatch 409; unavailable capability 503 with `CAPABILITY_UNAVAILABLE`. Responses include `requestId`; logs do not include request bodies or authorization headers.

Contracts: `/session`; `/organizations` (POST atomically creates workspace, GET lists memberships); `/organizations/:orgId/bootstrap` (GET reads workspace summary); organization update; `/locations` and per-location schedule; `/members` and `/invitations`; `/agents/:id/draft`, `/knowledge`, `/versions`, `/publish`, `/restore`; `/contacts`, `/contacts/:id`, `/notes`, `/consents`, `/do-not-contact`, `/export`, `/deletion`; `/jobs/:id` and `/jobs/:id/download`; `/audit`. Root auth handlers cover signup/login/logout/confirmation/recovery/reset and CSRF. No generic write-snapshot endpoint exists.

Contact/audit lists use opaque cursors over `(created_at, id)`, page size 25 and maximum 100. A cursor encodes query/sort scope and is validated against the current tenant; it never bypasses tenant filtering. Bootstrap returns workspace identity, role, locations, primary agent summary and capabilities, not all contacts or audit history. Server validates session/membership on every read and command. Contact note/consent additions atomically advance contact revision to make stale-state conflicts visible.

## 8. Acceptance and release boundary

Prove locally: email confirmation/recovery/invites in Mailpit; two organizations isolated across endpoints, SQL, IDs and job downloads; last owner protected; immediate membership revocation; immutable versions under concurrent publish; multi-user edit conflict; stable idempotent retries; export/delete after engine restart; no client-forged money/status/permission writes; local failure never yields sample success; mock preview works with DB stopped; query parameter cannot switch modes; all configured network listeners are loopback; runtime uses no external provider calls; startup/shutdown leave other projects unchanged.

UI proof includes mobile/desktop, both languages/themes, keyboard access and all fifteen navigation destinations in mock mode. Phase 1 does not establish production security certification, provider eligibility, real speech quality or cloud deployment readiness. It produces a local, durable, testable core that later phases can connect without changing tenant boundaries.

## 9. Source checks

Official [Supabase local CLI documentation](https://supabase.com/docs/guides/local-development/cli/getting-started), [configuration](https://supabase.com/docs/guides/local-development/cli/config), [auth SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), [sessions](https://supabase.com/docs/guides/auth/sessions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [pg-boss](https://github.com/timgit/pg-boss), and [Docker bridge binding](https://docs.docker.com/engine/network/drivers/bridge/) were checked. Installed CLI help is the command syntax authority for this phase. Its v2.98.2 `internal/start/start.go` source confirms default publish bindings omit HostIP. Current docs include features newer than that CLI; do not copy new config keys without validating locally. Changelog's October 12 TLS-cipher change concerns hosted HTTP APIs and does not require a local HTTP runtime change. No managed project was queried or created.
