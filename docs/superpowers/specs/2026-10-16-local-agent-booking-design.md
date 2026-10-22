# Phase 2: local agent tools, text testing and bookings

Date: 2026-10-16. Status: proposed for owner review, not implemented. Planning requested after Phase 1 commit `b4496e6`; local-only and no paid services remain binding. Product codename stays `JomCall` until the owner selects a brand.

## 1. Intent and relationship to the original spec

Help a Malaysian SME owner answer an enquiry from their own business knowledge, inspect what the agent proposes, and manage an appointment in a durable calendar. Prove these actions before connecting a telephone or WhatsApp account.

This is backend roadmap milestone 2, **agent tools and booking**, a preparation slice for architecture §9 sub-project 3. It is not the second item in the architecture's original numbered list (that item is the core platform already built). It deliberately narrows the roadmap's online ingestion and Google authorization requirements to match the owner's current budget and local-only instruction.

End-to-end demo: configure a local booking resource → publish business knowledge → run a text test against a pinned version → inspect cited answers/tool proposals → explicitly apply a proposed booking request to a selected contact → staff confirms it → another signed-in browser sees the same booking. Two staff cannot confirm overlapping appointments for the same resource. Closing a test tab does not lose its run.

## 2. Verified starting point

At `b4496e6`, the repository has local Supabase Auth/Postgres, tenant transactions/RLS, immutable agent snapshots, manual FAQ/text knowledge, branch hours/closures, contacts/notes/consent/DNC, local Mailpit, durable privacy/mail jobs and an independent mock app. Phase 1's report records 31 passing tests and its browser/operational evidence; those results are historical evidence, not a test run performed during this planning turn.

Relevant boundaries inspected:

- `packages/contracts/src/core.ts`: typed command registry; local voice/calendar/payment/WhatsApp capabilities remain false.
- `web/lib/server/api.ts`: explicitly rejects booking and channel route families before domain dispatch. Enabling bookings requires changing this gate, not only adding a page.
- `packages/domain/src/agents.ts`: published snapshots contain knowledge content but no stable knowledge item IDs. References must use snapshot hash/document ordinal, not assume IDs exist.
- `packages/domain/src/workspace.ts`: schedule writers lock the location row. New booking operations must share that lock to prevent schedule/booking races.
- `engine/src/engine.ts`: privacy/mail queue consumes generic outbox claims; new agent work must have disjoint claims and a separate execution loop so model inference cannot delay privacy work.
- `web/lib/core/client.ts`: unresolved mutation keys survive retries in the mounted client; navigation/reload currently discards that memory. Durable test turns/proposals need persistent operation identities at the server as well.
- `web/lib/api/crm.ts`, `web/components/product/bookings.tsx`, `test-panel.tsx`: mature mock UI, but browser state/simulated replies are not backend logic to reuse.

Host observation: 24 GiB RAM, about 49.5 GiB available filesystem space; no `ollama` executable on PATH and nothing listening on 127.0.0.1:11434. Recheck before implementation. No runtime or model was installed while planning.

## 3. Options and selected proposal

| Option | Benefit | Cost / decision |
| --- | --- | --- |
| Local booking core plus optional local text inference | Useful persisted workflow now; no provider account or per-call fee | Recommended; local model quality and memory use require measurement |
| Booking/tools only, defer all inference | Smallest download and operational footprint | Deliver this first as a usable checkpoint; do not present scripted test replies as AI |
| Connect Google and hosted models using free tiers | More representative external integration | Deferred: depends on online accounts, quotas and possible later charges |

The first checkpoint works without a model. The full text-agent checkpoint uses an explicitly prepared local model. An unavailable model produces a clear unavailable state; no fixture or cloud fallback. No model download occurs during ordinary startup or an API request.

## 4. Scope

Included:

- Local booking resources, availability, requests, explicit staff confirmation, reschedule/cancel and contact booking history.
- Search over existing manual FAQ/service/text knowledge; source references and immutable session snapshots.
- Durable manager-only text-test sessions, bounded tool execution, citations, proposals, cancellation/retry and expiry.
- Local Ollama adapter, optional preparation/start/stop commands, one small model and multilingual evaluation.
- Privacy export/deletion extended before any new contact-linked record is exposed.
- Existing design and navigation, BM/EN, mobile/desktop, light/dark, precise loading/error/conflict states.

Deferred: website/Google Business fetching, PDF ingestion, embeddings, Google/Cal.com OAuth and calendar synchronization, speech/STT/TTS/LiveKit/SIP, recording, WhatsApp inbox/calling, external notifications, payments, outbound automation and public deployment. No automatic holiday import. Existing manual closures remain authoritative.

Google Calendar remains the first future external calendar connector. A local appointment must never be labeled Google-synced. Free-form model output must never change booking status, consent, DNC, permissions, prices or delivery states.

## 5. Local runtime and cost envelope

Keep `JOMCALL_MODE=mock|local` server-selected, 4181 mock / 4182 local, separate build directories, existing five project containers and their volumes. No new container is required. Use the installed PostgreSQL/pg-boss and native host Node processes.

Proposed inference runtime: native Ollama, explicitly bound to `127.0.0.1:11434`, cloud features disabled. Use a project-owned model directory `.local/models/` (ignored), not a broad scan or purge of the user's model store. Start only an owned process, check port ownership, and stop only its recorded PID. Do not alter global launch agents or another Ollama installation.

Candidate: `qwen3:4b`, currently listed as Q4_K_M, about 2.5 GB, Apache-2.0. It is a development candidate, not a validated Malaysian-language or speech provider. At preparation time record the full model digest, runtime version, artifact provenance/license and actual size; fail if they differ from the recorded lock on later starts. No implicit model upgrade or second model download.

Preparation requires at least 10 GiB free and checks the selected artifact before download; stop further downloading below 5 GiB. Reject a model artifact above a 4-GiB planning budget unless the owner changes that budget. Report binary/model/cache bytes separately; do not describe model-file size as total RAM usage. Use one loaded model, one inference at a time, 8192-token context, at most 512 generated tokens per call, `think:false` when supported and short keep-alive. Measure actual RSS/memory pressure and throughput on this machine. On failure, leave booking and manual knowledge features usable.

Only a preparation command may access official package/model distribution hosts. Runtime model adapter accepts exactly the configured numeric loopback URL, no credentials, proxy, redirect, remote model name or arbitrary endpoint. The browser never talks directly to Ollama. Cloud features stay disabled even if the runtime supports them. No Vercel deployment/account/domain operation is part of this backend plan.

## 6. Booking model and authority

Add `booking_resource` and `booking`; every row has `org_id`, composite tenant FKs, forced RLS and revision checks. A resource belongs to one branch, has a name, fixed appointment duration (15–240 minutes, multiple of 15), active flag and capacity exactly one. Multiple staff/chairs/rooms use separate named resources. No resource is silently created from opening hours. Resource administration is owner/admin only; active staff may read availability and create/manage bookings within their tenant.

A booking has contact/resource/location references, title (1–120), UTC start/end instants, schedule time-zone snapshot, status `requested|confirmed|cancelled`, source `staff|reviewed_test`, creator and revision. Server derives duration/end/location from the resource. Browser cannot choose tenant, creator, provider state, end time or source. No external provider ID exists in this phase.

Availability uses the saved schedule, manual closures, resource duration and confirmed bookings. Support `Asia/Kuala_Lumpur` initially; other valid Phase 1 schedule zones remain stored but return `BOOKING_TIMEZONE_UNSUPPORTED` for booking setup until deliberately supported. Start grid is 15 minutes, lead time 15 minutes, maximum horizon 90 days; reads cover at most seven calendar days and return up to 50 slots with a cursor. Windows are half-open `[start,end)`; adjacent appointments are legal. A missing schedule or inactive resource yields no bookable slots, never fabricated availability. Date/time display follows the branch, never the browser's time zone.

Requests do not reserve capacity. They must reference a valid open-hours slot, but another request or confirmed appointment can compete for it; the UI says “Awaiting staff confirmation.” Confirmation rechecks current contact, resource, hours/closures and overlap in one transaction. A confirmed booking means recorded in the local calendar only. The resource row serializes our writers, and a PostgreSQL exclusion constraint over `(org_id, resource_id, tstzrange(start_at,end_at,'[)')) WHERE status='confirmed'` is the final overlap guard. Install `btree_gist` through a CLI-generated migration.

Rescheduling a confirmed booking is atomic: conflict leaves the old booking intact. Cancellation releases its range. Resource archival and branch/time-zone changes reject outstanding future bookings. Schedule edits that invalidate future confirmed bookings return `BOOKINGS_AFFECTED` with authorized IDs; resolve those appointments before saving. Duration changes affect only new requests; existing booking start/end remain intact. Consistent lock order for operations that need multiple records: contact → session/proposal → location → resource → booking. Location locks coordinate with existing schedule writes. All references are checked again after locks.

DNC prevents outreach, not staff management of a customer-requested appointment. This phase never sends a confirmation message or modifies consent as a side effect of booking.

## 7. Knowledge and sessions

Retain current upload validation and limits: `.txt`/`.md`, strict UTF-8, 100 items, 100,000 UTF-8 bytes per item, total 1 MiB per agent. No URL fetch, external parser, embedding model or vector index.

`test_session` stores agent/location, optional contact, creator and verified Auth session ID, frozen settings/knowledge snapshot and hash, source (`published` with version ID, or `draft` with expected revision), state, revision, model digest and expiry. Draft snapshot creation locks the agent and copies current knowledge in the same transaction. Publishing or editing later never changes an existing test. Both draft and published tests are owner/admin only for this milestone; no new draft access for staff. The first submitted turn pins the configured model digest; later submit/retry rejects a changed digest with `MODEL_CHANGED` and requires a new session. Model-free knowledge inspection does not pin a digest.

`test_turn` stores user input, bounded response/citations, state (`queued|running|completed|failed|cancelled`), stable operation ID, attempt generation, lease and safe error code. `test_tool_step` records validated input/result references and ordinal; `test_proposal` stores structured action details and later application reference. All have tenant/session composite references. One active turn per session, enforced by a partial unique index. Each session allows at most 20 user turns, each 4,000 UTF-8 bytes; at most 20 unexpired sessions per org. Snapshot plus transcript payload has a 2-MiB limit per session. Session expiry is 24 hours; reads deny expired content immediately and maintenance removes it in bounded batches. Managers can delete a test immediately.

Lexical search is deterministic over the frozen snapshot: Unicode NFKC/case normalization, word tokens plus Han character bigrams, bounded chunks of 1,200 code points with up to 120 overlap, top five results and at most 6,000 code points total. Stable source IDs combine snapshot hash, document ordinal and chunk ordinal. Use matched terms/phrases and explicit score ordering, not guessed semantic similarity. No-match returns an empty result and the agent asks for clarification or proposes staff handoff. Model citations must be a subset of retrieved sources; HTML is rendered as text. Retrieval quality is measured separately from model response quality.

## 8. Tools and safe testing

Model is an untrusted planner. Its structured output is strictly parsed into the following allowlist; context/tenant/session/contact/actor/version and write identity are server-owned. No SQL, shell, URL-fetch, dynamic tool registration, schema changes or generic HTTP tool.

| Tool | Local test behavior |
| --- | --- |
| `search_knowledge(query)` | Read only from this session's frozen snapshot; return cited excerpts |
| `check_availability(resourceId, fromDate, days)` | Tenant/location-bound slots only; no customer names or other bookings' details |
| `book_slot(resourceId, startAt, title)` | Save a **test proposal**, not a real booking |
| `take_message(text)` | Save a test message proposal; no outgoing delivery |
| `handoff_to_human(reason)` | Save a visible handoff proposal; no phone transfer or external notification |
| `update_contact`, `request_call`, `transfer_call` | Unavailable in Phase 2; validated capability error, no simulation of success |

Tools run only for the resource scope chosen in the session. Read results expire with the session; availability is advisory until a real command rechecks it. Tool outputs and knowledge are quoted data, never system instructions. Maximum four validated tool steps and three model calls in one turn; wall-clock deadline 60 seconds, each inference capped at 20 seconds with cancellation and 256-KiB response limit. Budget exhaustion ends with a visible failure/fallback, not a pretend completed action. Pack the serialized message/schema content to at most 6,000 UTF-8 bytes with room reserved for protocol tokens/output. Never truncate governing instructions or the latest user message: reject oversized required content with `INPUT_BUDGET_EXCEEDED`; fit optional older turns and cited excerpts afterward. Record actual prompt token usage and reject overflow/truncation rather than presenting it as a complete test.

A manager may click “Create booking request” on a proposal, select an existing non-deleting contact and review exact time/resource/title. That authenticated command calls the ordinary booking-request domain service and atomically records `applied_booking_id` on the proposal. A persistent unique proposal-application constraint prevents duplicates even after client reload or a new idempotency key. Applying binds an anonymous session to that selected contact atomically; a session already bound to a contact can only apply proposals to that same contact. A separate explicit staff confirmation changes the real booking to confirmed. A test never silently mutates CRM records. Taking a message/handoff remains a test artifact; staff can use the normal contact-note command separately.

UI copy always identifies a text test and an unapplied proposal. Only authoritative structured tool results drive status cards; arbitrary generated prose cannot set success/status badges. A business answer can still be wrong: measured evaluation, visible citations and human review remain necessary.

## 9. Worker, permissions and recovery

Use a separate host command `dev:agent` and queue `agent_<namespace>` with one active model task, leaving `dev:engine` privacy/mail responsive. Runtime namespace stays `local`; tests use `test_<uuid>`. New `agent.turn` outbox events must be excluded from existing core claims; the agent worker claims only that kind. Both enqueue and terminal reconciliation are scoped to the latest operation generation.

New constrained worker login executes only reviewed functions that resolve stored turn/session identity. It cannot browse arbitrary contacts, confirm bookings, publish agents or change membership. A NOLOGIN function owner has minimum required table/auth-helper grants, fixed empty search paths, PUBLIC execution revoked. Use fresh authorization checks at claim, before each tool step and at commit: original creator remains an active manager, original Auth session remains valid, test is unexpired/uncancelled and any linked contact is not being deleted. Payload IDs alone never authorize work.

No database transaction or pooled connection is held during inference. Claim returns an immutable execution envelope and lease generation; prepare/record tool steps and finalize use short transactions and compare that generation. Worker heartbeat/lease checks and an at-most-90-second queue expiry surround the 60-second turn deadline. A cancel/delete/revoke invalidates the generation, so a late model response cannot reappear.

Persist user turn and outbox atomically before acknowledgement. Stable operation IDs deduplicate enqueue. For this development tester use no automatic whole-turn model replay after uncertain execution: an interrupted/exhausted attempt becomes `failed`, exposing explicit retry of the same turn with a new attempt generation. Retry removes/replaces only unapplied artifacts from the failed generation; accepted real bookings remain linked and cannot be applied twice. Outbox enqueue failures retry safely. Terminal queue failure, missing retained queue record and worker crash are reconciled into a visible state; no permanent “thinking” spinner.

Polling: every two seconds while a turn runs, otherwise existing 15-second/focus refresh. No SSE service in this phase. Resume from persisted turn sequence; browser refresh is not a new request. On API or model outage, retain unsent input, show the actual error, and never read mock storage.

## 10. Privacy and operational safety

Extend contact export to include its bookings and contact-linked test sessions/turns/proposals. Anonymous tests are not attributed by guessed phone/name; they expire after 24 hours and can be deleted explicitly. Do not automatically copy customer notes/consents into prompts. Typed test text may contain personal data, so log only IDs/codes/timing, never prompts, model outputs or customer details.

Contact deletion must cancel/invalidate linked work, delete its sessions/tool traces/proposals and bookings, then remove existing notes/consent/contact in one transaction. Because applying a proposal binds the session to its contact, deletion removes its original transcript as well as the applied proposal; no anonymous copy of that linked run is retained. The worker checks generation/contact state at commit; delayed work cannot recreate erased data. Export after deletion is unavailable. Include these changes before enabling new writes in the UI. Model context is request-local with short keep-alive; no conversation files or prompt caches written by the application. Inspect runtime behavior during acceptance rather than assuming a provider's promises are an OS-level guarantee.

Do not add migrations for billing, phone numbers or WhatsApp merely to make disabled screens look populated. Existing deferred Phase 1 cosmetic issues remain separate except where touched views require accurate source/version labels.

## 11. UI and completion gates

- `/app/bookings`: existing calendar/agenda visual language; empty state to add a resource; branch/resource filters; requested/confirmed/cancelled; collision/conflict states and precise local-calendar label.
- `/app/test`: source/digest badge, published/draft selection, text transcript, cited evidence, tool trace, cancel/retry, proposal review and link to resulting booking. Browser-call tab stays unavailable.
- `/app/contacts`: real booking history and privacy coverage. Home shows real booking counts; test proposals never count as appointments.
- `/app/agent`, setup and hours: links to text test/local calendar configuration; published voice readiness remains false. Integrations stays unavailable and never says Google is connected.

Checkpoint A: resources and staff bookings usable without model; concurrent confirm/reschedule and contact deletion safe. Checkpoint B: deterministic tool/session/worker tests pass without model. Checkpoint C: actual local-model text sessions pass multilingual/safety evaluation, with explicit measured limitations. Do not claim C passed from a scripted provider used only in tests.

Acceptance includes Phase 1 suite, new two-tenant/role/concurrency/privacy/job tests, scratch migration replay, both builds/type checks, actual local inference where enabled, engine/model outage, mode forgery, no external runtime requests, and all 26 mock routes with backend/model stopped. UI checks at 390/768/1440, both themes/BM+EN and keyboard paths. Measure model latency separately; this phase makes no 1.2-second voice-latency or speech-quality claim.

## 12. Source checks and future boundary

Checked 2026-10-16: [Ollama local-only configuration and runtime controls](https://docs.ollama.com/faq), [structured JSON](https://docs.ollama.com/capabilities/structured-outputs), [chat parameters](https://docs.ollama.com/api/chat), [runtime MIT license](https://github.com/ollama/ollama/blob/main/LICENSE), [candidate artifact](https://ollama.com/library/qwen3:4b), [candidate model Apache-2.0 license](https://huggingface.co/Qwen/Qwen3-4B/blob/main/LICENSE), [PostgreSQL 17 ranges/exclusion constraints](https://www.postgresql.org/docs/17/rangetypes.html). Artifact sizes/tags are observations, not permanent pins. Native host inference avoids relying on macOS Docker GPU support.

After this local milestone: evaluate speech locally where feasible, preserve the separate benchmark, then plan browser voice. Real Google authorization, SIP numbers, official WhatsApp and payments require separate owner authorization and provider checks. Claiming a domain does not authorize deployment or change these constraints.
