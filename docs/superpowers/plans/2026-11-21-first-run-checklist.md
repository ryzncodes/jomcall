# First-run checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One visible list from sign-up to the first real call, shown on Home, in the sidebar and on setup's live page, plus a "Your links" card in setup.

**Architecture:** A new read `firstRun` returns the list's facts in one call. Pure rules in `web/lib/core/home-rules.ts` turn those facts into steps. Home, the sidebar and setup's live page render the same steps through one component. Links are staged through the existing `answerSetup` "missing:" path. Website reading (F12) is not in this plan.

**Tech Stack:** Next.js + TypeScript, `node:test`, Postgres through the existing domain routes.

**Spec:** `docs/superpowers/specs/2026-11-21-first-run-design.md` (pull request #84, branch `docs/first-run-design`).

## Global Constraints

- English and Bahasa Melayu for every string. Build at 375 px first. Light and dark themes.
- No migration. No prompt, pack or tool-list change. The `social_links` label stays as it is.
- No screen states a phone-number wait time (5.6).
- The step names in spec 5.1 are exact:
  - "Set up your business" / "Sediakan perniagaan anda"
  - "Test the agent" / "Uji ejen"
  - "Publish the agent" / "Terbitkan ejen"
  - "Choose a plan" / "Pilih pelan"
  - "Get a phone number" / "Dapatkan nombor telefon"
  - "Take your first real call" / "Terima panggilan sebenar pertama"
- Links card text, exact: "Customers who ask get these links. JomCall does not open or read them." The link checks never fetch.
- File ownership (spec 5.6):
  - Touch: `web/components/core/auth.tsx` only for a redirect (not expected to be needed).
  - Do not touch: `marketing.tsx`, `public-pages.tsx`, `web/content/public/`, `web/lib/site.ts`.
  - `web/messages/*.json` and `web/lib/launch.ts`: add keys only.
- Staff behaviour unchanged: the first three steps only, no sidebar link.

## Review Focus

- **A firstRun read that fails.** Step 6 is hidden and `isLive` falls back to today's rule. Test in Task 2.
- **A workspace already past its first call when this ships.** Home goes straight to Today. The completion line shows at most once per browser. Test in Task 2 (`isLive`).
- **A link pasted with spaces or no scheme** (`facebook.com/kedai `). It is trimmed, `https://` is added and it is stored. A `javascript:` or `ftp:` link is refused. Test in Task 5.
- **Refused and abandoned calls only.** Step 6 stays not done. Test in Task 1.
- **Staff or another organization asking for `firstRun`.** Staff get 403; another organization's calls are never counted. Test in Task 1.

---

### Task 1: The `firstRun` read

**Files:**
- Create: `packages/contracts/src/first-run.ts`, `packages/domain/src/first-run.ts`, `tests/api/first-run.test.ts`
- Modify: `packages/contracts/src/core.ts` (add the route next to `channels`), `web/lib/server/api.ts` (dispatch, beside `phoneRoute`)

**Interfaces:**
- Produces, in `packages/contracts/src/first-run.ts`:
  ```ts
  export type FirstRun = {
    setupApplied: boolean; tested: boolean; published: boolean;
    plan: { chosen: boolean; unpaid: boolean };
    phone: { offered: boolean; active: boolean; activeE164: string | null;
             requestOpen: boolean; planIncludesNumber: boolean };
    firstCall: { id: string; startedAt: string } | null;
  };
  ```
- `firstRun: route("GET", "/first-run", empty, out<FirstRun>())`
- `firstRunRoute(tx, ctx, method, path): Promise<FirstRun | undefined>`. It returns `undefined` unless the request is `GET /first-run`.

- [ ] **Step 1: Write the failing API test** `tests/api/first-run.test.ts`, using `phoneFixture()`:
  - `"first run: a new workspace has nothing done"`: `published false`, `firstCall null`, `phone.active false`.
  - `"first run: an answered real call is the first call; refused and abandoned are not"`. Steps:
    1. publish, add a number, ring twice;
    2. set one call to `state='ended', outcome='abandoned'` and expect `firstCall null`;
    3. set the other to `state='ended', outcome='answered'` and expect `firstCall.id` to equal it.
  - `"first run: staff are refused and another business sees none of it"`: staff `GET /api/v1/first-run` gives 403. orgB's `firstCall` is null.
- [ ] **Step 2: Run** `npm run test:local -- tests/api/first-run.test.ts`. Expected: FAIL (404 or a missing route).
- [ ] **Step 3: Implement `firstRunRoute`.**
  - Call `manager(ctx)` first.
  - `published`: the organization's agent has `published_version_id`. Use the same agent row the workspace read uses.
  - `setupApplied`: an `app.setup_session` row with `state='applied'`.
  - `tested`: any `app.test_session` row.
  - `plan`: from `app_private.plan_summary`. `chosen = plan !== "payg" && periodState in ("free","charged")`; `unpaid = periodState === "unpaid"`.
  - `phone.offered = telephonyReadiness().configured || active`.
  - `requestOpen`: the latest `app.phone_number_request` has `state='open'`.
  - `planIncludesNumber`: `app_private.plan_has_phone_number`.
  - `firstCall`: `select id, started_at from app.call where org_id=$1 and state='ended' and outcome is not null and outcome not in ('refused','abandoned') order by started_at, id limit 1`.
- [ ] **Step 4: Run the test again.** Expected: PASS. Then run `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(home): firstRun read for the getting-started list`.

### Task 2: Checklist rules

**Files:**
- Modify: `web/lib/core/home-rules.ts`, `tests/domain/home-rules.test.ts`

**Interfaces:**
- Consumes `FirstRun` from Task 1.
- Produces:
  - `type StepId = "setup"|"test"|"publish"|"plan"|"phone"|"call"`.
  - `type ChecklistFacts = { manager: boolean; published: boolean; setupApplied?: boolean; tested?: boolean; plan?: FirstRun["plan"]; phone?: FirstRun["phone"]; firstCall?: FirstRun["firstCall"] }`. Here `undefined` means the read failed or was not made, and that step is hidden.
  - `checklistFacts(f: HomeFacts): ChecklistFacts`. `HomeFacts` gains `firstRun?: FirstRun`, which supplies `firstCall`.
  - `stepsFrom(c: ChecklistFacts): Step[]`. `Step` gains `hint?: "plan_first" | "number_first"`.
  - `checklist(f: HomeFacts) = stepsFrom(checklistFacts(f))`, so existing callers and tests keep working.
  - `isLive(f: HomeFacts)` and `liveFrom(c: ChecklistFacts)`.

- [ ] **Step 1: Write failing tests** in `tests/domain/home-rules.test.ts`:
  - `"checklist: call step follows the phone step"`: phone offered and `firstCall: null` gives the last step `{id:"call", state:"todo", href:"/app/phone-numbers"}` when a number is active. With no active number it gives `href:null, hint:"number_first"`.
  - `"checklist: call step done on the first call"`.
  - `"checklist: no call step without a phone line, for staff, or when firstRun failed"`.
  - `"checklist: phone button goes to /app/phone-numbers"`, replacing the `/app/phones` expectation. A plan without a number gives `href:null, hint:"plan_first"`.
  - `"isLive: published, plan and number are not live until the first call"`. It is live with `firstCall` set. With `firstRun` undefined it falls back to today's rule.
- [ ] **Step 2: Run** `npm run test:local -- tests/domain/home-rules.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Step 6 exists only when the phone step exists and `firstCall !== undefined`. `homeState` and `keepLastGood` include `firstRun` in `FETCHED`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(home): step six, first real call, and live after it`.

### Task 3: Home: shared steps, needs under the list, completion line

**Files:**
- Create: `web/components/core/home/steps.tsx`
- Modify: `web/components/core/home/home.tsx`, `web/components/core/home/load.ts`, `web/components/core/home/copy.ts`, `tests/domain/home-load.test.ts`
- Modify: `web/components/core/phone.tsx`: export the local-format helper the forwarding panel uses. This is the only change there.

**Interfaces:**
- `ChecklistSteps({ steps, manager, activeE164 }: { steps: Step[]; manager: boolean; activeE164: string | null })`. It renders the `<ol class="home-steps">` that Home has today, with the words in `copy.ts` (`STEP_WORDS`).
- `loadHomeFacts` adds `read("firstRun", {}, ctx.manager)` and returns `firstRun`.

- [ ] **Step 1: Update** `tests/domain/home-load.test.ts`: the sorted command list includes `"firstRun"`. Staff make no `firstRun` read. Run it; expected FAIL.
- [ ] **Step 2: Implement the load and the component.** Step 6 words:
  - Label: "Take your first real call" / "Terima panggilan sebenar pertama".
  - Under it: "Forward your business number to <local>, then call your usual business number from another phone to check." / "Majukan nombor perniagaan anda ke <local>, kemudian telefon nombor perniagaan biasa anda dari telefon lain untuk menyemak."
  - Button: "Show me how" / "Tunjukkan caranya".
  - Hints: `plan_first` gives "Choose a plan first" / "Pilih pelan dahulu". `number_first` gives "After your number is ready" / "Selepas nombor anda sedia".
- [ ] **Step 3: Render "Needs you" under the list** when `needsYou(facts)` has rows. Reuse the existing section markup.
- [ ] **Step 4: Add the completion line.** In the Today state, when `firstRun.firstCall` is set and browser storage key `jomcall.firstCallSeen.<orgId>` is unset:
  - show "Your agent answered its first real call." / "Ejen anda telah menjawab panggilan sebenar pertamanya.";
  - link it to `/app/calls/<id>`;
  - then set the key.

  Wrap storage in try/catch.
- [ ] **Step 5: Run** `npm run test:local -- tests/domain/home-load.test.ts tests/domain/home-rules.test.ts`, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(home): shared step list, needs under the list, first-call line`.

### Task 4: Sidebar link and setup's live page

**Files:**
- Modify: `web/components/core/chrome.tsx`, `web/components/core/setup/finish.tsx`

**Interfaces:**
- Consumes `stepsFrom`, `ChecklistSteps` and `firstRun`.

- [ ] **Step 1: Add the sidebar link.**
  - Local and hosted modes only. Use `channelClient` and read `firstRun` on load and on window focus, as `channels` is read.
  - On a 403 or an error, show nothing.
  - When `done < total`, show one link above `WorkspaceNavigation` to `href("/app")`: "Getting started: N of M" / "Bermula: N daripada M". Count with `stepsFrom({ manager: true, ...firstRun })`.
- [ ] **Step 2: Live page.** `LiveStage` reads `firstRun` and renders `ChecklistSteps` with the steps whose id is `plan`, `phone` or `call`. These replace the two hand-written plan and phone items, and so the "2 working hours" sentence. The WhatsApp item stays as it is.
  - While loading, show the existing loading text.
  - On an error, keep plain links to Billing and Phone numbers.
- [ ] **Step 3: Run** `npm run typecheck && npm run build:hosted`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(web): getting-started link in the sidebar; live page uses the list`.

### Task 5: Setup: open setup first, type confirmation, paste hint, links card

**Files:**
- Create: `web/lib/core/business-links.ts`, `tests/domain/business-links.test.ts`
- Modify:
  - `web/components/core/local-app.tsx`: after `createOrganization`.
  - `web/components/core/setup/business-type.tsx`
  - `web/components/core/setup/bring.tsx`
  - `web/components/core/setup/review.tsx`
  - `packages/domain/src/setup/questions.ts` and `packages/domain/src/setup/routes.ts`: the "missing:" path.
  - `tests/api/` setup test file: the one holding `answerSetup` tests (find it with `grep -l answerSetup tests/api`).

**Interfaces:**
- `LINK_KINDS = ["website","facebook","instagram","tiktok","linkedin","maps"] as const`
- `normaliseLink(kind, text): { url: string; warning: boolean } | { error: "invalid" | "too_long" } | null`. It returns `null` for empty text.
- `linksToText(links: Partial<Record<Kind,string>>): string`. Output is one `Label: URL` line per kind, in `LINK_KINDS` order. The labels are English: Website, Facebook, Instagram, TikTok, LinkedIn, Google Maps.
- `textToLinks(text: string): Partial<Record<Kind,string>>`. Unknown lines are kept under `website` only when the field is empty.
- `OFFERED_FACTS: ReadonlySet<string>` in `questions.ts`, holding `"every-business:social_links"`.

- [ ] **Step 1: Write failing tests** in `tests/domain/business-links.test.ts`:
  - `"links: bare address gets https"`: `normaliseLink("facebook"," facebook.com/kedai ")` equals `{url:"https://facebook.com/kedai", warning:false}`.
  - `"links: wrong host warns"`: `normaliseLink("facebook","instagram.com/x").warning === true`.
  - `"links: maps hosts"`: `google.com/maps/…`, `maps.google.com/…`, `maps.app.goo.gl/…` and `g.page/…` give no warning.
  - `"links: refused"`: `javascript:alert(1)` and `ftp://x` give `invalid`. Over 300 characters gives `too_long`.
  - `"links: round trip"`: `textToLinks(linksToText(x))` deep-equals `x`.
- [ ] **Step 2: Write a failing API test** `"setup: social links are offered on review"`: `answerSetup` with `questionId "missing:every-business:social_links"` and a fact answer returns 200, and the view has a fact item keyed `social_links`. A `missing:` id for another optional field still gives 404.
- [ ] **Step 3: Run** both tests. Expected: FAIL.
- [ ] **Step 4: Implement the server.** In the `missing:` branch, `listed` is also true when `OFFERED_FACTS.has(packId + ":" + fieldKey)` and the field exists.
- [ ] **Step 5: Implement the card in `review.tsx`.**
  - A `LinksCard` section titled "Your links" / "Pautan anda", with the exact card text and its BM version: "Pelanggan yang bertanya akan diberi pautan ini. JomCall tidak membuka atau membaca pautan ini."
  - Six optional fields. Labels: Website / Laman web, Facebook, Instagram, TikTok, LinkedIn, Google Maps.
  - Values are prefilled from the `social_links` item through `textToLinks`.
  - Each field is checked on change with `normaliseLink`. An error shows inline and that field is not sent. A warning shows "This does not look like a <kind> link." / "Ini tidak kelihatan seperti pautan <kind>."
  - Sending goes through `useAutosave` and `store.write`, calling `answerSetup` with the "missing:" id and the text from `linksToText`. An empty set sends `{kind:"skip"}`.
  - Exclude `key === "social_links"` from the generic "Your answers" list.
  - Place the card after the hours and words cards.
- [ ] **Step 6: Make the rest of the stage changes.**
  - `local-app.tsx`: after `createOrganization` succeeds, `location.assign(href("/app/setup?workspace=" + result.orgId))` replaces `switchWorkspace`.
  - `business-type.tsx`: when `!session && !workspace.agent?.published_version_id && typeIdForSaved(saved)`, the heading is `You picked ${label}. Add anything else you do, or continue.` / `Anda memilih ${label}. Tambah apa-apa lagi yang anda buat, atau teruskan.` The lead line stays.
  - `bring.tsx`: the paste hint becomes "Up to 20,000 characters. Copy the text from your website, Facebook or Instagram page, or Google Maps listing, or cells from a spreadsheet." / "Sehingga 20,000 aksara. Salin teks daripada laman web, halaman Facebook atau Instagram, atau senarai Google Maps anda, atau sel daripada hamparan."
- [ ] **Step 7: Run** both new tests, the existing setup tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(setup): links card, setup first after sign-up, type confirmation, paste hint`.

### Task 6: Checks, browser pass, notes, pull request

- [ ] **Step 1: Run** `npm run typecheck`, `npm run test:guards`, `npm run check:core`, `npm run build:hosted`, `npm run build:mock`. Expected: all pass. The known flickering guard `tests/local/model.test.mjs` "runtime ownership" may fail once; if it does, re-run it alone.
- [ ] **Step 2: Browser pass** in the local app at 375 px, English and BM, light and dark:
  - a new workspace opens setup on the confirmation heading;
  - the links card saves and survives a reload;
  - the live page list after Publish;
  - the sidebar link;
  - Home's list through plan, number and call. Use SQL on the local database only to fake a number and an answered call.
- [ ] **Step 3: Write it up.** Record deviations in `NOTES.md`, add a dated build note at the end of the spec, and add an entry to `.agent/handoff.md`.
- [ ] **Step 4: Ship the branch.** Push the feature branch, open a pull request, and run a final review on a strong model. Merging needs the owner's yes, asked through the orchestrating session.
