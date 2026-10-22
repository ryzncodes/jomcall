# Local backend runtime

No cloud account is needed. Initial npm/image downloads use the internet; application services run locally. Supabase CLI is pinned to 2.98.2. Start with `npm ci`, `npm run local:check`, then `npm run local:start`. Use `npm run local:stop` to preserve database volumes. Never use broad volume pruning or reset a project to fix startup.

| Process           | Address                |
| ----------------- | ---------------------- |
| Mock preview      | http://127.0.0.1:4181  |
| Local application | http://127.0.0.1:4182  |
| Auth/API          | http://127.0.0.1:54621 |
| Postgres          | 127.0.0.1:54622        |
| Captured email    | http://127.0.0.1:54624 |
| Local SMTP        | 127.0.0.1:54625        |

Startup checks free disk (10 GiB before preparation, abort below 5 GiB), project ownership and port conflicts. A process-scoped Unix socket adapter supplies explicit loopback HostIp values to this project's Docker create requests: Docker Desktop did not honor the bridge default binding with the pinned CLI. It rejects creation for other project labels, holds requests in memory, and is removed after startup. Actual published bindings are verified before declaring readiness.

Only five services are used: Postgres, Auth, gateway, PostgREST and Mailpit. No Realtime, Storage, Studio, analytics or media service. CLI output is withheld because it contains local keys. `.env.local` and `web/.env.local` are mode 0600 and ignored; administrative credentials are never copied to web env. A failed startup stops newly created project services, never other projects.

Frontend dependencies retain installed versions. New runtime dependencies are MIT (`pg`, `pg-boss`, Supabase JS, Zod, server-only); Nodemailer uses MIT-0. `tsx` is MIT, TypeScript Apache-2.0. Exact versions and transitive licenses are captured by the lockfile and validated on install. No service keys belong in `NEXT_PUBLIC_` variables.

## Data, authorization and jobs

Run `npm run db:migrate:local` after startup and after pulling a new migration. This applies CLI-generated migrations and the narrow Auth-schema grants from `supabase/auth-grants.sql`, then configures randomly generated local role passwords. The web process receives only the anonymous Auth key and constrained app DSN. Administrative credentials stay in root `.env.local`; the worker uses separate business/queue DSNs. Keep both env files private.

All tenant tables use forced RLS. Verified Auth sessions become transaction-local identity; each command rechecks current membership. Browser workspace selection is untrusted input. Membership/owner rules, revision conflicts, idempotency receipts and audit writes are enforced server-side. API request schemas and named command types live in `packages/contracts/src/core.ts`. `npm run contracts:generate` produces OpenAPI request definitions and the response envelope; detailed response types remain in TypeScript.

The `pgboss` schema belongs only to the queue role. The business worker can execute narrow functions for persisted outbox/privacy operations; it cannot browse arbitrary contacts, change membership or publish agents. Outbox claims have 30-second leases. Queue delivery is at least once; state transitions deduplicate effects. Five total attempts use exponential backoff with jitter (starting around 1–2 seconds), capped at 60 seconds. A bounded reconciliation pass compares the latest delivered operation with its queue state. Exhausted, cancelled or missing queue records become explicit failures even if a process died before recording the failure; stale operations cannot fail a newer retry. A failed deletion keeps the contact locked and offers explicit retry. Repeated export preparation/deletion is safe. SMTP can duplicate the same invitation after an ambiguous acknowledgment; it never creates a new membership. Resending rotates the token, and acknowledged/revoked/expired ciphertext is cleared.

Exports store a manifest, not a PII blob. Downloads fetch current records under a contact lock, recheck manager access and 24-hour expiry, and return a no-store attachment. Deletion removes contact details, notes and consent, invalidates exports and retains minimal job/audit identifiers. Command receipts contain only IDs; replay cannot recover deleted contact content.

## Failure and recovery

- **Port or disk check fails:** resolve the named conflict or free known disposable storage, then rerun `local:check`. Do not stop unrelated projects or remove database volumes.
- **Database/auth is stopped:** local forms report service unavailable and preserve edits. Restart with `local:start`, apply migrations, then retry. Mock preview remains independent.
- **Engine is stopped:** jobs remain pending. Start `dev:engine`; no browser is needed to resume them.
- **Migration fails:** leave existing volumes intact. Read the safe error, fix an unapplied migration or add a forward migration for an applied one, then rerun `db:migrate:local`. Use `db:verify-migrations` for clean replay; never use `supabase db reset` on your working database.
- **Save response lost:** retry the unchanged form in the same workspace view. Its unresolved operation key is retained, so a committed command replays without creating another record. After navigation/reload, inspect existing records before recreating them.
- **Edit conflict:** unsaved fields remain visible. Use “Reload latest values” to explicitly discard them and fetch the latest revision, then review before saving again.
- **Session expires/revokes:** sign in again. Current membership is checked on the next request. Password reset signs out existing sessions.
- **Test cleanup:** normal tests remove only their generated organizations, Auth users and `core_test_<uuid>` queue. Interrupted fixtures may remain; inspect their exact IDs before removing them. Never clear the ordinary `core_local` queue or reset all data as cleanup.

Data lives in this Docker project's volumes; there is no application object-storage service. Stop retains those volumes. Back up before any future destructive reset. Disk growth comes from local database/WAL, retained queue jobs, mail and build caches. Browser/engine logs emit safe status/error codes; callback/invitation URLs are excluded from development request logs.

## Current limits

Auth rate limits are per action/process and shared by loopback callers. Cookie sessions use SameSite=Lax and HttpOnly; Secure is off for loopback HTTP. This is not a production internet deployment configuration. Network checks observe browser requests and Node HTTP/TCP destinations; no OS-level egress firewall is installed.

The Supabase security advisor reports six mutable-search-path warnings for upstream pg-boss **security-invoker** helpers. Its schema has no usage grant to app, anon or authenticated roles. App security-definer functions have fixed empty search paths. We retain upstream queue helpers rather than patch vendor SQL; reassess grants/functions when upgrading pg-boss.

Mock controllers retain their existing browser storage and sample IDs. Shared shell and form primitives serve both modes; local controllers use the named HTTP client. Full migration of legacy mock controllers to the common command interface remains future refactoring.

Future integrations require a separate implementation plan and explicit provider setup. Do not add cloud credentials, real phone numbers, external SMTP, payment keys, OAuth clients or hosted resources to make a local test pass.

## Optional local text model

Phase 2 uses one project-owned native Ollama runtime and model cache. Preparation is explicit and requires internet for official runtime/weight downloads, at least 10 GiB free disk and no paid account:

```sh
npm run model:prepare -- --download
npm run model:start
# Set JOMCALL_MODEL_PROVIDER=ollama for local web/agent processes only.
npm run model:stop
```

The committed lock is installation input, including on a fresh checkout. Preparation verifies the current registry manifest against that digest before downloading; a moved tag fails with `MODEL_LOCK_MISMATCH` and never silently repins it. Re-preparation reinstalls the pinned runtime, reuses matching cached weights, and stops only the recorded project runtime before extraction. The lock remains unchanged.

Ordinary startup never installs or pulls a model. Default provider is disabled. Runtime version, archive checksum and full model digest live in `infra/local/model-lock.json`; changed versions/digests fail readiness. Project artifacts stay under ignored `.local/`; native Ollama may create its standard per-user identity files in the existing home directory. Those files are not read, copied or removed by this project.

Runtime binds numeric loopback, disables cloud features and uses one model/request at a time. Start, readiness and inference verify the recorded PID, exact project executable and sole listener on port 11434. Stop never stops another installation. Run lifecycle/worker commands from the repository root; Next runs from `web/`. No new Docker service is required. Model outage does not disable staff bookings or the 4181 mock preview. Structured model output is untrusted and parsed against the same tool schemas as server execution.

## Local bookings and text tests

Create a branch schedule under Branch hours, then add a resource under Bookings. Each resource has capacity one and a 15–240-minute duration. Requests do not reserve a slot. Review and confirm separately; current hours and confirmed occupancy are rechecked under database locks. Failed rescheduling preserves the original slot. Only Kuala Lumpur scheduling is supported. External calendars remain disconnected.

Text testing is owner/admin only. Start a draft or published snapshot under Agent → Test. Knowledge remains frozen for that saved test. Questions run through `npm run dev:agent`; privacy/mail continue independently through `dev:engine`. Tests last 24 hours, allow 20 turns, and never call customers or send messages. A booking tool creates a test proposal; explicit review creates a request, followed by separate staff confirmation. Deleting a linked contact removes its test transcripts, proposals and bookings.

Set `JOMCALL_MODEL_PROVIDER=ollama` in root `.env.local` and `web/.env.local`, then restart local web/agent processes. The root-only `AGENT_DATABASE_URL` is installed by migration setup and must never enter the browser or web env. Native Ollama defaults to disabled; no cloud fallback exists. Model readiness verifies runtime/digest, not answer quality. Current candidate remains experimental until all multilingual gates pass; inspect [evaluation](../../docs/qa/2026-10-16-local-agent-booking.md).

The agent has its own queue and constrained SQL entry points. It holds no transaction during inference. Limits: 3 model calls, 4 tool steps, 60 seconds per turn, 20 seconds per call, 6,000 serialized input/schema bytes, 512 output tokens. Required policy and current question are never truncated. Up to six prior completed exchanges from the same authorized session are considered in chronological order. Whole recent pairs fit within the remaining byte budget; older history and optional evidence are omitted when needed. Prior dialogue is context, not evidence or proof of an action. Failed/cancelled turns cannot apply proposals. Interrupted work needs explicit retry with a new attempt generation.

Stop `dev:agent` before `local:stop`; restart after `local:start` and `db:migrate:local`. `model:stop` preserves downloaded weights and only stops the owned process. Model/runtime cache currently totals about 2.8 GiB, separate from databases/builds. A model process may use considerably more memory than its disk artifact; measured figures are in the QA report.
