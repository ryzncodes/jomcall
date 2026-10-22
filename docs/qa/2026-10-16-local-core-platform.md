# Local Phase 1 acceptance — 2026-10-16

Implementation: `codex/frontend-directions`, starting at `63b5f91`. Local services only; no cloud resource, provider account, real phone number, external SMTP, OAuth client or payment setup was created.

## Delivered

The original mock experience remains at `http://127.0.0.1:4181`. The local app at `http://127.0.0.1:4182` uses confirmed Supabase Auth identities, constrained PostgreSQL roles, tenant APIs and durable jobs. Core views cover workspace/branch settings, schedules, agent drafts/knowledge/versions, contacts/notes/consent/DNC, membership/invitations, privacy jobs and audit. Unsupported channel routes show explicit availability boundaries before fixture controllers mount.

## Automated checks

| Command | Evidence |
| --- | --- |
| `npm run check:core` | Full API/SQL/domain/worker/guard suite; assertions inspect persisted records, error boundaries, job effects and transaction rollback. Exit 0; 31/31 tests passed (24.3 seconds). |
| `npm run db:verify-migrations` | Exit 0; all migrations replay in a disposable schema-only database; 15 forced-RLS application tables. Working database is not reset. |
| `supabase db advisors --local --type security --fail-on error` | Exit 0; no ERROR findings. Six WARN findings are upstream pg-boss security-invoker helper search paths. App helper search paths are fixed. Queue schema usage denied to app/worker/anon/authenticated. |
| `npm run typecheck` | Exit 0, web and root packages/tests. |
| `npm run build:mock`, `npm run build:local` | Exit 0; isolated build directories, both actual servers exercised. |
| `npm run contracts:generate` | Exit 0; 43 named commands plus auth/download produce 44 paths. Test checks every command and mutation header. Request schemas and response envelopes are generated; detailed response types remain in TypeScript. |

Backend coverage includes verified sessions, confirmation/recovery link single use, refresh and logout, CSRF/Origin checks, strict fields, owner/admin/staff permissions, immediate revocation, tenant FK/RLS isolation, pooled identity cleanup, revision conflicts, idempotent concurrent publishing, immutable versions, append-only consent, exact microsecond cursors, literal search, export expiry and role checks, deletion rollback/deduplication/retry, invitation token rotation and ciphertext purge. A child engine is killed, restarted and completes persisted work without a browser. HTTP/TCP instrumentation observes only loopback destinations, including local SMTP.

## Browser evidence

One automation-owned headless browser, separate cookie contexts for two synthetic identities. Existing user browser tabs and preview storage were untouched.

- Signup → local Mailpit confirmation → organization creation → branch details/hours/closure → agent settings/manual knowledge → publish → compare → restore-to-draft.
- Contact → internal note → WhatsApp service consent → independent do-not-contact reason → durable export → attachment download. A second signed-in context read the same persisted records.
- A separate identity created another workspace. Guessed contact IDs and a forged workspace header returned 404. Invite delivery/acceptance, staff-only controls, workspace switching across navigation and revocation were checked. After the revoke response completed, the next request returned 404. Cursor/export tenant boundaries also have direct SQL/API tests.
- Recovery email → new password → sign-in passed. Contact deletion was requested through its explicit confirmation form, survived navigation, completed in the engine and returned 404 afterward. Failed-job retry and rollback are covered by worker/API tests.
- Concurrent browser edits produced 409 with input intact. The initial “Reload latest values” behavior reused cached state; the regression was reproduced, fixed and rerun successfully. It now fetches the current record before replacing inputs.
- Backend and engine stopped: **52 mock route variants** passed (26 routes × desktop EN/light and mobile BM/dark), including all 15 app destinations and public/access/admin/self-host pages. Mock storage keys remained present. `?mode=local` did not change the server's mock mode.
- Local outage showed 503/service unavailable and preserved unsaved business input. Injected mock localStorage did not render. Restarting this project's volumes/web/engine preserved contact/note data, published configuration and completed export.
- **136 local route variants** passed (17 routes × 1440×900 and 390×844 × BM/EN × light/dark). No horizontal overflow, page exceptions or external browser requests during this audit. Forged mode cookies/query parameters did not change mode. Mobile drawer Escape and focus return passed.

Representative screenshots are local, ignored artifacts: `output/playwright/local-home-desktop.png`, `local-home-mobile.png`, `local-contacts-desktop.png`, `local-contacts-mobile.png`, `local-agent-history.png`, `local-hours-mobile-ms-dark.png`, `mock-before.png`, `mock-after.png`. Browser scripts and command output remain in the same ignored directory. Screenshots contain only explicitly synthetic QA records.

## Operational boundaries

Five project containers publish only to 127.0.0.1. Before/after comparison preserved all 13 unrelated running container IDs/names. Ordinary stop/start preserved volumes. The implementation's disk snapshots remained above the 10-GiB startup threshold (about 38 GiB free near completion). Root/web env files are ignored and mode 0600; administrative DSNs/service keys never enter web env. Static client bundles and tracked files are scanned for actual local secret values before handover.

Browser and Node network observations cover this phase's exercised paths, not an OS-level egress firewall or a guarantee about arbitrary future code. Package/image downloads are separate from runtime independence. No real voice, WhatsApp, calendar or payment integration was exercised.

## Implementation decisions

1. Reused the existing feature checkout to preserve the active preview; separate build directories protect each mode. Cost: work shares a checkout, so no parallel implementers were used.
2. Docker Desktop ignored the bridge default binding. A process-scoped Unix Docker proxy forces loopback bindings for this project's create requests and verifies actual ports. Cost: pinned CLI/Docker compatibility needs maintenance.
3. Supabase owns the Auth schema. Local bootstrap applies narrow session/user-column grants through this project's internal administrator; web env never receives that credential. Cost: future Auth schema ownership changes need review.
4. Preserved mature mock controllers and legacy sample IDs. Shared chrome/fields serve both modes; local controllers use typed HTTP commands. Cost: legacy mock controller normalization remains a future refactor.
5. Kept pg-boss upstream security-invoker functions despite six advisory warnings because its schema is private. Cost: future queue grants or upgrades require renewed review.

Physical-device Safari/Android/iPhone testing and live integrations remain outside this local milestone. Production internet deployment requires separate security, operational and provider work.

## Final independent review

A fresh reviewer inspected `63b5f91..25f8dc9` and independently ran the original 28-test suite. Three important findings were reproduced with failing tests and fixed in one pass:

- Lost mutation responses: the mounted workspace HTTP client retains the operation key for the exact unresolved command/payload. Explicit retries replay the committed result; acknowledged later commands receive new keys. A real-API regression and browser response-abort exercise both confirmed one contact after retry.
- Exhausted claimed jobs: bounded, namespace-scoped reconciliation checks the latest delivered operation against queue state. Failed, cancelled or no-longer-retained queue jobs become recoverable domain failures. A stale terminal operation cannot fail a newer retry. A test drives pg-boss's actual timeout transition through all five attempts, then retries the same deletion and verifies one deletion audit event.
- Malformed text imports: fatal UTF-8 decoding rejects invalid bytes before changing the form. Browser checks preserved the previous title/content and successfully imported valid BM/Chinese/accented text.

All three tests failed on the original behavior and passed after the changes; the complete suite then passed 31/31. Both builds, type checks, scratch migration replay and security advisors passed again under the qualifications above. The local engine and both web servers were restarted on the final code.

Review scope rulings, in review order: legacy mock conversion stays deferred (cost: duplicate controller maintenance); real voice/WhatsApp/calendar/payment/admin behavior stays gated (cost: provider behavior remains unproven); public hosting stays excluded (cost: separate security/operations work); isolated upstream queue warnings remain accepted (cost: review future grants/upgrades).

Deferred minor findings: duplicate-phone warnings are not shown in the local UI and updates do not calculate them; version comparison does not yet show language/Manglish/recording-enabled or draft-knowledge differences.

Cleanup removed only six known synthetic Auth users, their five workspaces, and thirteen abandoned test queues. The ordinary queue, database volumes, unrelated containers, user browser and mock preview were preserved. Both automation-owned browser sessions were closed.
