# Setup Flow (Interview and Review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new owner goes from an empty workspace to a tested, published agent through one route (`/app/setup`): pick a business type, answer up to 8 questions, check one review page, try a call, publish once.

**Architecture:** Answers are held in a staging store (`app.setup_session`, `app.setup_item`) and never reach the agent until the owner confirms the review. One command (`applySetup`) then writes facts, schedule, packs and the agent draft in a single transaction. The existing test panel and publish are reused. The document import door is a later plan and plugs into the same staging store and review page.

**Tech Stack:** Next.js + TypeScript (`web/`), zod contracts (`packages/contracts`), domain routes (`packages/domain`), Postgres with row-level security (`supabase/migrations`), node:test.

**Spec:** `docs/superpowers/specs/2026-11-14-setup-flow-design.md` (approved 2026-11-14). Depends on `docs/superpowers/plans/2026-11-14-core-tools-on-channels.md` only for real channels; this plan can be built and tested without it.

**One deviation from the spec, to confirm with the owner:** the spec says a model turns a free-text interview answer into fact fields. The web app holds no model key, so in this plan an answer is stored as the text of the fact its question fills, with no model call. Model help with answers arrives with the import plan, which adds the reader to the agent process.

## Global Constraints

- Original work only; dependencies MIT/Apache-2.0/BSD/ISC class; none are expected.
- UI text in English and Bahasa Melayu through the existing `w(en, ms)` helper; wording that names "local" or "this computer" only when `HOSTED` is false (`web/lib/hosted.ts`).
- Mobile first: every screen works at 390 px width; touch targets at least 44 px.
- No Save button in the flow. Answers are kept as the owner moves on, with a "Saved" mark.
- Nothing staged is visible to the agent before `applySetup`. `applySetup` never publishes.
- Setup merges, never overwrites: an existing confirmed value is replaced only when the owner names that item in `replace`.
- Publish stays the existing `publish` command and its rules (`packages/domain/src/agents.ts:153-184`).
- Owners and admins only; staff are refused with the existing role error.
- At most 8 interview questions in one setup.
- Setup rows hold the business's own answers, not customer records. They are removed with the agent or the organization (`on delete cascade`). They are not linked to a contact, so contact export and delete do not list them; the import plan must revisit this when uploaded files can contain customer details.
- Fact values stay within the existing 4,000-byte limit (`app.knowledge_fact.value`).
- Mock mode (`JOMCALL_MODE=mock`) keeps `web/components/product/setup.tsx`; it never calls these commands.
- After adding commands run `npm run contracts:generate`; `tests/domain/contracts.test.ts` checks `packages/contracts/openapi.json`.
- Migration file: `supabase/migrations/20261115090000_setup_store.sql`. Migrations are re-runnable.
- Feature branch, small Conventional Commits, pull request into `main`.

## Review Focus

1. The owner answers three questions on a laptop, closes the tab, and opens setup on a phone: the flow resumes at question four with the three answers kept. (Task 3 test, Task 5 check.)
2. Apply is pressed twice, or in two tabs: facts and schedule are written once; the second call reports the applied state, not an error page. (Task 4 test.)
3. A workspace that already has a published agent and confirmed facts runs setup: no existing value changes unless listed in `replace`; the published version is untouched until Publish. (Task 4 test.)
4. A staff member opens `/app/setup`: a clear "ask an owner or admin" message, no broken form. (Task 3 test, Task 5 check.)
5. An answer of 5,000 characters, only spaces, or emoji and Chinese text: the first is refused with a readable message, the second counts as skipped, the third is stored and shown back unchanged. (Task 3 test.)

---

### Task 1: Staging store

**Files:**
- Create: `supabase/migrations/20261115090000_setup_store.sql`
- Test: `tests/db/setup-store.test.ts`

**Interfaces:**
- Produces: table `app.setup_session(id uuid pk, org_id uuid, agent_id uuid, main_pack text, extra_packs text[] default '{}', state text check in ('open','applied') default 'open', revision int default 1, created_by uuid, created_at, updated_at)`; a unique index allows one `open` session per `(org_id, agent_id)`; `on delete cascade` from organization and agent.
- Produces: table `app.setup_item(id uuid pk, org_id uuid, session_id uuid references app.setup_session on delete cascade, kind text check in ('fact','schedule','settings','catalogue_row'), key text, payload jsonb check (octet_length(payload::text) <= 8000), source text check in ('interview','import'), needs_check boolean default false, check_reason text, state text check in ('pending','confirmed','removed','applied') default 'pending', created_at, updated_at, unique(session_id, kind, key))`.
- Row-level security on both, following `supabase/migrations/20261114200000_knowledge_core.sql:170-194`: every member of the organization may read; only `owner` and `admin` may insert, update or delete; `force row level security`; grants to `jomcall_app`.

- [ ] **Step 1: Write failing tests** with `createHarness()` (`tests/helpers/local.ts`):
  - `an owner creates an open setup session and items`.
  - `a second open session for the same agent is refused` (unique violation).
  - `staff can read but not write setup rows`.
  - `another organization sees no setup rows`.
  - `an item payload above 8000 bytes is refused`.
  - `deleting the agent removes its setup rows`.
- [ ] **Step 2: Run** `npm run test:local -- tests/db/setup-store.test.ts`. Expected: FAIL (relation does not exist).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `npm run db:migrate:local && npm run db:verify-migrations && npm run test:local -- tests/db/setup-store.test.ts`. Expected: PASS; replay passes with two more RLS tables.
- [ ] **Step 5: Commit** `feat(db): staging store for setup answers`

### Task 2: Business types and the question list

**Files:**
- Create: `packages/domain/src/setup/business-types.ts`
- Create: `packages/domain/src/setup/questions.ts`
- Test: `tests/domain/setup-questions.test.ts`

**Interfaces:**
- Consumes: `packs`, `packById`, `basePack` and each pack's `interview[{order,en,ms,fills[]}]` and `facts[{key,label,required}]` from `packages/domain/src/packs/index.ts`.
- Produces: `businessTypes: readonly {id: string; en: string; ms: string; pack: string}[]`. About twelve entries, written by hand, each naming one main pack; the last is `{id:"other", en:"Something else", ms:"Lain-lain", pack:"every-business"}`.
- Produces: `type SetupQuestion = {id: string; kind: "hours" | "first_words" | "fact"; en: string; ms: string; fills: string[]}`.
- Produces: `setupQuestions(input: {mainPack: string; extraPacks: string[]; filled: ReadonlySet<string>}): SetupQuestion[]`. Order: `hours` first, then the base pack's interview entries, then the main pack's, then each extra pack's, each by `order`; `first_words` last. A fact question whose first `facts.<key>` target is in `filled` is left out. `hours` is left out when `filled` has `schedule`; `first_words` when it has `settings`. The fact questions are cut so the whole list is at most 8.
- Produces: `missingFacts(input: {mainPack: string; extraPacks: string[]; filled: ReadonlySet<string>}): {pack: string; key: string; en: string; ms: string}[]`: every `required` fact of the active packs whose key is not in `filled`.
- Produces: `factKeyOf(question: SetupQuestion): string | null`: the key of the first `facts.*` entry in `fills`.

- [ ] **Step 1: Write failing tests**
  - `every pack except every-business has at least one business type; every type names a real pack and has both languages`.
  - `the question list starts with hours and ends with first words`.
  - `the list never exceeds 8 questions` for every pack combined with every other pack as an extra.
  - `a filled fact drops its question; a filled schedule drops hours`.
  - `missingFacts lists required facts of the base and main pack and skips filled ones`.
  - `question ids are unique and stable` (calling twice gives the same ids).
- [ ] **Step 2: Run** `npm run test:local -- tests/domain/setup-questions.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Question id: `"hours"`, `"first_words"`, or `"<packId>:<order>"`.
- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(setup): business types and interview question list`

### Task 3: Setup commands

**Files:**
- Create: `packages/contracts/src/setup.ts`
- Modify: `packages/contracts/src/core.ts:236` (add the commands)
- Create: `packages/domain/src/setup/routes.ts`
- Modify: `web/lib/server/api.ts:104-217` (chain the new route function)
- Modify: `web/lib/core/client.ts:120` (`MockCoreClient`: each new command throws the existing "not available in the sample preview" error)
- Regenerate: `packages/contracts/openapi.json`
- Test: `tests/api/setup.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; Task 2 functions; `claimTrial`'s domain branch (`packages/domain/src/billing.ts:82-91`).
- Produces (commands, all under the agent, owner or admin only, each wrapped in `command(tx, ctx, key, kind, input, execute, load)` like `packages/domain/src/knowledge/routes.ts`):
  - `setup` GET `/agents/:id/setup` → `{session: {id, mainPack, extraPacks, state, revision} | null, items: SetupItem[], questions: SetupQuestion[], missing: {pack,key,en,ms}[], conflicts: {itemId: string, current: unknown}[]}`. `questions` and `missing` use a `filled` set made of confirmed facts already on the agent plus non-removed items in the session. `conflicts` lists items whose target already has a confirmed value on the agent.
  - `startSetup` POST `/agents/:id/setup` `{mainPack: string, extraPacks: string[] (max 3)}` → the `setup` shape. Reuses the open session if one exists (updating its packs). Also claims the trial credit for the organization, ignoring `TRIAL_USED`, and ignoring a disabled payment provider.
  - `answerSetup` PUT `/agents/:id/setup/answers/:questionId` `{expectedRevision: number, answer: SetupAnswer}` → the `setup` shape. `SetupAnswer` is one of: `{kind:"fact", text: string (trimmed, max 2000 characters)}`; `{kind:"hours", timezone: string, weekdays: the weekdays shape of saveSchedule}`; `{kind:"first_words", greeting: string (1..2000), aiDisclosure: string (1..2000)}`; `{kind:"skip"}`. A fact answer upserts one item `kind 'fact'`, `key = factKeyOf(question)`, `payload {packId, fieldKey, title, value: text, language}`, `source 'interview'`. Hours upserts `kind 'schedule'`, key `"schedule"`. First words upserts `kind 'settings'`, key `"settings"`. Skip marks that question's item `removed` (creating it if absent). Text that is empty after trimming is treated as `skip`.
  - `saveSetupItem` PUT `/agents/:id/setup/items/:itemId` `{expectedRevision: number, payload?: unknown, state?: "pending" | "confirmed" | "removed"}` → the `setup` shape.
- Every write bumps `setup_session.revision`; a stale `expectedRevision` returns the existing `CONFLICT` error.
- `SetupItem = {id, kind, key, payload, source, needsCheck, checkReason, state}`.

- [ ] **Step 1: Write failing tests** with `createPhase2Harness` / `f.req(method, path, body)`:
  - `startSetup opens a session, returns at most 8 questions and claims the trial credit once` (wallet ledger has one `trial_credit` of 2000 sen; a second `startSetup` adds none).
  - `an answer is kept and its question leaves the list` (Review Focus 1: a fresh GET `setup` as the same owner returns the answer and the next question).
  - `a 2001-character answer is refused with a validation error; a spaces-only answer is a skip; emoji and Chinese text come back unchanged` (Review Focus 5).
  - `hours and first words are stored as schedule and settings items`.
  - `staff are refused on every setup command` (Review Focus 4).
  - `a stale revision is refused with CONFLICT`.
  - `nothing staged appears in knowledgeCore or in a draft test session's snapshot`.
  - `an existing confirmed fact shows up as a conflict when the same key is answered`.
  - `the openapi file lists the four commands` (the existing contracts test passes after regeneration).
- [ ] **Step 2: Run** `npm run test:local -- tests/api/setup.test.ts`. Expected: FAIL (404).
- [ ] **Step 3: Implement** schemas, routes and wiring; run `npm run contracts:generate`.
- [ ] **Step 4: Run** `npm run test:local -- tests/api/setup.test.ts tests/domain/contracts.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(setup): staging commands for the guided flow`

### Task 4: Apply

**Files:**
- Modify: `packages/contracts/src/setup.ts`, `packages/contracts/src/core.ts`, `packages/domain/src/setup/routes.ts`
- Regenerate: `packages/contracts/openapi.json`
- Test: `tests/api/setup-apply.test.ts`

**Interfaces:**
- Consumes: Task 3 session and items; existing writers: fact and pack writes in `packages/domain/src/knowledge/routes.ts:174-199`, `enforceCoreLimits` (`packages/domain/src/knowledge/snapshot.ts:273`), schedule save (`packages/domain/src/workspace.ts:74-106`), draft save (`packages/domain/src/agents.ts:117-121`).
- Produces: `applySetup` POST `/agents/:id/setup/apply` `{expectedRevision: number, replace: string[] (item ids, max 100)}` → `{agentRevision: number, applied: number, skipped: {itemId: string, reason: "conflict" | "removed" | "unconfirmed"}[]}`.
- Behaviour, in one transaction: set `agent.packs` to the session's main and extra packs (the base pack stays active as today); for each item not `removed`: a `fact` becomes a confirmed `knowledge_fact` with `source 'interview'`; `schedule` saves the primary location's schedule; `settings` merges `greeting` and `aiDisclosure` into the agent draft, leaving other settings as they are; `catalogue_row` items are ignored by this plan (reported as `unconfirmed`). An item whose target already has a confirmed value is written only if its id is in `replace`, otherwise reported as `conflict`. Items with `needs_check` true and state `pending` are reported as `unconfirmed` and not written. Written items become `applied`; the session becomes `applied`. A session already `applied` returns the same result shape with `applied: 0` and does nothing.

- [ ] **Step 1: Write failing tests**
  - `apply writes facts, schedule, packs and first words, and a draft test session then answers from them` (start an agent test with source draft; the snapshot contains the fact and the hours).
  - `apply twice writes once` (Review Focus 2): second call returns `applied: 0`; fact count unchanged.
  - `an existing confirmed fact is kept unless named in replace` (Review Focus 3), and the published version's snapshot is byte-identical before and after apply.
  - `a flagged pending item is not written`.
  - `apply does not publish`: `published_version_id` is unchanged.
  - `a failure in one write rolls back all of them` (force a fact value over 4,000 bytes through `saveSetupItem`; assert no fact, schedule or settings changed).
  - `staff cannot apply`.
- [ ] **Step 2: Run** `npm run test:local -- tests/api/setup-apply.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate the openapi file.
- [ ] **Step 4: Run** both setup test files, `tests/api/knowledge-core.test.ts`, `tests/domain/contracts.test.ts`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(setup): apply staged answers in one write`

### Task 5: The flow screens

**Files:**
- Create: `web/components/core/setup/flow.tsx` (stage shell, resume, autosave)
- Create: `web/components/core/setup/business-type.tsx`
- Create: `web/components/core/setup/interview.tsx`
- Create: `web/components/core/setup/review.tsx`
- Create: `web/components/core/setup/finish.tsx` (test, then publish)
- Modify: `web/components/core/local-app.tsx:318` (render `SetupFlow` for screen `setup`; `LocalAgent` stays for `builder`)
- Modify: `web/components/core/local-app.tsx:178-218` (workspace creation: business type is a select of `businessTypes` in the current language; the chosen entry's English label is sent as `businessType`, its id kept in the URL for the first setup visit)
- Modify: `web/app/core.css` (styles for the flow)
- Test: `tests/local/setup-flow.test.mjs` (guard test, static)

**Interfaces:**
- Consumes: commands `setup`, `startSetup`, `answerSetup`, `saveSetupItem`, `applySetup`, `startAgentTest`, `publish`; `businessTypes`; the existing `AgentTest` panel component (`web/components/core/agent-test.tsx`).
- Produces: `export function SetupFlow(): JSX.Element`. Stage is derived from server state, not stored in the browser: no session → business type; unanswered questions → interview; session open with no questions left → review; session applied and no published version → finish; published → a short "your agent is live for testing" page with a link to the Agent page.

Screen rules (the canvas the owner approved shows the look: `https://claude.ai/artifact/Jifsbz9kmsrf8dMJzkuUgS`, direction C for review, direction A for the interview):
- Business type: one tap per option, optional ticks for the packs the main pack pairs with (`pairsWith`), then Continue.
- Interview: one question per screen, a progress line "Question n of m", Back, Skip and Continue. `hours` is a day list with open and close times and a "same every day" shortcut. `first_words` shows a prefilled greeting and AI introduction in the page language, built from the business name, both editable. Leaving a field saves it (debounced 600 ms) and shows "Saved".
- Review: cards for hours and first words; a list of answered facts with Edit; a "still missing" list from `missing` with "Add now" (opens that fact as a question) and "Skip"; each conflict shows the current and the new value with "Keep current" and "Use new" (the latter adds the item id to `replace`). One primary button: "Looks right, try a call", which calls `applySetup`.
- Finish: the test panel on the draft; "Publish" enabled after at least one completed test turn in this session; publishing uses the existing `publish`.
- Staff see one message: "Setup is for owners and admins. Ask one of them to finish it." (BM: "Persediaan untuk pemilik dan pentadbir. Minta mereka melengkapkannya.")
- No stage uses a Save button.

- [ ] **Step 1: Write the failing guard test** `tests/local/setup-flow.test.mjs`: the files under `web/components/core/setup/` contain no `"Save draft"`, `"Save knowledge"` or `Save` button labels; every `w(` call in them has two arguments; `web/components/core/local-app.tsx` renders `SetupFlow` for the setup screen.
- [ ] **Step 2: Run** `npm run test:guards`. Expected: FAIL (files missing).
- [ ] **Step 3: Build the screens.**
- [ ] **Step 4: Run** `npm run test:guards && npm run typecheck && npm run build:local`. Expected: PASS, build succeeds.
- [ ] **Step 5: Check in a browser** with the local app (`preview_start` name `web-local-voice`, `http://127.0.0.1:4182`), at 390 px width and at desktop width, in English and BM: create a workspace, complete setup with fake data, close and reopen mid-interview (Review Focus 1), open it as the staff test user (Review Focus 4), publish. Record what was seen in the pull request, with screenshots.
- [ ] **Step 6: Commit** `feat(web): one guided setup flow`

### Task 6: Sidebar and the duplicate entry

**Files:**
- Modify: `web/components/core/chrome.tsx:60-131` and `web/components/product/navigation.tsx:22-23,60`
- Modify: `packages/contracts/src/core.ts`, `web/lib/server/api.ts` (one read-only command)
- Regenerate: `packages/contracts/openapi.json`
- Test: `tests/api/setup.test.ts` (one case), `tests/local/setup-flow.test.mjs` (one case)

**Interfaces:**
- Produces: command `channels` GET `/channels` → `{phone: boolean, whatsapp: boolean, integrations: boolean}`: `phone` is true when the telephony provider is configured and the organization has at least one phone number row; `whatsapp` when the WhatsApp provider is configured; `integrations` is `false` until an integration exists.
- Produces: in local and hosted modes the sidebar leaves out `phone-numbers`, `whatsapp` and `integrations` while their flag is false, and leaves out `setup` once the agent has a published version. The pages stay reachable by URL. Mock mode is unchanged.

- [ ] **Step 1: Write failing tests**: `channels reports false for all three on a fresh workspace`; guard: `chrome.tsx` reads the `channels` command.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate the openapi file.
- [ ] **Step 4: Run** `npm run test:local -- tests/api/setup.test.ts tests/domain/contracts.test.ts && npm run test:guards && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): hide channels that are not connected`

### Task 7: Whole-suite check and documents

**Files:**
- Modify: `AGENTS.md` (current state entry), `.agent/handoff.md` (changed, verified, not verified), `web/README.md` (the setup route), `docs/superpowers/specs/2026-11-14-setup-flow-design.md` (dated note recording the deviation about interview answers and what the import plan must add)

- [ ] **Step 1: Run** `npm run typecheck && npm run test:guards && npm run check:core && npm run db:verify-migrations && npm run build:mock && npm run build:hosted`. Expected: all PASS; record counts.
- [ ] **Step 2: Update the documents.** State plainly what no person has checked.
- [ ] **Step 3: Commit** `docs: guided setup flow`, push, open the pull request. Applying the migration to the staging database is the owner's step (`npm run hosted:migrate`), not part of this plan.
