# Home Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local and hosted app's Home with a checklist before the agent is live, and a Today line plus a "Needs you" list after.

**Architecture:** Pure rules in `web/lib/core/home-rules.ts` turn a `HomeFacts` record into checklist steps, the Today line and the Needs you rows. A loader reads each existing core command separately and leaves a field `undefined` when its read fails. A client component renders the result and replaces the Home branch in `web/components/core/local-app.tsx`.

**Tech Stack:** Next.js + React + TypeScript, `node:test` through `tsx`, existing `HttpCoreClient`, Phosphor icons already in the web app.

**Spec:** `docs/superpowers/specs/2026-11-20-home-today-design.md`

## Global Constraints

- No new backend command, route or migration. Only commands in `packages/contracts/src/core.ts` today.
- "Today" is the `Asia/Kuala_Lumpur` calendar day.
- Calls: `calls` with `limit: 100`, filtered on the page; not answered means `state === "refused"`.
- Bookings to confirm: `status: "requested"`, from now to 30 days ahead.
- Billing rows and the plan and phone steps: owners and admins only (`workspace.role !== "staff"`).
- A failed read hides only its own step or row and never shows mock data. All reads failed: one line and a Retry button.
- Live: agent published, and an active phone number or no phone line offered (`channels.phone === false` and `phoneNumbers.provider.configured === false`; for staff, `channels.phone === false` alone).
- WhatsApp is never a checklist step while `WHATSAPP_WAITING_FOR_META` (`web/lib/launch.ts`) is true.
- English and Bahasa Melayu for every string; amounts as `RM 42.10` from integer sen; 375 px first; dark theme through existing tokens.
- Mock preview (4181) keeps its own Home; this change touches only the local and hosted app.
- Write files through python heredocs (a hook blocks em and en dashes).

## Review Focus

- A staff member: no billing rows, no plan or phone step, no 403 shown as an error. Test in Task 1 (`checklist` and `needsYou` with `manager: false`).
- A call that started 23:30 KL yesterday (15:30 UTC) is not counted today; one at 00:10 KL today (16:10 UTC the day before) is. Test in Task 1 (`todayCounts`).
- Phone line not offered on the service: no phone step, and publishing alone makes the workspace live. Test in Task 1 (`isLive`).
- An open number request: the phone step shows waiting with no button and does not count as done. Test in Task 1 (`checklist`).
- Every read fails: Retry line, not an empty "All clear". Test in Task 1 (`homeState`).

---

### Task 1: Home rules

**Files:**
- Create: `web/lib/core/home-rules.ts`
- Test: `tests/domain/home-rules.test.ts`

**Interfaces:**
- Consumes: types `Wallet`, `PlanSummary`, `PhoneNumbers`, `Channels`, `CallSummary`, `Booking`, `ConversationSummary`, `KnowledgeGap`, `TestSession`, `Setup` from `@jomcall/contracts` (or the relative paths `plan-rules.ts` uses).
- Produces:
  - `type HomeFacts = { manager: boolean; published: boolean; setup?: Setup; tests?: TestSession[]; plan?: PlanSummary; wallet?: Wallet; phones?: PhoneNumbers; channels?: Channels; calls?: CallSummary[]; bookingsToday?: Booking[]; toConfirm?: Booking[]; chats?: ConversationSummary[]; gaps?: KnowledgeGap[] }` (a field is `undefined` when its read failed or was not made).
  - `type StepId = "setup" | "test" | "publish" | "plan" | "phone"`; `type Step = { id: StepId; state: "done" | "todo" | "waiting"; href: string | null }`.
  - `checklist(f: HomeFacts): Step[]`
  - `isLive(f: HomeFacts): boolean`
  - `klDayRange(now: Date): { from: string; to: string }` (ISO instants for KL midnight to next KL midnight)
  - `todayCounts(f: HomeFacts, now: Date): { calls: number | null; missed: number | null; bookings: number | null; balanceSen: number | null }` (`null` when its source is missing or the viewer is staff for balance)
  - `type NeedId = "wallet_exhausted" | "wallet_grace" | "plan_unpaid" | "wallet_low" | "bookings" | "chats" | "gaps"`; `type Need = { id: NeedId; count: number; href: string; date?: string }`
  - `needsYou(f: HomeFacts): Need[]` (spec order, zero counts dropped)
  - `homeState(f: HomeFacts): "failed" | "checklist" | "today"` (`failed` when every fetched field is `undefined`)

- [ ] **Step 1: Write the failing tests** in `tests/domain/home-rules.test.ts`:
  - `checklist: new owner` gives ids `["setup","test","publish","plan","phone"]`, all `todo`, hrefs `/app/setup`, `/app/test`, `/app/agent`, `/app/billing`, `/app/phones`.
  - `checklist: setup done by applied session or by publish`: `setup.session.state "applied"` gives `setup` done; `published: true` with `setup` undefined also gives done.
  - `checklist: test done` when `tests` has one session.
  - `checklist: plan done` for `periodState "free"`, `"charged"`, and for `plan: "payg"`; `todo` for `"none"` and `"unpaid"`.
  - `checklist: phone waiting` when `phones.request.state === "open"` and no active item: `state "waiting"`, `href null`. An item with `active: true` gives done.
  - `checklist: no phone line` (`channels.phone false`, `phones.provider.configured false`) leaves out `phone`.
  - `checklist: staff` (`manager false`) gives only `setup`, `test`, `publish`, each with `href null`.
  - `checklist: failed read` with `plan` undefined leaves out `plan`.
  - `isLive`: false unpublished; true published with active number; true published with no phone line; false published with only an open request.
  - `klDayRange(new Date("2026-11-20T03:00:00Z"))` equals `{ from: "2026-11-19T16:00:00.000Z", to: "2026-11-20T16:00:00.000Z" }`.
  - `todayCounts` at `2026-11-20T03:00:00Z`: calls started `2026-11-19T15:30:00Z` (excluded) and `2026-11-19T16:10:00Z` with `state "refused"` (included) gives `calls 1, missed 1`; `balanceSen` is the wallet's for a manager and `null` for staff; `calls null` when `calls` undefined.
  - `needsYou` order: wallet `exhausted` then `bookings` (2) then `chats` (1) then `gaps` (3); wallet `ok` and zero counts give no row; `plan_unpaid` carries `date` = `graceUntil`; staff get no billing rows even with wallet `exhausted`.
  - `homeState`: all fetched fields undefined gives `"failed"`; unpublished gives `"checklist"`; live gives `"today"`.

- [ ] **Step 2: Run to see them fail**

Run: `npm run test:local -- tests/domain/home-rules.test.ts`
Expected: FAIL, cannot find module `home-rules.ts`.

- [ ] **Step 3: Implement `web/lib/core/home-rules.ts`** with the signatures above. No React, no fetch. Reuse `klDate` from `web/lib/core/plan-rules.ts` for KL days. Wallet row picks one of `wallet_exhausted`, `wallet_grace`, `wallet_low` by `wallet.state`; `plan_unpaid` when `plan.periodState === "unpaid"`.

- [ ] **Step 4: Run to see them pass**

Run: `npm run test:local -- tests/domain/home-rules.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add web/lib/core/home-rules.ts tests/domain/home-rules.test.ts
git commit -m "feat(home): rules for the checklist, today line and needs list"
```

### Task 2: Loader and Home screen

**Files:**
- Create: `web/components/core/home/load.ts`, `web/components/core/home/home.tsx`
- Modify: `web/components/core/local-app.tsx` (the `screen === "home"` branch and the channels `useEffect` that only feeds it), `web/app/core.css` (new `.home-` rules; remove `.core-overview` rules only if nothing else uses them)
- Test: `tests/domain/home-load.test.ts`

**Interfaces:**
- Consumes: Task 1's `HomeFacts`, `checklist`, `isLive`, `klDayRange`, `todayCounts`, `needsYou`, `homeState`; `useCore()` context (`client`, `workspace`, `epoch`, `refresh`); `w(en, ms)` and `href()` as `local-app.tsx` uses them; `formatSen` or the existing RM formatter used by the billing screen.
- Produces:
  - `loadHomeFacts(client: { execute(name: string, input: object): Promise<unknown> }, ctx: { manager: boolean; published: boolean; agentId: string | null }, now: Date): Promise<HomeFacts>` (all reads in parallel with `Promise.allSettled`; manager-only reads `wallet`, `plan`, `phoneNumbers` skipped for staff; `knowledgeGaps` skipped without an agent id)
  - `export function LocalHome(): JSX.Element` in `home.tsx`

- [ ] **Step 1: Write the failing loader tests** in `tests/domain/home-load.test.ts` with a fake client recording calls:
  - Manager: calls `setup`, `agentTests`, `plan`, `wallet`, `phoneNumbers`, `channels`, `calls` (`{ limit: 100 }`), `bookings` twice (today's `klDayRange` without status; `{ status: "requested", from: now, to: now + 30 days }`), `conversations` (`{ attention: "needs" }`), `knowledgeGaps` (`{ id: agentId, status: "open" }`).
  - Staff: never calls `plan`, `wallet` or `phoneNumbers`.
  - A rejected `wallet` leaves `wallet` undefined and keeps the other fields.
  - `bookingsToday` drops `status "cancelled"`; `calls` is `Page.items`.

- [ ] **Step 2: Run to see them fail**

Run: `npm run test:local -- tests/domain/home-load.test.ts`
Expected: FAIL, cannot find module `load.ts`.

- [ ] **Step 3: Implement `load.ts`** to the signature above.

- [ ] **Step 4: Run to see them pass**

Run: `npm run test:local -- tests/domain/home-load.test.ts tests/domain/home-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Build `LocalHome`** in `home.tsx`, reloading on `epoch`:
  - Heading eyebrow is the workspace name. Title: checklist state "Get your agent answering" / "Sediakan ejen anda untuk menjawab", with "N of M done" / "N daripada M selesai"; today state "Today" / "Hari ini".
  - Step labels: Set up your business / Sediakan perniagaan anda; Test the agent / Uji ejen; Publish the agent / Terbitkan ejen; Choose a plan / Pilih pelan; Get a phone number / Dapatkan nombor telefon. Buttons: Setup / Persediaan; Try it / Cuba; Publish / Terbitkan; Choose plan / Pilih pelan; Request number / Minta nombor. Waiting: "Waiting for your number" / "Menunggu nombor anda". Done steps show a Phosphor `CheckCircle`, todo a `Circle`, waiting a `Clock`.
  - Today line items that are `null` are left out.
  - Need rows (count plus sentence, whole row a link with a `CaretRight`): wallet exhausted "Wallet empty: calls are not answered" / "Dompet kosong: panggilan tidak dijawab"; wallet grace "Wallet below zero: top up soon" / "Baki dompet di bawah sifar: tambah nilai segera"; plan unpaid "Plan fee unpaid: pay by {date}" / "Yuran pelan belum dibayar: bayar sebelum {date}" (date through `dayText`); wallet low "Wallet low: {RM}" / "Baki dompet rendah: {RM}"; bookings "{n} bookings to confirm" / "{n} tempahan perlu disahkan"; chats "{n} WhatsApp chats waiting for you" / "{n} sembang WhatsApp menunggu anda"; gaps "{n} questions the agent could not answer" / "{n} soalan yang ejen tidak dapat jawab". Hrefs `/app/billing`, `/app/bookings`, `/app/inbox`, `/app/agent#questions`.
  - Empty list: "All clear" / "Semua beres".
  - `failed`: "Home could not load." / "Laman utama tidak dapat dimuatkan." with a Retry / Cuba lagi button calling `refresh`.
  - While loading show the heading only, no zero numbers.

- [ ] **Step 6: Swap it in.** In `local-app.tsx` the `screen === "home"` branch renders `<LocalHome />`; delete the channels effect, `channelText` and the now-unused imports. Keep `channel-line.ts` (tests and `agent/home.tsx` use it). Check `/app/agent#questions` matches the agent page's anchor; if it differs, use the agent page's anchor.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run test:guards && npm run test:local -- tests/domain/home-rules.test.ts tests/domain/home-load.test.ts tests/domain/error-copy.test.ts && npm run build:hosted && npm run build:mock && npm run build:local`
Expected: all pass; `build:local` last.

Then, in the local app at `http://127.0.0.1:4182` with a made-up workspace: a new owner sees five todo steps; a staff view shows three; 375 px, BM and dark theme have no overflow.

- [ ] **Step 8: Commit**

```bash
git add web/components/core/home web/components/core/local-app.tsx web/app/core.css tests/domain/home-load.test.ts
git commit -m "feat(home): checklist before live, today and needs list after"
```
