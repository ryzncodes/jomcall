# Local Core Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work sequentially in the current session unless the owner explicitly chooses delegation. This document is a plan, not a record of completed work.

**Goal:** Make local accounts, tenant workspaces, agent versions and CRM records durable and shared across signed-in browsers, while preserving the complete independent mock preview.

**Architecture:** Keep Next.js as the web/API boundary, Supabase Auth/Postgres as local identity/storage, and a TypeScript pg-boss engine for durable jobs. Browser requests invoke validated domain commands; database roles, transactions and RLS enforce tenant boundaries. Extract shared UI presentation while retaining separate mock and real persistence controllers.

**Tech Stack:** Existing Next.js 16/React/TypeScript; Node 24.15.0; npm workspaces; local Supabase CLI 2.98.2/Docker; PostgreSQL/pgvector; `pg`, `@supabase/supabase-js`, Zod, pg-boss, Nodemailer; Node test runner with `tsx`; existing browser QA workflow. Resolve compatible package releases during execution, install with `--save-exact`, record licenses and commit the lockfile. Do not upgrade existing frontend packages as part of this work.

**Spec:** [Local Phase 1 design](../specs/2026-10-16-local-core-platform-design.md), subordinate to [architecture sub-project 2](../specs/2026-10-15-jomcall-design.md). Read both, repository `AGENTS.md`, `web/AGENTS.md`, and [screen inventory](../../frontend/screens.md) before execution.

## Global Constraints

- Local only. No cloud resources, provider accounts, paid services, deployments, remote database commands or external message delivery.
- Initial npm/Docker downloads need internet. Ordinary application runtime uses localhost only; no external AI, calendar, payment, telephony or WhatsApp calls.
- `JOMCALL_MODE=mock|local` is server configuration; default `mock`. No URL, cookie or localStorage mode override. Local API failure never returns fixtures.
- Mock web `127.0.0.1:4181`, local web `127.0.0.1:4182`, Supabase gateway `54621`, database `54622`, optional Studio `54623` (off), Mailpit `54624`. Project/network `jomcall-local`.
- At least 10 GiB free before new image pulls; stop further downloads below 5 GiB. Check actual capacity first. Never prune another project's storage or stop its processes.
- Shutdown preserves database volumes. No `supabase stop --all`, `--no-backup`, cloud `link/login/push`, or unguarded reset commands.
- No secrets or real personal data in git, output, screenshots or logs. Local env files mode 0600 and gitignored. Use fictional names, `.invalid` email fixtures and nullable phones.
- AGPL-3.0-compatible dependencies; feature branch; small Conventional Commits. Do not import speech-spike code.
- BM and English, existing mobile/desktop/light/dark design, integer-sen money fields when introduced, UTC stored timestamps, `Asia/Kuala_Lumpur` default branch time zone, nullable validated E.164 phone numbers.
- Every tenant child has `org_id`, composite tenant references and RLS. Application role is not table owner and cannot bypass RLS; jobs have narrowly scoped credentials.
- AI/recording disclosure remains explicit. Consent and DNC are distinct. Export/deletion are durable and audited, never client-only success messages.
- Only `supabase/migrations/` owns schema history; generate filenames with `supabase migration new <name>`. Never invent timestamps or use an additional ORM migration system.

## Review Focus

1. Two browser tabs save stale drafts or double-click publish: preserve newer work, return 409 for conflicts, and create only one version for a repeated command. Task 5.
2. A revoked user still has an unexpired JWT or a cached successful response: deny the next request and do not replay protected data. Tasks 2–4.
3. A crash occurs after enqueue but before outbox acknowledgement, or during privacy work: retry without duplicate effects or resurrecting deleted data. Task 7.
4. Existing mock localStorage is present while a real API is down: show an error, never sample contacts or a simulated success. Task 8.
5. Low disk, an occupied port or an unrelated Docker project exists: fail before destructive changes; stopping JomCall leaves other stacks and its own persisted records intact. Tasks 1 and 9.

## Delivery order and reviewable demos

| Gate | Tasks | Demonstration |
| --- | --- | --- |
| A — local identity and isolation | 1–4 | Signup/confirmation in local mail, create two workspaces, persist/accept invitations through API tests, reject cross-tenant access and revoked sessions (invite mail delivery arrives in Task 7) |
| B — durable business core | 5–7 | Configure branch/hours, publish immutable agent, edit contacts/consent, complete export/deletion after worker restart |
| C — connected application | 8–9 | Existing design reads real local records on 4182; 4181 retains every mock flow even with database stopped |

Each task must pass before its dependent task starts. No voice service, Redis, object store, external connector package or container orchestration overhaul in this phase.

## File map and contracts

| Paths | Responsibility |
| --- | --- |
| Root `package.json`, `package-lock.json`, `tsconfig.base.json` | Workspace scripts, pinned dependencies, shared TS settings; replace nested install lock only after reproducibility proof |
| `infra/local/{services.json,README.md}`, `scripts/local/{check,start,stop,env,guard}.mjs`, `supabase/config.toml` | Project-specific local lifecycle, port/disk/binding checks, redacted env provisioning |
| `supabase/migrations/`, `supabase/auth-grants.sql` | Schema, policies, grants and password-free role definitions; runtime password provisioning stays outside committed SQL |
| `packages/contracts/src/{common,auth,workspace,agent,contacts,jobs,commands,index}.ts` | Strict runtime schemas, inferred TypeScript input/output contracts; no server dependencies |
| `packages/db/src/{pool,context,errors,receipts}.ts`, `repositories/{workspace,members,agents,contacts,privacy}.ts` | Parameterized SQL, request transaction context, domain persistence |
| `packages/domain/src/{workspace,members,agents,contacts,privacy,authorization}.ts` | Named commands and rules; no React, cookies or provider SDKs |
| `web/lib/server/{config,auth,csrf,api,services}.ts` | Verified identity, HTTP boundary, capability enforcement, dependency construction; import `server-only` |
| `web/app/api/auth/[action]/route.ts`, `web/app/api/v1/[...path]/route.ts` | Thin, explicit method/path dispatch tables; unknown combinations 404/405; no dynamic arbitrary function invocation |
| `web/lib/core/{client,mock,http,view-models}.ts` | Shared command interface and separate transports; only response contracts enter client bundles |
| `web/components/product/{workspace-chrome,core-views,local-controller}.tsx` | Shared visual shell and core forms plus real-mode loading/errors; preserve existing mock controllers |
| `engine/src/{index,queue,outbox,privacy,mail}.ts` | Queue setup, outbox claims, privacy handlers, localhost mail transport |
| `tests/{helpers,db,api,domain,engine}/`, `docs/qa/2026-10-16-local-core-platform.md` | Isolation and failure evidence; no real customer fixtures |

Each new package has its own `package.json` and `tsconfig.json`. Keep modules focused; split `core-views.tsx` into adjacent named view files if it grows beyond the shared shell/forms responsibility. Preserve current `web/components/product/navigation.tsx` groups.

### Shared types and transport surface

Define these in `packages/contracts/src/common.ts` and `commands.ts`; schema modules infer concrete object types. UUID is a validated UUID string, `Instant` is an ISO UTC string, and `Revision` is a positive integer. All schemas are strict: unknown fields produce 422.

```ts
export type Mode = 'mock' | 'local';
export type Role = 'owner' | 'admin' | 'staff';
export type Identity = Readonly<{ userId: string; sessionId: string; confirmedEmail: string }>;
export type TenantContext = Readonly<{
  identity: Identity; orgId: string; role: Role;
}>;
export type MutationMeta = { idempotencyKey: string };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; field?: string }; requestId: string };
export type CoreClient = {
  execute<K extends keyof CommandMap>(
    command: K, input: CommandMap[K]['input'], meta?: MutationMeta
  ): Promise<CommandMap[K]['output']>;
};
```

`Identity` is an internal type, never an accepted actor field in a browser request. `confirmedEmail` comes from the fresh verified Auth user response, not JWT user metadata or client input; invitation acceptance compares it to the stored normalized invite email. `CoreClient` rejects a mutation without `meta`. Read requests do not need an idempotency key. HTTP errors become typed errors carrying status/code/requestId; they never resolve as successful fixture values.

The following table defines `CommandMap`; create a strict input and output schema per row in the named schema module. Return rows use only public fields in design §5, never token hashes, delivery ciphertext, queue internals or password/session fields. Nested row shapes are named `Workspace`, `Member`, `Location`, `AgentDraft`, `AgentVersion`, `KnowledgeItem`, `Contact`, `ContactNote`, `ConsentRecord`, `PrivacyJob`, and `AuditEntry`. Outputs include UUID, tenant UUID, timestamps and revision where applicable; use explicit select lists.

| Module / command | Input | Output / HTTP mapping beneath `/api/v1` |
| --- | --- | --- |
| auth: `getSession` | empty object | verified user id, email, memberships; GET `/session` |
| workspace: `listOrganizations` | empty object | member organizations; GET `/organizations` |
| workspace: `createOrganization` | name, businessType, primaryLocationName | org/location/agent IDs and owner role; POST `/organizations` |
| workspace: `getBootstrap` | orgId | Workspace, role, locations, agent summary, capabilities; GET `/organizations/:orgId/bootstrap` |
| workspace: `updateOrganization` | orgId, expectedRevision, name, businessType | Workspace; PATCH `/organizations/:orgId` |
| workspace: `createLocation`, `updateLocation`, `archiveLocation` | orgId, location fields; updates include id/expectedRevision | Location; POST `/locations`, PATCH `/locations/:id`, POST `/locations/:id/archive` |
| workspace: `getSchedule`, `saveSchedule` | locationId; save adds expectedRevision, timezone, weekdays, closures | schedule; GET/PUT `/locations/:id/schedule` |
| workspace: `listMembers`, `listInvitations` | empty object | Member[] / safe invitation[]; GET `/members`, `/invitations` |
| workspace: `inviteMember`, `revokeInvitation`, `resendInvitation` | email + role / invitationId | invitation id/state/expiry; POST `/invitations`, `/invitations/:id/revoke`, `/invitations/:id/resend` |
| workspace: `acceptInvitation` | token | membership/orgId; POST `/invitations/accept` (verified identity, before membership) |
| workspace: `setMemberRole`, `revokeMember` | memberId, expectedRevision, role for set | Member; PATCH `/members/:id`, POST `/members/:id/revoke` |
| agent: `getAgentDraft`, `saveAgentDraft` | agentId; save adds expectedRevision and validated settings | AgentDraft; GET/PUT `/agents/:id/draft` |
| agent: `listKnowledge`, `saveKnowledge`, `deleteKnowledge` | agentId; mutation adds expectedAgentRevision, item fields/id | knowledge list or updated agent revision; GET/POST `/agents/:id/knowledge`, DELETE `/agents/:id/knowledge/:itemId` |
| agent: `publishAgent` | agentId, expectedRevision | AgentVersion; POST `/agents/:id/publish` |
| agent: `listAgentVersions`, `getAgentVersion` | agentId, optional cursor / versionId | Page<AgentVersion summary> / AgentVersion; GET `/agents/:id/versions`, `/agents/:id/versions/:versionId` |
| agent: `restoreAgentDraft` | agentId, versionId, expectedRevision | AgentDraft; POST `/agents/:id/restore` |
| contacts: `listContacts`, `getContact` | search/cursor/limit / contactId | Page<Contact> / Contact profile; GET `/contacts`, `/contacts/:id` |
| contacts: `createContact`, `updateContact` | name, nullable phone, preferredLanguage; update adds contactId/expectedRevision | Contact; POST `/contacts`, PATCH `/contacts/:id` |
| contacts: `addContactNote` | contactId, expectedRevision, text | ContactNote and new revision; POST `/contacts/:id/notes` |
| contacts: `recordConsent` | contactId, expectedRevision, channel, purpose, granted, source, evidence | ConsentRecord and new revision; POST `/contacts/:id/consents` |
| contacts: `setDoNotContact` | contactId, expectedRevision, enabled, reason | Contact; PUT `/contacts/:id/do-not-contact` |
| jobs: `requestContactExport`, `requestContactDeletion` | contactId, expectedRevision | PrivacyJob; POST `/contacts/:id/export`, `/contacts/:id/deletion` |
| jobs: `getJob`, `retryJob` | jobId | PrivacyJob; GET `/jobs/:id`, POST `/jobs/:id/retry` |
| jobs: `downloadContactExport` | jobId | versioned current-data JSON attachment; GET `/jobs/:id/download` |
| workspace: `listAudit` | cursor/limit | Page<AuditEntry>; GET `/audit` |

Tenant commands use selected `X-Organization-Id`; path/input org IDs must match it. `getSession`, list/create organizations and invite acceptance are verified-identity exceptions. Mutations carry `Idempotency-Key`, `X-CSRF-Token` and same-origin cookies. Schema names and request paths in this table are the source for the explicit route dispatcher and transport, not two separately maintained maps. Generate an OpenAPI artifact from these schemas after all handlers exist; do not add a second handwritten contract.

Database interface:

```ts
import type { PoolClient } from 'pg';
export interface Database {
  withUserTransaction<T>(identity: Identity, orgId: string,
    run: (tx: PoolClient, context: TenantContext) => Promise<T>): Promise<T>;
  bootstrap(identity: Identity, input: { name: string; businessType: string;
    primaryLocationName: string }, meta: MutationMeta): Promise<{
      orgId: string; locationId: string; agentId: string; role: 'owner'
    }>;
}
```

Domain command modules consume `Database`, parsed inputs and verified identity; constructors receive dependencies explicitly. HTTP handlers and worker functions never accept SQL or repository method names from clients.

### Test harness convention

`tests/helpers/local.ts` exports `createHarness()` returning `{ db, alice, bob, staff, orgA, orgB, namespace, request, sqlAsApp, close }`. Identities contain `{ userId, sessionId, confirmedEmail }`; organizations contain `{ id, agentId, locationId }`. `request(actor, orgId|null, method, path, body?, headers?)` exercises real route handlers through a loopback test server and real local auth cookies, returning `{ status, body, headers }`. It normally supplies valid CSRF/origin/idempotency headers; explicit supplied headers override them for negative tests. `sqlAsApp(actor, orgId, callback)` uses the constrained app role and transaction context. `close()` removes only fixture rows/users tracked by this harness and closes its pools/server. `tests/helpers/worker.ts` supplies `runUntilIdle({ namespace, failAt? })`, with failure points `after-enqueue` and `before-commit` enabled only under `NODE_ENV=test`.

Use fake fixture names and generated `.invalid` emails/passwords held in memory. Provision fixture identities through the local Auth admin API, then log in normally; administrative test credentials are never passed to app requests. Tests run serially against fixture org IDs in `jomcall-local`; never reset the developer's database. Each test run uses a random `test_<UUID>` execution namespace on its loopback test API, outbox rows and queue names; the normal engine consumes only namespace `local`. Namespace comes from validated server environment, never a request. Test worker helpers consume only their namespace, and cleanup deletes only its tracked fixture org IDs and queue records. No fixture command can enqueue work into the normal local queue. Migration replay uses a disposable database on the same local Postgres instance, described in Task 2. No production env support in the harness. The harness has a database-only stage for Task 2 (Auth identities plus direct bootstrap); add the HTTP server/request adapter in Task 3 and worker namespace adapter in Task 7, so early tests do not depend on unbuilt handlers.

## Task 1: Reproducible, guarded local runtime

**Files:** root workspace manifests/config; `infra/local/*`; `scripts/local/*.mjs`; `supabase/config.toml`; `.gitignore`; `web/package.json`, `web/next.config.ts`, `web/tsconfig.json`; `tests/local/guard.test.mjs`.

**Interfaces:** `checkLocal(environment)` returns structured port/disk/CLI/Docker findings or throws before mutations. In `guard.mjs`, export `validateCapacity({ freeGiB, needsPull })`, `validatePorts({ occupied })`, `validateBindings(bindings: string[])` and `stopArguments(projectId)` for the tests below; each validator throws a stable code on failure and otherwise returns void. `local:start`, `local:stop`, `local:check`, `dev:mock`, `dev:local`, `dev:engine`, `test:local` are root npm scripts. `services.json` fixes project/network/ports so every script uses one configuration.

- [ ] Write guard tests using injected process/filesystem adapters. Pin three failures and preservation:

```js
assert.throws(() => validateCapacity({ freeGiB: 9, needsPull: true }), /DISK_SPACE/);
assert.throws(() => validatePorts({ occupied: [54622] }), /PORT_IN_USE/);
assert.throws(() => validateBindings(['0.0.0.0:54621']), /NON_LOOPBACK/);
assert.deepEqual(stopArguments('jomcall-local'), ['stop', '--project-id', 'jomcall-local']);
```

- [ ] Run `node --test tests/local/guard.test.mjs`; confirm missing guard module fails before any Docker mutation.
- [ ] Add npm workspaces `web`, `engine`, `packages/*`; keep existing frontend versions from its lockfile. Add exact compatible dependencies and license inventory to `infra/local/README.md`; reconcile root lock and prove `npm ci` before removing `web/package-lock.json`. Preserve `npm --prefix web run build` and typecheck compatibility. Set `NEXT_TELEMETRY_DISABLED=1` in local scripts.
- [ ] Initialize CLI configuration using installed `supabase init --help`/`supabase init`, set `project_id`, named ports, local auth URLs/redirect allowlist, signup confirmation and local mail. Exclude `realtime,storage-api,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor`; retain Auth/Postgres/Kong/Mailpit/PostgREST unless an actual startup dependency requires a documented change. Do not copy config keys from newer CLI docs without validation.
- [ ] Implement startup ownership and disk gates, then create only this bridge and start only this project:

```sh
docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 jomcall-local
supabase start --network-id jomcall-local --exclude realtime,storage-api,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor
```

  Scripts call commands as argument arrays, capture/redact stdout/stderr, monitor free space during downloads, verify all actual container bindings and stop only newly started project containers on failure. Inspect reused network options instead of blindly recreating it. On normal stop retain volumes. Repeated start is idempotent. Never assume a container with a matching port belongs to this project.
- [ ] Generate `.env.local` files directly from captured CLI status using the version's documented output option; write mode 0600. Keep local migration/admin key access in tooling only, app DSN in web env, queue/worker DSNs and invitation encryption key in engine/server env. No `NEXT_PUBLIC_` database URL, admin key or secret. Commit only blank `.env.example` names and descriptions.
- [ ] Set `distDir` by validated server mode (`.next-mock`/`.next-local`), update generated-type includes and ignore paths. `dev:mock` binds 4181, `dev:local` binds 4182; do not interrupt the current preview until replacement build is ready. Do not change browser appearance in this task.
- [ ] Run guard tests, `local:check`, frontend typecheck/build. Record actual disk/image delta and bindings. Stop/start only this stack; verify volumes and unrelated container IDs remain. Commit `chore(local): add isolated backend development runtime`.

## Task 2: Tenant database and transaction boundary

**Files:** CLI-generated `core_tenants` migration; `supabase/auth-grants.sql`; `packages/db/src/{pool,context,errors,receipts}.ts`; `packages/db/src/repositories/workspace.ts`; common/workspace contracts; `tests/helpers/local.ts`, `tests/db/tenancy.test.ts`; `scripts/local/migration-check.mjs`.

**Interfaces:** implement `Database` above. SQL private helpers `app_private.active_role(user_id, session_id, org_id)` and `app_private.bootstrap_workspace(...)` use fixed search paths, verified active auth sessions and explicit grants. Receipt lookup is keyed by actor, tenant/bootstrap scope, command and idempotency key.

- [ ] Write isolation and pool reuse tests; construct two orgs through bootstrap, then use a max-size-one pool:

```ts
const h = await createHarness();
try {
  await h.sqlAsApp(h.alice, h.orgA.id, async tx => {
    const rows = await tx.query('select id from app.organization');
    assert.deepEqual(rows.rows.map(row => row.id), [h.orgA.id]);
  });
  await assert.rejects(h.sqlAsApp(h.bob, h.orgA.id, async () => 1), /NOT_FOUND/);
  await h.sqlAsApp(h.bob, h.orgB.id, async tx => {
    const rows = await tx.query('select id from app.organization');
    assert.deepEqual(rows.rows.map(row => row.id), [h.orgB.id]);
  });
} finally { await h.close(); }
```

  Add rollback-followed-by-other-user, forged session ID, bootstrap retry/different body, and direct cross-tenant foreign-key insertion cases. Assert app role cannot `SET ROLE` to migration/helper roles or access auth credentials.
- [ ] Run `npm run test:local -- tests/db/tenancy.test.ts`; expect missing schema/context failure.
- [ ] Create core org/member/location/agent skeleton, safe audit, receipts, private helpers and roles. SQL migration owner owns tables; `jomcall_app` has only required DML; authorization helper NOLOGIN role has only needed member and auth-session column SELECT grants. `app` is absent from exposed API schemas, and anon/authenticated/service_role have no direct table/function access. Add explicit INSERT WITH CHECK, UPDATE USING/WITH CHECK, SELECT and DELETE rules; apply `FORCE ROW LEVEL SECURITY` to tenant tables where helper ownership/grants permit it. Grant helpers only to intended runtime roles, revoke PUBLIC function/schema access.
- [ ] Implement transaction context with guaranteed release and rollback:

```ts
await tx.query('BEGIN');
await tx.query("select set_config('app.user_id', $1, true), set_config('app.session_id', $2, true), set_config('app.org_id', $3, true)",
  [identity.userId, identity.sessionId, orgId]);
// Resolve active_role, reject absent membership, then invoke the supplied callback.
// COMMIT on success; ROLLBACK on any exception; release in finally.
```

  Context settings are parameterized and transaction-local. Auth signature verification occurs before this interface. DB session/member checks still run here. Implement bootstrap as one locked, idempotent command inserting org, owner, primary location and initial agent; a signed-in person can never choose another initial owner. Give its function a separate NOLOGIN owner with only required INSERT/SELECT grants on these tables plus receipt/audit access; any BYPASSRLS belongs only to that isolated owner, not the app or read-only authorization helper. Revoke PUBLIC EXECUTE and allow only the verified server command path to call it. Do not give the read-only membership helper write access to make bootstrap pass.
- [ ] Create role passwords locally after migrations using parameter-safe tooling; never store passwords in `auth-grants.sql`. Enforce unique owner/primary invariants and composite tenant keys. Install pgvector without an embedding column or remote inference. Receipts retain resource references, not contact content; expired receipt cleanup cannot remove durable operation uniqueness.
- [ ] Add migration replay script requiring a randomly named `jomcall_migration_test_` database on `127.0.0.1:54622`. Restore **schema only** for required Supabase auth baseline from this project's DB; copy no auth/application rows. Apply application migrations from scratch, assert tables/policies/grants/indexes, drop only that exact generated scratch database in `finally`. Role definitions are cluster-level and must be idempotent. Refuse any different host/port/name. No `supabase db reset` against development.
- [ ] Run tenancy tests, migration replay and local database advisors; resolve RLS/security findings for app-owned objects and document upstream-only findings. Commit `feat(core): add tenant schema and scoped database access`.

## Task 3: Local authentication and HTTP command boundary

**Files:** auth/common contracts; `web/lib/server/{config,auth,csrf,api,services}.ts`; auth/business route dispatchers from file map; `tests/api/{auth,csrf,bootstrap}.test.ts`; extend test harness HTTP adapter.

**Interfaces:** `verifyIdentity(request): Promise<Identity>`, `requireMutation(request): Promise<void>`, `respond(result, status): Response`, `dispatchCore(request): Promise<Response>`. Auth actions are `csrf`, `signup`, `login`, `logout`, `confirm`, `forgot-password`, `recovery`, `reset-password`, `refresh`. Only csrf/verified link callbacks allow GET; normal mutations require POST. Business dispatcher resolves method/path from the contract registry, parses input, checks mode, verifies identity and invokes a named domain command.

- [ ] Write tests against real local Auth: signup requires confirmation, unconfirmed user cannot bootstrap, logout invalidates existing JWT for the next request, expired token refresh works once through the refresh endpoint, unknown email recovery returns the same public message. Confirm redirect `https://example.invalid` is rejected. Add forged Origin/CSRF and caching assertions:

```ts
const h = await createHarness();
try {
  const denied = await h.request(h.alice, h.orgA.id, 'PATCH', `/api/v1/organizations/${h.orgA.id}`,
    { name: 'Contoh Baru', businessType: 'other', expectedRevision: 1 },
    { Origin: 'https://example.invalid', 'X-CSRF-Token': '' });
  assert.equal(denied.status, 403);
  const session = await h.request(h.alice, null, 'GET', '/api/v1/session');
  assert.match(session.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(session.body.ok, true);
} finally { await h.close(); }
```

- [ ] Run `npm run test:local -- tests/api/auth.test.ts tests/api/csrf.test.ts tests/api/bootstrap.test.ts`; expect missing endpoints failure.
- [ ] Build server-only Supabase client factory with persistence/automatic background refresh disabled. Verify JWT claims cryptographically, load current user confirmation state/email into `Identity`, and require active `session_id` through the DB helper. Do not share mutable auth clients across requests. Store access/refresh tokens only in HttpOnly, SameSite=Lax, project-specific cookies; scope to `/`, Secure except configured loopback HTTP. Refresh only through an Origin/CSRF-protected route; rotate cookies and retry a failed app read at most once. Never cache authenticated pages/responses.
- [ ] Implement CSRF token bound to an HttpOnly session/anonymous challenge cookie, timing-safe comparison, exact allowed Origin and JSON content type. Reject missing Origin for browser mutations. Limit auth payloads to 16 KiB; use local auth rate limits plus per-process 10 requests/minute per action/IP for login/signup/recovery and a documented restart boundary. Return 429 with Retry-After. Generic error messages must not expose account existence.
- [ ] Configure local confirmation/recovery templates to token-hash callbacks; verify tokens server-side, consume them once, set cookies and redirect only to allowed local paths. These provider-verified GET callbacks are explicit exceptions to POST CSRF checks. Apply `Referrer-Policy: no-referrer`; redact query strings in access logs. Recovery verifies its own token type, updates password and revokes existing sessions; user then signs in again. Capture all email in local Mailpit; Google sign-in unavailable.
- [ ] Implement org list/create/bootstrap and organization update commands using `Database`; success means committed transaction. Enforce 401/403/404/409/422/429/503 mapping and request IDs. Unknown routes/methods do not dispatch arbitrary exports. Mock-mode process returns 503 `CAPABILITY_UNAVAILABLE` for real business endpoints without loading DB secrets. Local missing DB configuration fails explicitly.
- [ ] Run tests including actual Mailpit confirmation/recovery links, revoked auth sessions and unknown membership. Inspect client bundles for server imports/secret variable names and HTTP headers for token leakage. Commit `feat(auth): add local sessions and protected API commands`.

## Task 4: Membership, invitations and permission enforcement

**Files:** CLI-generated `members_invitations` migration; `packages/domain/src/{authorization,members}.ts`; `packages/db/src/repositories/members.ts`; workspace contract/dispatcher entries; `tests/api/members.test.ts`, `tests/db/membership.test.ts`.

**Interfaces:** named commands in contract table; `authorize(context, action, targetRole?)` enforces design §4 matrix. Invitations create transactional outbox events `invitation.deliver` containing only invitation/operation IDs. `encryptInvitationToken(token, key)` and `decryptInvitationToken(ciphertext, key)` live in server-only `packages/domain/src/invitation-crypto.ts`, use AES-256-GCM with random nonce, authenticated org/invitation IDs and explicit key version.

- [ ] Write tests for staff denial, admin inability to promote/remove admin/owner, owner non-removal, and revocation with an already-issued session:

```ts
const h = await createHarness();
try {
  const denied = await h.request(h.staff, h.orgA.id, 'POST', '/api/v1/invitations',
    { email: 'sample-teammate@example.invalid', role: 'admin' });
  assert.equal(denied.status, 403);
  const ownMembership = (await h.request(h.alice, h.orgA.id, 'GET', '/api/v1/members'))
    .body.data.find((member: { userId: string }) => member.userId === h.alice.userId);
  const ownerRemoval = await h.request(h.alice, h.orgA.id, 'POST', `/api/v1/members/${ownMembership.id}/revoke`,
    { expectedRevision: ownMembership.revision });
  assert.equal(ownerRemoval.status, 409);
} finally { await h.close(); }
```

  Also test mismatched verified email, expired/single-use invite, concurrent acceptance, revoked invite and identical idempotency-key replay after actor revocation. Fixture-only token generation supports deterministic acceptance tests; never add a public token-reveal endpoint.
- [ ] Run `npm run test:local -- tests/api/members.test.ts tests/db/membership.test.ts`; expect missing invitation commands failure.
- [ ] Add invitation/outbox tables, member revisions and grants. Persist server-controlled execution namespace on outbox rows; allow only `local` or test-prefixed namespaces in test processes. Serialize membership/role changes on the organization row and recheck actor/target under lock; deny removing/demoting owner. Admin manages staff only; owner may promote admin. Policies block direct SQL escalation and cross-org user substitution.
- [ ] Create 32-byte random invitation token; store hash plus short-lived encrypted delivery copy. Expiry seven days. Normalize email consistently with Auth's confirmed email. Acceptance locks invitation, checks email/org/expiry/revocation and inserts/reactivates only the permitted membership; role changes since invitation creation are revalidated against inviter's current authority. Lost inviter authority invalidates acceptance. Repeated acceptance by the same identity returns existing membership; another identity cannot reuse the token.
- [ ] Queue local invite delivery atomically with invitation; Task 7 supplies delivery. Revoke/accept/expire removes ciphertext. Explicit resend rotates token, resets delivery status, generates a new operation ID and invalidates the old link. Audit membership/invite actions with IDs and role transitions only, no email/token body. RLS checks active membership on every request, including receipt replay.
- [ ] Run API/SQL tests and two simultaneous admin/owner changes. Verify a revoked member cannot read bootstrap, mutate, or replay a previously successful command. Commit `feat(core): add workspace membership and local invitations`.

## Task 5: Branches, manual knowledge and immutable agent versions

**Files:** CLI-generated `agent_versions_schedules` migration; agent/workspace contracts; `packages/domain/src/{workspace,agents}.ts`; `packages/db/src/repositories/{workspace,agents}.ts`; `tests/api/agents.test.ts`, `tests/domain/schedules.test.ts`, `tests/db/versions.test.ts`.

**Interfaces:** branch/schedule/knowledge/version commands from contract table. Agent settings schema includes name, supported languages (`ms`, `en`, `zh`, with Manglish preference separate), greeting, persona/instructions, AI disclosure, recording disclosure, recording-enabled flag and stored voice preference; no inferred live voice capability. Publish returns snapshot plus monotonically increasing per-agent sequence. Restore copies snapshot into draft and advances draft revision; it does not change the published pointer until another publish.

- [ ] Write tests for concurrent stale saves, two publish attempts using one key, different publish keys against the same expected revision, immutable snapshots and malformed uploads:

```ts
const h = await createHarness();
try {
  const draft = (await h.request(h.alice, h.orgA.id, 'GET', `/api/v1/agents/${h.orgA.agentId}/draft`)).body.data;
  const key = crypto.randomUUID();
  const publish = () => h.request(h.alice, h.orgA.id, 'POST', `/api/v1/agents/${h.orgA.agentId}/publish`,
    { expectedRevision: draft.revision }, { 'Idempotency-Key': key });
  const [first, retry] = await Promise.all([publish(), publish()]);
  assert.equal(first.status, 201);
  assert.equal(retry.body.data.id, first.body.data.id);
  await assert.rejects(h.sqlAsApp(h.alice, h.orgA.id, tx =>
    tx.query('update app.agent_version set snapshot = $1 where id = $2', [{}, first.body.data.id])),
    /immutable|permission denied/i);
} finally { await h.close(); }
```

  Schedule cases: interval end before start, overlaps, impossible closure date, invalid zone, zero open days valid, two intervals/day valid, midnight closing represented as `24:00` end only. Split overnight hours across days; UI explains split. Prevent archive of primary/in-use location. Test UTF-8 byte limits using multi-byte BM/Chinese text, not character count.
- [ ] Run `npm run test:local -- tests/api/agents.test.ts tests/domain/schedules.test.ts tests/db/versions.test.ts`; expect missing version/schedule storage failure.
- [ ] Add schedules, knowledge and immutable versions with composite FKs and unique `(org_id, agent_id, sequence)`. Triggers reject UPDATE/DELETE of published versions for runtime roles. Knowledge writes lock agent row and advance agent revision, so publish includes a consistent knowledge set. Add checks preventing cross-agent version pointer assignment and nullable/unpublished initial state.
- [ ] Implement validated manual draft and knowledge commands. Use name 1–120 chars, notes/instructions bounded explicitly in schema, greeting/disclosure 1–2,000 chars, main instructions max 20,000 chars; knowledge max 100 items, 100,000 UTF-8 bytes/item, 1 MiB total. Text upload is JSON `{ filename, content }` for `.txt`/`.md`, body maximum 2 MiB, strict UTF-8 decoder with `fatal: true`, no NUL/binary. Treat markdown as literal text. No fetching URLs, PDFs, embeddings, model calls or browser-supplied completion flags. Disclosure is mandatory when publishing; recording disclosure required when recording is enabled.
- [ ] Implement revision updates and locked publish:

```sql
UPDATE app.agent SET draft = $1, revision = revision + 1, updated_at = now()
WHERE org_id = $2 AND id = $3 AND revision = $4
RETURNING id, revision;
```

  Zero rows after prior authorized lookup means 409. For publish, lock agent first, recheck revision, allocate sequence, insert full validated snapshot, update published pointer and agent revision, insert audit/receipt in the same transaction. Serialize knowledge changes on that same lock. Restore is a new draft transaction with audit; compare is a pure client diff between authorized fetched snapshots.
- [ ] Run tests, including direct SQL cross-org location/version references, staff draft/history denial and invalid disclosure. Confirm one failed knowledge write cannot leave a changed agent revision. Commit `feat(agent): persist branches knowledge and published versions`.

## Task 6: Contacts, notes, consent and audit queries

**Files:** CLI-generated `contacts_consent` migration; contact contracts; `packages/domain/src/contacts.ts`; `packages/db/src/repositories/contacts.ts`; `tests/api/contacts.test.ts`, `tests/db/contact-policy.test.ts`.

**Interfaces:** contacts commands from table. Contact profile returns current contact, paginated notes/consents and an explicit empty activity capability (no invented calls/bookings). Add read endpoints `GET /contacts/:id/notes` and `/consents` with the same cursor contract; initial profile embeds at most the first 25 of each. `listAudit` is owner/admin only. Register `listContactNotes` and `listContactConsents` in CommandMap with `{ contactId, cursor?, limit? }` inputs and `Page<ContactNote>`/`Page<ConsentRecord>` outputs.

- [ ] Write tests proving staff contact access but no export/delete, cross-tenant references denied, stale note update returns 409, and cursor/search scope validation:

```ts
const h = await createHarness();
try {
  const made = await h.request(h.alice, h.orgA.id, 'POST', '/api/v1/contacts',
    { name: 'Pelanggan Contoh', phone: null, preferredLanguage: 'ms' });
  assert.equal(made.status, 201);
  const hidden = await h.request(h.bob, h.orgB.id, 'GET', `/api/v1/contacts/${made.body.data.id}`);
  assert.equal(hidden.status, 404);
  const invalid = await h.request(h.alice, h.orgA.id, 'PATCH', `/api/v1/contacts/${made.body.data.id}`,
    { name: 'Pelanggan Contoh', phone: '01234', preferredLanguage: 'ms', expectedRevision: 1, role: 'owner' });
  assert.equal(invalid.status, 422);
} finally { await h.close(); }
```

  Add consent without evidence, DNC with an older grant, NULL phone, duplicate normalized phone warning, empty search, special SQL wildcard text and created_at ties across pages. Revoke a member between page fetches and require denial.
- [ ] Run `npm run test:local -- tests/api/contacts.test.ts tests/db/contact-policy.test.ts`; expect missing contact storage failure.
- [ ] Add contacts, notes and append-only consent rows with composite FKs, RLS, author attribution from verified identity and indexed org/date/id pagination. Use E.164 syntax `^\+[1-9][0-9]{1,14}$`; do not infer Malaysia for ambiguous numbers or claim syntax proves ownership. Store nullable phone. Warn on duplicates without silently merging people.
- [ ] Implement notes 1–5,000 chars, consent `channel=phone|whatsapp`, `purpose=service|marketing`, grant/revoke boolean, source/evidence strings with 1–2,000-char limits. DNC is independent and records reason/audit. Note/consent/DNC commands lock contact, reject pending deletion, check expected revision and advance revision atomically. Ordinary runtime roles cannot update/delete consent history; privacy deletion gets a separate narrow path in Task 7.
- [ ] Implement opaque validated cursors bound to tenant, search and sort. Order `(created_at DESC, id DESC)`, default 25/max100, strict search max200 chars; parameterized literal substring search escapes `%`, `_` and backslash. Reject malformed/mismatched cursor with 422. Audit uses safe event metadata and owner/admin-only RLS. Do not join in mock conversation history.
- [ ] Run API/SQL tests, idempotent note retry and over-limit payload tests. Confirm source text never becomes executable HTML and logs omit note/evidence content. Commit `feat(crm): add tenant contacts notes and consent`.

## Task 7: Durable local jobs, invitation mail and privacy

**Files:** CLI-generated `privacy_worker` migration; jobs contracts; `packages/domain/src/privacy.ts`; `packages/db/src/repositories/privacy.ts`; engine files from file map; `tests/helpers/worker.ts`, `tests/engine/{outbox,privacy,mail}.test.ts`.

**Interfaces:** public job commands from table. Internal `claimOutbox(batchSize)`, `markEnqueued(operationId)`, `processPrivacyJob(jobId)` and `deliverInvitation(invitationId, operationId)` are the only worker operations. SQL functions resolve tenant/resource from persisted rows. Engine queue role owns only `pgboss` schema; engine business role can execute only the reviewed work functions. It cannot mutate membership, publish agents or browse arbitrary contacts.

- [ ] Write crash/retry, expired export and deletion tests using the real local queue/database:

```ts
const h = await createHarness();
try {
  const contact = (await h.request(h.alice, h.orgA.id, 'POST', '/api/v1/contacts',
    { name: 'Contoh Privasi', phone: null, preferredLanguage: 'en' })).body.data;
  const job = (await h.request(h.alice, h.orgA.id, 'POST', `/api/v1/contacts/${contact.id}/deletion`,
    { expectedRevision: contact.revision })).body.data;
  await assert.rejects(runUntilIdle({ namespace: h.namespace, failAt: 'after-enqueue' }), /INJECTED_CRASH/);
  await runUntilIdle({ namespace: h.namespace });
  await runUntilIdle({ namespace: h.namespace });
  assert.equal((await h.request(h.alice, h.orgA.id, 'GET', `/api/v1/jobs/${job.id}`)).body.data.state, 'completed');
  assert.equal((await h.request(h.alice, h.orgA.id, 'GET', `/api/v1/contacts/${contact.id}`)).status, 404);
  assert.equal((await h.request(h.bob, h.orgB.id, 'GET', `/api/v1/jobs/${job.id}/download`)).status, 404);
} finally { await h.close(); }
```

  Add `before-commit` crash rollback, duplicate queue deliveries, poisoned payload org, worker unauthorized SQL, deletion while export pending, export after deletion, revoked downloader, audit count, invitation resend/old token invalidation and mail ciphertext purge. Add test that failed deletion keeps contact locked and retry resumes the same operation.
- [ ] Run `npm run test:local -- tests/engine/outbox.test.ts tests/engine/privacy.test.ts tests/engine/mail.test.ts`; expect missing queue/handlers failure.
- [ ] Add privacy job/outbox state, target UUID independent of nullable contact FK, unique logical operation IDs and safe retry errors. Request deletion locks contact, checks owner/admin/revision and sets pending deletion plus job/outbox atomically. Other contact mutations reject pending deletion with 409. Only a privileged, narrow deletion function can remove consent rows; ordinary app RLS/grants remain append-only.
- [ ] Start pg-boss with its own schema/credentials and bounded concurrency (two workers). Outbox dispatcher filters its server-controlled namespace and claims batches of 20 using `FOR UPDATE SKIP LOCKED` and a 30-second expiring lease, enqueues only operation/resource IDs, then marks delivered. Stable operation IDs plus handler state deduplicate; queue singleton facilities are an optimization, not correctness. Five total processing attempts with exponential delays 1/2/4/8 seconds, capped at 60 for manual retries; expose final failure and retry action. Release locks before waiting on network/queue calls. A worker crash expires leases, and a restarted engine resumes work without browser participation.
- [ ] Implement export preparation and download. Preparation stores an authorized manifest version and ready status, no exported PII blob. Download rechecks current owner/admin membership, job org, nondeleted target and 24-hour expiry; reads a consistent transaction snapshot of contact/notes/consent, includes `preparedAt` and `generatedAt`, records audit and returns `application/json` attachment with no-store. This is current data at download time, not historical job-request contents.
- [ ] Implement deletion in a single DB transaction: lock contact/job, remove notes/consents/contact, null contact FK while preserving minimal target UUID, invalidate export jobs, scrub any receipt references that could expose deleted content, mark completed, append minimized audit. Repeated job returns completed without new audit/effects. Keep requested job status until success; do not equate enqueue with deletion.
- [ ] Send invitation mail only through the discovered Mailpit SMTP endpoint on this project's local network/loopback port. Confirm actual CLI Mailpit SMTP mapping; do not assume UI port is SMTP or reuse another project's service. If a dedicated SMTP host port is needed, reserve/check `54625` and configure only this stack. Nodemailer rejects any non-loopback destination in local mode. Use stable operation-based Message-ID; Mailpit may receive a duplicate after an ambiguous SMTP acknowledgement, but it contains the same valid link, not a new membership. Purge encrypted token after delivery acknowledgement; cancellation/expiry makes deferred delivery a no-op. No external sender credentials.
- [ ] Run tests including process-level engine termination/restart and auth email/invite capture. Assert worker DSNs cannot publish agents/change roles and logs contain only IDs/status/error codes. Commit `feat(engine): add durable local mail and privacy jobs`.

## Task 8: Connect core screens without breaking mock preview

**Files:** `web/components/experience.tsx`; shared shell/view/controller files from file map; existing `product/{shell,access,setup,builder,contacts,branch-hours,settings,dashboard}.tsx`; `web/lib/core/*`; route server wrappers that pass mode; `web/app/{product,operations,crm,remaining}.css` only for existing-style states; `tests/domain/{transport,capabilities}.test.ts`.

**Interfaces:** `CoreClient` with `MockCoreClient({ storage, clock })` and `HttpCoreClient({ fetch, orgId })`; `WorkspaceChrome({ workspace, navigation, children, mode })`; `capabilitiesFor(mode)` returns boolean flags for coreRead/coreWrite/whatsappSend/voiceCall/calendarWrite/payments/outbound (core true in local, provider actions false); local controller owns response/query state and passes typed view models/commands to shared views. `mode` comes only from server config. Theme/language context remains independent of persistence.

- [ ] Write transport and capability tests before moving providers:

```ts
const mock = new MockCoreClient({ storage: memoryStorage, clock: fixedClock });
const local = new HttpCoreClient({ fetch: async () => { throw new Error('offline'); }, orgId: 'test-org' });
await mock.execute('listContacts', { limit: 25 });
await assert.rejects(local.execute('listContacts', { limit: 25 }), /offline/);
assert.equal(capabilitiesFor('local').whatsappSend, false);
assert.equal(parseMode(undefined), 'mock');
assert.throws(() => parseMode('production-ish'), /INVALID_MODE/);
```

  Define `memoryStorage` as an in-memory `Storage` adapter and `fixedClock` as an injected ISO timestamp in this test file. Define `parseMode` in server config and `capabilitiesFor` in contracts; test module cannot import server secrets. Verify local requests never read mock fixture storage even if keys are prefilled, and failed mutations preserve unsaved input.
- [ ] Run `npm run test:local -- tests/domain/transport.test.ts tests/domain/capabilities.test.ts`; expect missing transport boundary failure.
- [ ] Extract `WorkspaceChrome` from existing shell before changing behavior. Preserve navigation groups, links, selected state, desktop spacing, drawer keyboard focus and mobile touch targets. Existing mock `AppShell` adapts provider state to this shell; local shell uses bootstrap response. No duplicate CSS/theme system.
- [ ] Split `Experience` before any ProductProvider/CrmProvider mount. Mock branch retains existing provider order/store keys and every mock route. Local branch never imports/mounts fixture-backed controllers. Public routes keep presentation but route app/auth links to current process. Render server mode marker “Local workspace” versus “Sample data”; never expose DSNs/ports as product copy.
- [ ] Adapt supported core screens to shared form/view components and named commands. Mock controller translates these commands into existing store updates; local controller uses HTTP and awaits server acknowledgement. Local signup/login/recovery/invite use Task 3/4 endpoints; orgless user gets workspace creation. Settings includes explicit workspace switcher based on verified memberships; clear query state on switch and never reuse another tenant's cache.
- [ ] Wire local setup to manual organization/branch/knowledge/language settings only. Agent builder supports drafts, knowledge text, publish, compare and restore-to-draft. Contacts support server search/pagination, profile, edit/notes, consent/DNC and job progress/download/retry. Hours/settings support branches/schedules, members/invites and audit. Dashboard shows real setup state and contact count; unavailable channel metrics have explicit unavailable states. No sample contact timelines or fabricated usage.
- [ ] Gate unsupported routes and actions before components mount: test call, inbox, calls, bookings, integrations, phone numbers, WhatsApp, billing, outbound, hosted admin and self-host health. Navigation remains reachable and explains phase availability. Direct URL and direct API attempts get the same capability result. Agent publish says configuration published, not connected/live/tested. Existing mock versions of all these screens remain interactive.
- [ ] Implement loading/empty/error/401/403/409/503 states in BM/English. Preserve unsaved input on failures; 409 offers reload/review instead of silently overwriting. Refresh after successful commands, on window focus and visible-list polling every 15 seconds; cancel polling on hidden tab/unmount and scope cache by org/user. No Realtime service. Do not automatically retry mutations with new idempotency keys.
- [ ] Run transport tests, both mode builds/typechecks, and browser core journey on desktop/mobile/light/dark/BM/English. Seed mock localStorage, stop DB, confirm real mode errors and mock continues normally. Commit `feat(web): connect core screens to isolated local data mode`.

## Task 9: Whole-flow acceptance, operational proof and handover

**Files:** `docs/qa/2026-10-16-local-core-platform.md`, `infra/local/README.md`, `README.md`, `AGENTS.md` current-state section, generated `packages/contracts/openapi.json`, `tests/api/capabilities.test.ts`; affected files only if checks reveal failures.

**Interfaces:** root scripts `local:check`, `local:start`, `local:stop`, `db:migrate:local`, `db:verify-migrations`, `test:local`, `typecheck`, `build:mock`, `build:local`, `dev:mock`, `dev:local`, `dev:engine`. Every DB script hard-checks project/host/port and explicitly selects local mode; commands do not default to linked/remote databases.

- [ ] Add API capability regression test covering all disabled command families. Every local request for payments/sends/calls/external calendar writes returns 503 `CAPABILITY_UNAVAILABLE` without a provider request; mock mode denies all real-data commands. Run test and verify failure if a guard is removed.
- [ ] Run full local backend tests, migration replay/advisors, typecheck and both builds. Record exact commands, process exit codes and relevant results in QA report. Generate OpenAPI from shared registry/schemas and verify every registered route is represented. No passing assertion based only on HTTP 200; check persisted records and expected error boundaries.
- [ ] Complete browser journey with two isolated cookie contexts: signup → local confirmation → create organization → save branch/hours → add manual knowledge → publish → add contact/note/consent → refresh second signed-in context → observe same records. Create separate org in the second identity and prove guessed IDs, cursor reuse and job downloads cannot cross tenants. Invite staff through Mailpit, accept, verify restricted controls, revoke and require next request denial.
- [ ] Exercise recovery/reset, duplicate invite acceptance, concurrent draft edits/publish, version restore, DNC, export, deletion, failed-job retry and reload mid-job. Confirm audit contains safe events. Check mobile 390×844 and desktop 1440×900, both themes/languages; keyboard traversal, focus return, no overflow, working navigation. Reuse one controlled browser session and close only automation-owned tabs/processes afterward.
- [ ] Walk all fifteen mock navigation destinations and public auth routes with DB/engine stopped. Preserve existing localStorage state; don't reset user fixtures to make tests pass. Compare mock screenshots/behavior with baseline from before Task 8. Verify `?mode=local`, forged mode cookies and injected storage cannot change server mode.
- [ ] Verify external-request absence during local journeys by browser network capture plus instrumented server HTTP/provider adapters. Include Node/SMTP clients in capture; browser evidence alone is insufficient. Disable optional telemetry and external fonts/images if any runtime request remains. Cached package/image availability is separate from runtime independence. Do not claim an OS-level egress firewall exists.
- [ ] Prove persistence: create marker records, gracefully stop this project's engine/web/backend, restart same volumes, sign in again and read identical records and completed jobs. Compare unrelated Docker container IDs/status before/after. Inspect loopback bindings, env permissions, ignored secrets and disk delta. Logs/screenshots must redact email/token callback URLs and never include local keys.
- [ ] Write exact developer quick-start/stop/recovery commands, expected ports, local mail access, offline limitations, failed migration recovery, safe disposable-test cleanup and future provider enablement boundary. Update stale AGENTS current-state wording only after code exists; retain architectural rules and speech-spike boundary. Document which existing UI functions remain mock-only.
- [ ] Commit `test(core): verify local data flows and preserve mock preview`. End with a concise demo report: delivered behavior, tested evidence, any unresolved failures and explicit no-cloud/no-provider-spend status. Do not deploy or start the next milestone automatically.

## Required acceptance evidence

| Requirement | Owner task / evidence |
| --- | --- |
| Zero cloud setup, safe local lifecycle, disk/binding checks | 1/9 — process/port/container snapshots, download delta, no cloud credentials |
| Auth, confirmed identities, CSRF, revocation, cookie isolation | 3/4/9 — real local auth and negative endpoint tests, Mailpit flows |
| Tenant/role SQL and API isolation, pooled context cleanup | 2/4/6 — constrained-role tests plus two-identity browser proof |
| Concurrent publish, draft revision and immutable knowledge snapshot | 5 — two concurrent commands and direct SQL mutation denial |
| Contacts, notes, channel consent, DNC, privacy/audit | 6/7 — persisted state, export authorization, deletion crash recovery |
| Shared UI and explicit mock/local data boundary | 8/9 — same presentation, separate stores, DB-off mock proof, no fallback |
| No external integrations or misleading connected statuses | 8/9 — capability requests denied and network capture |
| Repeatable schema and preserved local state | 2/9 — clean scratch-database migrations and volume restart proof |

## Plan review notes

- Planning touched documentation only. No backend services, packages, migrations or cloud resources were created by writing this plan.
- Architecture build order remains intact: Phase 1 is core platform, with contact/privacy scaffolding needed to prove durable UI and jobs. Speech spike remains separate; live voice, calendar tools, WhatsApp and billing each need their own later plan.
- Hosting, DNS, managed Supabase, LiveKit Cloud, SIP numbers, Meta onboarding, Google OAuth and payment merchant setup are all deferred. Future defaults are choices to revisit when funding/provider access exists, not automatic next actions.
- Before execution, recheck git status and current docs. This plan was written against frontend branch `codex/frontend-directions`; preserve unrelated changes and the running mock preview. Do not treat the historical frontend-only AGENTS state as proof no new code exists by execution time.
