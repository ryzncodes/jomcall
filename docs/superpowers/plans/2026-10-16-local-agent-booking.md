# Local Agent Tools and Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Work sequentially in the current session unless the owner explicitly chooses delegation. Steps use checkbox (`- [ ]`) syntax for tracking. This is a proposed plan, not approval to begin implementation.

**Goal:** Deliver durable local bookings and a safe, inspectable text-agent tester without paid providers or changes to mock-preview behavior.

**Architecture:** Extend existing tenant commands and Postgres with local booking resources, pinned test sessions and proposals. Run bounded local inference through a separate host agent worker; model outputs cannot bypass domain authorization or confirm appointments. Reuse the existing UI style while retaining independent mock controllers.

**Tech Stack:** Existing Next.js/TypeScript, Zod, `pg`, pg-boss, Supabase local Auth/Postgres; PostgreSQL `btree_gist`; optional native Ollama with one explicitly prepared `qwen3:4b` development model. No model SDK, vector store, Redis, new Docker service or paid API is required. Preserve existing package versions unless a documented compatibility issue requires a scoped change.

**Spec:** [Phase 2 local design](../specs/2026-10-16-local-agent-booking-design.md), subordinate to [architecture](../specs/2026-10-15-jomcall-design.md) and [backend roadmap](2026-10-15-backend-roadmap.md). Read root/web AGENTS, Phase 1 implementation/QA and `docs/frontend/screens.md` first. Baseline: `b4496e6`, branch `codex/frontend-directions`; verify clean state and current HEAD at execution.

## Global Constraints

- Local only. No provider accounts, cloud resources, deployments, API credits, payment activation, external calendar writes or messages.
- Keep `JOMCALL_MODE=mock|local` server-selected, 4181 mock / 4182 local, separate build directories, existing five project containers and their volumes.
- No automatic model download, cloud fallback, URL ingestion, browser audio or synthetic AI response in local mode. Scripted providers are test-only.
- Use numeric loopback for inference; preserve existing 54621/54622/54624/54625 services. Do not stop another project's processes or prune its data.
- Preparation requires at least 10 GiB free; stop further downloading below 5 GiB. One model artifact at most 4 GiB; report actual disk/memory use.
- All tenant records use composite tenant FKs and forced RLS; existing app role cannot bypass RLS. Dedicated worker credentials remain server-only.
- CLI-generated migrations under `supabase/migrations/` remain the only schema history. No working-database reset.
- BM/EN UI, existing visual tokens, 390/768/1440 responsive checks, light/dark, keyboard access. No real personal data or secrets in git.
- Booking support initially uses `Asia/Kuala_Lumpur`; UTC storage, explicit time-zone display, capacity-one named resources, 15-minute grid, 15-minute lead time, 90-day horizon.
- Test actions create proposals. Explicit reviewed application creates a request; separate staff confirmation creates a confirmed local appointment.
- AGPL-compatible licenses, feature branch, small Conventional Commits. Product name is `JomCall`.

## Review Focus

1. Two users confirm/reschedule the same slot while a third changes branch hours: one valid result, no overlapping confirmation or lost original booking. Tasks 1–2.
2. A model invents tenant/contact IDs, follows instructions inside knowledge, or returns a fake success: schema/context/capability checks prevent unauthorized effects; UI uses authoritative status. Tasks 3–6.
3. Worker crashes after claiming/enqueuing or replies after cancel/logout/contact deletion: persisted state becomes recoverable and stale work cannot reappear. Tasks 3, 6.
4. User reloads after an uncertain proposal application and retries with a new client key: exactly one booking remains linked to that proposal. Task 4.
5. Model/backend unavailable, an unrelated process owns 11434, or disk is low: fail closed without downloading, pruning, stopping others or breaking 4181. Tasks 5, 8.

## Delivery checkpoints

| Checkpoint | Tasks | Proof |
| --- | --- | --- |
| A — local scheduling | 1–2 | Staff can request/confirm/reschedule/cancel; concurrent slots and privacy boundaries hold without a model |
| B — test core | 3–4, 6 test adapter | Pinned knowledge, persisted turns, validated proposals, cancellation and retry work without installed weights |
| C — local AI | 5–8 | Actual model-backed text test, reviewed request, real staff confirmation, cross-browser persistence and original mock flows |

Execution stays sequential: task 5 prepares the adapter before task 6 consumes it. Checkpoint B's deterministic tests are not evidence that C's inference works.

## File map

| Create | Responsibility |
| --- | --- |
| `packages/contracts/src/booking.ts` | Resource, availability and booking input/output schemas |
| `packages/contracts/src/agent-test.ts` | Session, turn, citation, model decision, tool and proposal schemas |
| `packages/domain/src/booking/{resources,availability,commands,routes}.ts` | Local resource administration, slot generation, atomic commands, thin HTTP dispatch |
| `packages/domain/src/agent-test/{knowledge,sessions,tools,proposals,routes}.ts` | Frozen retrieval, test lifecycle, bounded tools and reviewed application |
| `packages/inference/package.json`, `src/{index,ollama,budget}.ts` | Private ESM workspace, `ModelClient` port, loopback-only adapter and prompt budgets |
| `engine/src/agent/{index,runner,repository}.ts` | Separate inference loop, queue lifecycle and narrow worker SQL calls |
| `scripts/local/model-{prepare,start,stop}.mjs` | Explicit runtime/model preparation and owned-process lifecycle |
| `web/components/core/{bookings,booking-form,agent-test,test-transcript,proposal-review}.tsx` | Local controllers and focused views |
| `web/components/core/booking-calendar.tsx` | Pure calendar/agenda presentation reusable by existing mock when practical |
| `web/messages/core-{en,ms}.ts` | Matching typed Phase 2 copy keys |
| `tests/helpers/phase2.ts`, `tests/{api,db,domain,engine}/…` | Real DB/API fixtures and deterministic behavior checks |
| `tests/inference/{ollama,quality}.test.ts`, `tests/fixtures/agent-evaluation.json` | Protocol tests and separate actual-model evaluation |
| `docs/qa/2026-10-16-local-agent-booking.md` | Commands, measured outcomes, screenshots and known limits |

Modify `packages/contracts/src/core.ts`, `web/lib/server/{api,services}.ts`, `packages/domain/src/{workspace,privacy}.ts`, `web/components/core/{local-app,contacts,agent,settings}.tsx` and the current local home/setup views, `engine/src/engine.ts`, root scripts and local runbook. Add only CLI-generated migration files. Existing product mock controllers are behavior references, not domain implementations to import into the server.

## Shared interfaces and HTTP contracts

Use existing `TenantContext`, `MutationMeta`, `Database.withUserTransaction`, `command`, `audit`, `AppError`, authenticated API harness and SQL-backed fixtures. Every normal mutation uses strict schemas, CSRF/Origin, current membership and stable idempotency key. Resource/booking updates require `expectedRevision`. Test-turn creation returns 202 after its transaction commits. Unknown or foreign resource returns 404, role denial 403, validation 422, conflict 409, unavailable model 503 and capacity/rate cap 429. Never return raw PostgreSQL details.

```ts
// packages/contracts/src/booking.ts — the same shapes back Zod schemas.
export type Resource = {
  id: string; org_id: string; location_id: string; name: string;
  duration_minutes: number; active: boolean; revision: number;
};
export type Booking = {
  id: string; org_id: string; contact_id: string; resource_id: string;
  location_id: string; title: string; start_at: string; end_at: string;
  timezone: "Asia/Kuala_Lumpur"; status: "requested"|"confirmed"|"cancelled";
  source: "staff"|"reviewed_test"; revision: number;
};
export type BookingInput = {
  contactId: string; resourceId: string; title: string; startAt: string;
};
export type Slot = {
  resourceId: string; startAt: string; endAt: string;
  resourceRevision: number; scheduleRevision: number;
};
export type SlotsInput = { resourceId:string; fromDate:string; days:number; cursor?:string };
// Domain functions: tx is pg.PoolClient; ctx is the existing verified TenantContext.
// requestBooking derives source internally; the public schema rejects it.
requestBooking(tx, ctx, input: BookingInput, meta: MutationMeta): Promise<Booking>;
confirmBooking(tx, ctx, input:{id:string;expectedRevision:number}, meta:MutationMeta):Promise<Booking>;
rescheduleBooking(tx, ctx, input:{id:string;expectedRevision:number;startAt:string}, meta:MutationMeta):Promise<Booking>;
cancelBooking(tx, ctx, input:{id:string;expectedRevision:number}, meta:MutationMeta):Promise<Booking>;
getAvailability(tx, ctx, input:SlotsInput):Promise<{items:Slot[];nextCursor:string|null}>;
```

All time inputs require an ISO instant with explicit offset and valid calendar components; normalize to UTC. Resource duration is copied into start/end at request creation. Confirm/reschedule use that booking's stored duration, current hours and current confirmed occupancy. Resource duration edits do not silently change existing appointments.

| Named command | Route below `/api/v1` | Input / output |
| --- | --- | --- |
| `bookingResources` | GET `/booking-resources` | locationId optional; Resource[] |
| `createBookingResource` | POST `/booking-resources` | locationId/name/durationMinutes; Resource |
| `updateBookingResource` | PATCH `/booking-resources/:id` | id/revision/name/durationMinutes/active; Resource |
| `availability` | GET `/booking-availability` | SlotsInput; paginated Slot |
| `bookings` | GET `/bookings` | from/to (maximum31days), optional location/resource/contact/status, cursor/limit; paginated Booking |
| `booking` | GET `/bookings/:id` | id; Booking |
| `requestBooking` | POST `/bookings` | BookingInput; Booking(requested) |
| `confirmBooking` | POST `/bookings/:id/confirm` | id/revision; Booking |
| `rescheduleBooking` | POST `/bookings/:id/reschedule` | id/revision/startAt; Booking |
| `cancelBooking` | POST `/bookings/:id/cancel` | id/revision; Booking |
| `testReadiness` | GET `/agent-tests/readiness` | empty; configured/available/modelDigest/reason, no paths/secrets |
| `startAgentTest` | POST `/agent-tests` | agentId/locationId, optional contactId, source published(versionId) or draft(expectedRevision); TestSession |
| `agentTests` | GET `/agent-tests` | cursor/limit; summaries without full snapshots |
| `agentTest` | GET `/agent-tests/:id` | id; metadata and latest20 turns, not full knowledge snapshot |
| `testKnowledge` | GET `/agent-tests/:id/knowledge` | query≤200; KnowledgeHit[] |
| `submitTestTurn` | POST `/agent-tests/:id/turns` | text≤4000 UTF-8 bytes, expectedSessionRevision, clientTurnId UUID; TestTurn |
| `cancelTestTurn`, `retryTestTurn` | POST `/agent-tests/:sessionId/turns/:id/cancel` or `/retry` | expectedRevision; TestTurn |
| `deleteAgentTest` | DELETE `/agent-tests/:id` | expectedRevision; deleted ID only |
| `applyBookingProposal` | POST `/agent-tests/:sessionId/proposals/:id/apply` | contactId, expectedProposalRevision; Booking(requested) |

`bookings` pagination uses exact UTC `(start_at,id)` cursor scoped to all filters/tenant, maximum100 items; do not use the existing contact cursor without extending its scope. Resource lists cap100 per org. Local capability names distinguish `bookingLocal`, `agentTextTest`, `voiceCall`, `calendarExternalWrite`; mock booleans retain current behavior. `agentTextTest` is readiness-dependent; unavailable server checks still enforce it if a client forges UI state. Do not overload `calendarWrite` to imply Google connection.

```ts
// packages/contracts/src/agent-test.ts
export type KnowledgeHit = {sourceId:string;title:string;excerpt:string;score:number};
export type ToolCall =
 | {name:"search_knowledge";args:{query:string}}
 | {name:"check_availability";args:{resourceId:string;fromDate:string;days:number}}
 | {name:"book_slot";args:{resourceId:string;startAt:string;title:string}}
 | {name:"take_message";args:{text:string}}
 | {name:"handoff_to_human";args:{reason:string}};
export type ModelDecision =
 | {kind:"answer";text:string;citations:string[]}
 | {kind:"tool";call:ToolCall};
export type TestSession = {
 id:string; org_id:string; revision:number; source:"draft"|"published";
 snapshot_hash:string; agent_version_id:string|null; contact_id:string|null;
 state:"open"|"closed"; expires_at:string; model_digest:string|null;
};
export type TestTurn = {
 id:string;session_id:string;revision:number;attempt:number;
 state:"queued"|"running"|"completed"|"failed"|"cancelled";
 input:string;answer:string|null;citations:string[];error_code:string|null;
};
export type Proposal = {
 id:string;session_id:string;turn_id:string;attempt:number;revision:number;
 kind:"booking"|"message"|"handoff";details:ToolCall["args"];
 applied_booking_id:string|null;
};
// packages/inference/src/index.ts
export type ModelInput = {messages:{role:"system"|"user"|"assistant";content:string}[]};
export interface ModelClient {
 generate(input:ModelInput, signal:AbortSignal):Promise<ModelDecision>;
}
// Domain ports; worker scope is constructed only from a claimed stored turn.
buildKnowledgeIndex(snapshot:{knowledge:{kind:string;name:string;content:string}[]}):KnowledgeHit[];
searchKnowledge(index:KnowledgeHit[],query:string):KnowledgeHit[];
executeTestTool(scope:TurnScope,step:number,call:ToolCall):Promise<ToolResult>;
applyBookingProposal(tx,ctx,input:{sessionId:string;id:string;contactId:string;expectedProposalRevision:number},meta:MutationMeta):Promise<Booking>;
```

`TurnScope` (server-only) contains orgId/sessionId/turnId/attempt/leaseToken, creator user/session IDs, locationId, snapshot hash and frozen settings/knowledge. It never comes from browser/model JSON. `ToolResult` is `{kind:'knowledge',items:KnowledgeHit[]}|{kind:'availability',items:Slot[]}|{kind:'proposal',proposal:Proposal}`. Define strict discriminated Zod schemas with title120, message4000 bytes, reason500, answer4000 bytes, citations≤5, IDs UUID where applicable; `details` schema is correlated with proposal kind, not an unconstrained union. Keep frontend output types and runtime schemas generated from the same definitions.

## Task 1: Resource configuration and authoritative availability

**Files:** create booking contracts and `resources.ts`, `availability.ts`, `routes.ts`; modify registry/API; create `tests/helpers/phase2.ts`, `tests/api/booking-resources.test.ts`, `tests/domain/availability.test.ts`; new migration from `supabase migration new booking_resources`.

**Interfaces:** consume verified tenant transactions and saved location schedule; produce Resource, Slot, `getAvailability`, resource commands. Add no resource automatically. Keep `/bookings` gated until Task2.

- [ ] Build `createPhase2Harness()` on existing `createHarness()` and `createApiHarness()`. Return `{h,api,req,slotStart,close}`. `req(method,path,body?)` delegates `api.request(h.alice,h.orgA.id,method,'/api/v1'+path,body)`. Set tomorrow's KL date at09:00 as `slotStart`; install seven09:00–18:00 intervals through existing schedule command. `close` closes API then harness; record all created tenants in existing cleanup arrays.
- [ ] Add failing real API/SQL tests for resource roles, foreign location IDs, missing schedule, closures, adjacent intervals, exact UTC conversion, inactive resource, unsupported timezone and resource limit100. Example assertion:

```ts
const f = await createPhase2Harness();
try {
 const r = await f.req("POST","/booking-resources",{
  locationId:f.h.orgA.locationId,name:"Contoh Room",durationMinutes:30,
 });
 assert.equal(r.status,200);
 const denied = await f.api.request(f.h.staff,f.h.orgA.id,"POST","/api/v1/booking-resources",{
  locationId:f.h.orgA.locationId,name:"Forbidden",durationMinutes:30,
 });
 assert.equal(denied.status,403);
 const slots = await f.req("GET",`/booking-availability?resourceId=${r.body.data.id}&fromDate=${new Date(f.slotStart).toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'})}&days=1`);
 assert.equal(slots.body.data.items[0].startAt,f.slotStart);
} finally { await f.close(); }
```

- [ ] Run `npm run test:local -- tests/api/booking-resources.test.ts tests/domain/availability.test.ts`; expect missing route/function failures before implementation.
- [ ] Create resource table with composite branch FK, forced RLS (tenant member reads; manager writes), positive revision, duration CHECK, org resource limit locked via organization row. Derive slots on the server using `AT TIME ZONE 'Asia/Kuala_Lumpur'`, saved intervals and manual closures; include versions/cursor, never rely on browser time. Before Task2 exists occupancy query is empty by design, then Task2 adds confirmed intervals.
- [ ] Run the two tests, current Phase1 suite, `npm run typecheck`; expect pass. Commit `feat(booking): add local resources and availability`.

## Task 2: Atomic booking commands and contact privacy

**Files:** create `commands.ts`, `tests/api/bookings.test.ts`, `tests/db/booking-concurrency.test.ts`; modify availability/routes/contracts/API, workspace schedule guards and privacy serialization/worker SQL; generate `booking_commands` migration.

**Interfaces:** consume resource/slot service; produce request/confirm/reschedule/cancel and booking lists. Extract internal `requestBookingInTransaction(tx,ctx,input,source)` used by the idempotent public command and later proposal application; source is server-only. No receipt nesting or arbitrary browser source field.

- [ ] Write failures for two simultaneous confirmations, stale edits, confirmation after closure, losing reschedule preserving original time, adjacent ranges, requested/nonblocking semantics, deleted/DNC contact rules, cursor tenant boundaries and privacy removal. Test concurrent commands using different users/keys and SQL connections:

```ts
// a and b are requested bookings for different contacts on the same resource/time.
const results = await Promise.all([
 f.req("POST",`/bookings/${a.id}/confirm`,{expectedRevision:a.revision}),
 f.req("POST",`/bookings/${b.id}/confirm`,{expectedRevision:b.revision}),
]);
assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
const saved = await f.req("GET",`/bookings/${a.id}`);
assert.ok(["requested","confirmed"].includes(saved.body.data.status));
```

- [ ] Run `npm run test:local -- tests/api/bookings.test.ts tests/db/booking-concurrency.test.ts`; expect unavailable routes/absence of authoritative overlap enforcement.
- [ ] Implement commands and receipt replay with contact → location → resource → booking locks. Add database constraint:

```sql
create extension if not exists btree_gist with schema extensions;
-- Qualify extension operator classes if the migration search_path excludes extensions.
alter table app.booking add constraint booking_no_confirmed_overlap
exclude using gist (
 org_id with =, resource_id with =,
 tstzrange(start_at,end_at,'[)') with &&
) where (status='confirmed');
```

Add composite FKs, indexes, status/range CHECKs and forced RLS. Catch exclusion SQLSTATE23P01 as `SLOT_UNAVAILABLE`409. Direct authenticated-role writes must satisfy RLS; no staff cross-tenant access. For schedule guards reuse location lock, query future confirmed appointments and reject invalidating edits. Resource archival and branch/time-zone changes reject all outstanding future requested/confirmed bookings; test those guards and resource-duration edits preserving existing booking duration. Confirm/reschedule recheck current schedule/contact state, not a previously displayed Slot.
- [ ] Extend export JSON with bookings; extend deletion's existing transaction to remove them before contact deletion. Test deleting a contact while confirmation races: either confirmation commits first then is removed, or confirmation fails; no surviving booking. Add associated audit IDs only.
- [ ] Enable registered booking routes without unlocking other disabled families. Run targeted tests, `npm run check:core`, migration replay/typecheck. Commit `feat(booking): persist requests and conflict-safe appointments`.

## Task 3: Frozen knowledge and durable text-test records

**Files:** create agent-test contracts, `knowledge.ts`, `sessions.ts`, `routes.ts`; new `agent_test_records` migration; `tests/domain/knowledge.test.ts`, `tests/api/agent-tests.test.ts`, `tests/db/agent-test-privacy.test.ts`; extend privacy export/deletion and bounded maintenance.

**Interfaces:** produce TestSession/TestTurn/KnowledgeHit schemas, start/read/list/delete session and retrieval commands; `loadTurnEnvelope` data shape for later worker. Session creation works without inference; submit/retry remain unavailable until Task6. Existing published snapshots remain untouched.

- [ ] Write failures for frozen draft/published snapshots, source citation stability with snapshots lacking item IDs, BM/EN/Han matching, literal unsafe text, empty search, unknown citation rejection, role/tenant restrictions, limits, expiry, model digest changes and contact deletion during a session.

```ts
const snapshot={knowledge:[{kind:"faq",name:"Hours",content:"Buka Isnin pukul sembilan. 营业时间早上九点。"}]};
const index=buildKnowledgeIndex(snapshot);
assert.ok(searchKnowledge(index,"Isnin")[0].sourceId);
assert.ok(searchKnowledge(index,"营业时间").length>0);
assert.deepEqual(searchKnowledge(index,"unrelatedxyz"),[]);
assert.deepEqual(buildKnowledgeIndex(snapshot),index);
```

- [ ] Run `npm run test:local -- tests/domain/knowledge.test.ts tests/api/agent-tests.test.ts tests/db/agent-test-privacy.test.ts`; expect missing functions/routes.
- [ ] Add test_session/test_turn/test_tool_step/test_proposal tables with limits and composite FKs. Snapshot under agent lock; hash canonical snapshot content. Partial index allows only one queued/running turn per session. Include `client_turn_id`, unique `(org_id,session_id,client_turn_id)`, plus request hash so new-key replay returns same turn only for same input. First submitted turn pins the configured model digest under the session lock; later submit/retry with a different digest returns `MODEL_CHANGED`. No call/conversation/channel record is created by a test.
- [ ] Implement normalization/chunk scoring described in spec. Keep knowledge search pure and bounded; database auth determines which snapshot may be supplied. Add expired-read denial and bounded cleanup. Contact export includes linked tests; deletion invalidates lease generation and removes all linked transcripts/proposals in the same transaction. Delete-session authorization and cleanup must not depend on model availability.
- [ ] Run targeted tests, core suite/typecheck and migration replay. Commit `feat(agent): add pinned local test sessions and retrieval`.

## Task 4: Typed sandbox tools and reviewed proposal application

**Files:** create `tools.ts`, `proposals.ts`, `tests/domain/agent-tools.test.ts`, `tests/api/proposal-application.test.ts`; modify test contracts/routes and booking service; generate `proposal_application` migration if additional uniqueness is needed.

**Interfaces:** produce `executeTestTool(scope,step,call)` and `applyBookingProposal`. `scope` is built from stored authorized session data, never deserialized from a request. Model may only choose tool arguments from allowlist. Add `expectedProposalRevision` to application; transaction binds optional session contact once.

- [ ] Test unknown tools, extra fields (`orgId`, `contactId`, `confirmed`), foreign resources, misleading instructions embedded in knowledge and repeated calls. Check sandbox book_slot creates zero real bookings. Applying same proposal with two independent keys creates one request, including after reload:

```ts
const before = await f.req("GET",bookingListPath);
const result = await executeTestTool(scope,0,{name:"book_slot",args:{resourceId,startAt:f.slotStart,title:"Test"}});
assert.equal((await f.req("GET",bookingListPath)).body.data.items.length,before.body.data.items.length);
assert.equal(result.kind,"proposal");
const applied = await Promise.all([applyOnce(),applyOnce()]);
assert.equal(applied[0].body.data.id,applied[1].body.data.id);
assert.equal(applied[0].body.data.status,"requested");
```

Here `bookingListPath` is `/bookings?from=<tomorrow00:00+08:00>&to=<nextday00:00+08:00>` URL-encoded; `scope` is obtained via session/turn fixture, and `applyOnce` calls the registered application route with the same proposal/revision/contact and a fresh API-harness key.
- [ ] Run `npm run test:local -- tests/domain/agent-tools.test.ts tests/api/proposal-application.test.ts`; expect missing implementation failures.
- [ ] Execute read-only tools against scoped data; writes insert proposal/step rows only, unique `(turn_id,attempt,step)`. For applying, first inspect IDs then lock contact → session/proposal → location → resource; recheck after locking, bind session contact, call `requestBookingInTransaction(...,'reviewed_test')`, persist reference and audit atomically. Load an existing applied booking before treating old expectedRevision as conflict; reauthorize it, and return404 if erased. Do not allow changing contact/time/title on replay. No free-form instruction influences permissions.
- [ ] Run targeted tests and core suite/typecheck. Commit `feat(agent): validate tools and review booking proposals`.

## Task 5: Optional local model adapter and guarded preparation

**Files:** create private `packages/inference` workspace, adapter/budget modules, model lifecycle scripts, `tests/inference/ollama.test.ts`, `tests/local/model.test.mjs`; update root scripts/ignore/runbook. Runtime resolution lock goes in `infra/local/model-lock.json` after actual preparation; contains version/model digest/license/provenance only, never paths with personal data or credentials.

**Interfaces:** `ModelClient.generate(ModelInput,AbortSignal):Promise<ModelDecision>`; `getModelReadiness():Promise<{available:boolean;modelDigest:string|null;reason:string|null}>`; env `JOMCALL_MODEL_PROVIDER=disabled|ollama`, fixed local URL, pinned digest and owned model directory. No implementation in browser bundles. Add `check:phase2` script covering core tests plus protocol tests; `check:local-model` runs actual model evaluation separately.

- [ ] With a loopback HTTP fixture, test valid JSON decision, invalid/extra tool args, truncated response, >256-KiB response, invalid UTF-8, timeout/abort, missing model, digest mismatch, redirects/remote URL and disabled provider. Every network-denial test asserts no request reached a remote destination.

```ts
const controller=new AbortController();controller.abort();
await assert.rejects(client.generate({messages:[{role:"user",content:"Hello"}]},controller.signal));
await assert.rejects(createOllamaClient({url:"https://example.invalid",model:"qwen3:4b",digest:"fixture"}),/LOCAL_MODEL_REQUIRED/);
// The fixture returns a valid JSON object with an unauthorized field.
fixture.reply({message:{content:JSON.stringify({kind:"tool",call:{name:"book_slot",args:{orgId:foreignOrg}}})}});
await assert.rejects(client.generate(input,new AbortController().signal),/MODEL_OUTPUT_INVALID/);
```

`createOllamaClient(config)` is an async factory returning ModelClient; `fixture.reply` is a test-owned HTTP server response setter, not a runtime fallback. `input` is a bounded ModelInput; the fixture URL may use a random numeric loopback port only under NODE_ENV=test.
- [ ] Run `npm run test:local -- tests/inference/ollama.test.ts tests/local/model.test.mjs`; expect missing adapter/guards.
- [ ] Implement using native fetch, `redirect:'error'`, composed AbortSignals, streamed byte counting before JSON parse, strict Zod output validation and no raw output logs. Request envelope:

```ts
{
 model: lockedModelName, messages: boundedMessages,
 stream: false, think: false, format: z.toJSONSchema(modelDecisionSchema),
 keep_alive: "30s", options: {num_ctx:8192,num_predict:512,temperature:0}
}
```

`modelDecisionSchema` derives from Task4's allowlist. `packModelInput` measures required serialized messages/schema, rejects >6000 UTF-8 bytes, then fits optional history/evidence. Never drop required instructions or latest input; citation mapping refers to excerpts actually included. Validate runtime capability supports requested non-thinking mode; otherwise readiness fails rather than sending an unbounded reasoning request.
- [ ] Build preparation as explicit `npm run model:prepare -- --download`; ordinary `model:start` never installs/pulls. Use official distribution or existing package manager, verify license/version/artifact, record full digest, enforce disk/model budget and isolated model path. Start owned native process with `OLLAMA_HOST=127.0.0.1:11434`, `OLLAMA_NO_CLOUD=1`, `OLLAMA_MODELS=<project>/.local/models`, one loaded model/parallel request and bounded queue. No global service changes. Lock stop/start to own PID and validate process ownership; foreign occupied port fails unchanged.
- [ ] Run protocol/guard tests and typecheck. If executing the full AI checkpoint, prepare one candidate and record actual size/availability; if unavailable report checkpointC incomplete, never pass it using fixture inference. Commit `feat(agent): add guarded local inference adapter`.

## Task 6: Durable, cancellable agent worker

**Files:** create `engine/src/agent/{index,runner,repository}.ts`, `tests/engine/agent-turns.test.ts`, `tests/engine/agent-authority.test.ts`; modify core outbox claim filter, test session turn routes, scripts and root/local env generator; generate `agent_worker` migration.

**Interfaces:** `AgentRunner.create(namespace,model?:ModelClient)`, `.tick(failAt?:'after-enqueue'|'after-claim'|'before-finalize')`, `.close()`; injection/failure switches accepted only under NODE_ENV=test. Repository ports `claimTurn`, `readToolContext`, `recordToolStep`, `completeTurn`, `failTurn`, `reconcileAgentTurns` resolve stored IDs/leases, never arbitrary org scope. Each returns the typed contract or safe status.

- [ ] Add tests with deterministic ModelClient implementations for answer/invalid citation/tool loop/cancel/revocation and process restart. Expose no test-provider environment option in ordinary runtime. Reproduce stale completion:

```ts
const pending = runner.tick(); // Test ModelClient pauses at an explicit barrier.
await barrier.claimed;
const current = await f.req("GET",`/agent-tests/${session.id}`);
const running = current.body.data.turns.find((item:TestTurn)=>item.id===turn.id);
await f.req("POST",`/agent-tests/${session.id}/turns/${turn.id}/cancel`,{expectedRevision:running.revision});
barrier.release({kind:"answer",text:"Late answer",citations:[]});
await pending;
assert.equal((await f.req("GET",`/agent-tests/${session.id}`)).body.data.turns[0].state,"cancelled");
assert.equal((await f.req("GET",`/agent-tests/${session.id}`)).body.data.turns[0].answer,null);
```

Also kill a child worker **after a claimed turn**, drive queue timeout, verify failed/retryable state and no duplicate proposal/application. Run privacy work during a deliberately slow model call; privacy completes independently.
- [ ] Run `npm run test:local -- tests/engine/agent-turns.test.ts tests/engine/agent-authority.test.ts`; expect missing runner/lifecycle behavior.
- [ ] Add dedicated runtime role/function-owner grants, safe worker functions and optional configured credentials via existing local bootstrap. Filter existing `claim_outbox(namespace,limit)` to only privacy/mail; add agent-specific claim/ack/reconcile functions. Namespace and latest-attempt checks apply to both queues. Never widen the old business worker role to arbitrary tenant reads.
- [ ] Persist submitted turn/outbox in one transaction; process model outside transactions with deadline/lease. Check identity/session/contact at every read/tool/finalize. At most four tools, three model calls, 60seconds/turn; no automatic replay of uncertain model attempts. Commit result/step/proposal state atomically for current generation; explicit retry retains logical turn ID and changes operation/attempt. Cancel/delete removes access immediately and rejects late completion. Queue metadata contains IDs only.
- [ ] Run targeted tests, `npm run check:phase2`, typecheck and migration replay. Commit `feat(engine): run durable local agent turns`.

## Task 7: Connect existing screens to local commands

**Files:** new core booking/test components and typed copy files; modify core local-app/contacts/agent/settings, capability/readiness handling, relevant CSS and public mock shared-view adapters only where needed; add `tests/domain/phase2-contracts.test.ts` and ignored browser regression script under `output/playwright/`.

**Interfaces:** consume only named commands above; share display components with mocks when feasible, never their providers. Expose text testing only to managers; bookings to active staff. Keep voice, WhatsApp, external calendar and billing gates unchanged. Lists/errors never source fixture storage.

- [ ] Add API contract tests asserting every new route/header/schema and preserved disabled capabilities. Capture failing browser journeys before wiring: local booking resource form, request/confirm, text session/trace/proposal review, linked contact history, model outage and resumed turn after refresh. Use existing Playwright skill workflow with one owned browser, not additional persistent Chrome profiles.
- [ ] Run `npm run test:local -- tests/domain/phase2-contracts.test.ts` as regression coverage of contracts from Tasks1–6; these may already pass. Require the new browser journeys to fail on the missing local views before wiring. Record that unwired state as the UI baseline.
- [ ] Wire `/app/bookings`, `/app/test` and contact booking list. Add authorized local booking counts to home and test/calendar links to agent/setup/hours; counts exclude test proposals and never infer external readiness. Use existing chrome/tokens, extract pure calendar presentation if safe, and typed BM/EN strings. Retain dirty forms on transient failures and resource revision conflict. Render “Test proposal”, “Awaiting confirmation” and “Confirmed in local calendar” distinctly. Explicit apply/confirm buttons have separate review steps. Store only active session ID in URL, never transcripts or authorization in browser storage.
- [ ] Poll running turns every2seconds with cleanup; background/idle15seconds; focus refetch. Stale responses must not overwrite newer session/revision or another workspace. Show pinned version/draft snapshot and model digest; stop/cancel, retry, elapsed time and safe errors. Voice tab says unavailable. No microphone permission request.
- [ ] Verify all planned journeys at390/768/1440, BM/EN/light/dark, keyboard/focus and long labels. Confirm local backend outage never reveals seeded contacts. Run `npm run check:phase2`, typecheck and both builds. Commit `feat(web): connect local bookings and text agent tests`.

## Task 8: Real-model evaluation, outage proof and handover

**Files:** create `tests/inference/quality.test.ts`, `tests/fixtures/agent-evaluation.json`, QA report; update root README, local runbook, AGENTS current state and screen-status note. No new service code beyond fixing acceptance failures.

**Interfaces:** consumes the installed locked model only for `check:local-model`; automated safety suite remains model-independent. Test fixture knowledge/contact names are clearly fake. Record real model outcomes separately from scripted tool/queue outcomes.

- [ ] Create48 reproducible text cases:12 each BM/EN/Manglish/Mandarin. Each group covers four grounded FAQ requests, two missing-information questions, two booking intents, two message/handoff intents, one malicious knowledge instruction and one request for unauthorized actions. Fixtures specify expected source IDs/tool or refusal, not identical generated prose. Twelve representative answers also receive manual factual/language review. Store pass/fail/timing/model digest, not hidden reasoning.
- [ ] Run evaluator before tuning. Fail on unauthorized writes, invented success states, invalid citations or unbounded loops. Record baseline language failures honestly. Acceptance target: all safety cases pass, at least10/12 task outcomes per language and manual review finds no unsupported critical business facts; otherwise mark model experimental and checkpointC incomplete. Do not change fixtures to make a candidate pass.
- [ ] Execute end-to-end two-browser demo: frozen knowledge→actual model→proposal→explicit request→staff confirmation→contact history. Restart app/agent/DB using existing volume-preserving scripts and verify persisted state. Stop model: booking works, AI reports unavailable. Stop backend+model: all26 mock routes still work. Inject mode query/cookie/storage values; server modes remain unchanged.
- [ ] Run final checks:

```sh
npm run check:phase2
npm run check:local-model
npm run db:verify-migrations
npm run typecheck
npm run build:mock
npm run build:local
npm run contracts:generate
supabase db advisors --local --type security --fail-on error
```

Document pre-existing isolated queue warnings separately. Regenerate contracts and require clean diff afterward. Capture scoped listener/container inventories, disk before/after, model RSS and runtime network destinations; no external requests during exercised runtime. Actual model test may take time; no unsupported latency claim.
- [ ] Record limitations and any failed acceptance gates. Remove only exact test fixtures/queues and owned browser processes; preserve ordinary data, model artifact unless explicitly removed, unrelated stacks and mock storage. Run one whole-branch reviewer through executing-plans, fix important findings with RED→GREEN tests, then commit `test(agent): verify local inference booking and preview isolation`. Keep feature branch local; no push/deploy.

## Self-review and handoff

Coverage: spec booking authority maps Tasks1–2; frozen knowledge/privacy Tasks3–4; local model budget Task5; worker authorization/recovery Task6; connected UI Task7; all acceptance/cost/mock checks Task8. Review Focus1 maps concurrent SQL/API tests;2 tool/parser and worker-auth tests;3 cancellation/claimed-process-death tests;4 new-key application replay test;5 runtime guards and stopped-backend UI checks.

Intentional roadmap changes: manual/local knowledge only, local calendar instead of Google authorization, optional locally downloaded development model instead of hosted inference, text-only testing with reviewed proposals. Google remains the first later external calendar. The original 15-minute first real call/voice latency targets are not claimed by this milestone.

Planning only: no code, migrations, dependencies, containers, model downloads or runtime settings change in this turn. Recommend native sequential execution because tools, worker permissions and booking transactions share tight interfaces and the owner wants low overhead. Written design/plan remain proposed until reviewed; no implementation starts from this document alone.
