# Implementation notes

## 2026-10-22 — product rename

- Deviation: renamed `supabase/roles.sql` to `supabase/auth-grants.sql`. The Supabase CLI applies a file at exactly `supabase/roles.sql` automatically when it creates a new database, before migrations run. The file grants on roles that migrations create, so every fresh `npm run local:start` failed with `role "..._authz" does not exist`. Existing developer databases were created before the file was added, which hid the bug. `scripts/local/migrate.mjs` and `migration-check.mjs` already apply the grants after migrations, so only the file name changed.

## 2026-11-17: one-page agent screen (branch `feat/agent-page`)

Deviations from `docs/superpowers/plans/2026-11-16-agent-page.md`, each with its reason.

- Second pin edit. The plan allowed one pin edit (`tests/engine/phone-call.test.ts`). Draft test sessions now carry `hours`, so the hours heading assertion in `tests/api/knowledge-core.test.ts` changed too. The owner approved it on 2026-11-17.
- "Other branches" line is capped. The plan capped only the per-branch hours. With 40 branches the uncapped line broke the local model's input budget, so the line counts inside the hours cap and ends "and N more".
- Owner rules are matched by kind plus text, not text alone. An owner can change a rule from "must" to its opposite without changing the text; matching by text alone showed no change.
- An unknown gap status is refused with 422, not 400. The codebase maps every validation error to 422.
- `CHANGES_MOVED` copy lives in the shared code table in `web/components/core/state.tsx`, not `error-copy.ts`, which holds only per-screen overrides. Hours copy is in an "hours" context in `error-copy.ts`.
- Save queue retries: 500 ms, 2 s, 5 s, then the error (four attempts). The plan's test name said "three lost answers".
- Extra files: `web/components/core/agent/settings-sync.ts`, `schedule-sync.ts`, `hours-week.tsx`, `save-line.tsx`, `published.tsx`, and `web/lib/core/queued-write.ts`. The plan put this logic in `store.tsx` and `hours.tsx`; it moved into framework-free modules so `node:test` can reach it.
- Branch name, address and state editing moved into Settings, Business. The plan said it "stays in Settings", but it had lived only inside the deleted hours screen.
- `BOOKINGS_AFFECTED` names no number of bookings. Spec 5.3 asks for the count; the server does not send one and this plan has no server change for it. Open for the owner.
- After `publish` and after a saved gap answer the page takes "revision plus one", not a revision read back from the draft. The plan said to read it back; a read after the commit could pick up another tab's later save and let the next autosave overwrite it silently.
- A gap save refused only because the question was asked again (each ask moves the gap's revision) is retried once with the fresh revision. The plan treated every such refusal as "already handled".
- Gap answer drafts and unsaved hours live in the page store, so they survive moving between views. The plan kept them in each view.
- The unrendered gap section of `KnowledgeCoreEditor` was deleted. It copied the customer's wording into a fact title (against decision D9) and was on by default.
- The hours change list also compares which branch is the main branch.
- Staff see read-only hours under the published summary, because staff could read `/app/hours` before.
- Next was upgraded from 16.4.1 to 16.4.6 on this branch (owner instruction, 2026-11-17). Next 16.4.1 ended its own build with a security notice.
- One extra fix commit after the single planned fix wave (`6079064`): two small defects the fix wave itself introduced. It was checked by the controller and by tests, not by a separate reviewer.

## 2026-11-21: first-run checklist (branch `feat/first-run-checklist`)

Deviations from `docs/superpowers/plans/2026-11-21-first-run-checklist.md` and the design `docs/superpowers/specs/2026-11-21-first-run-design.md` (pull request #84), each with its reason.

- **Link checks run in the browser only.** Design 5.2a says the checks are made "in the web service". The links are stored as the text of an ordinary fact through `answerSetup`. That command already stores any owner text for any fact, so a check on the server would only guard this one field. Nothing opens a link on either side.
- **Home keeps its own reads and adds `firstRun`.** The other steps still come from Home's existing reads; only `firstCall` comes from `firstRun`. The sidebar and the live page use `firstRun` alone. Both feed `stepsFrom()`, and a test pins that both give the same list for the same facts.
- **`localNumber()` moved to `web/lib/core/phone-format.ts`.** The forwarding panel in `phone.tsx` now calls it. That is the only change to `phone.tsx`; the forwarding codes stay there.
- **Live page lead line.** "Three steps put it in front of real customers" became "These steps put it in front of real customers". The number of steps now varies by workspace.
- **"Something else" on the confirmation heading.** The heading names the owner's own words, not the "Something else" label.
- **Workspace creation.** The move to setup is a full page load to `/app/setup?workspace=<id>` from `local-app.tsx`. `auth.tsx` is untouched.
- **Home counts an active number as a phone line.** The firstRun read already did. Without it, Home showed Today while the sidebar showed 5 of 6 on a workspace with no phone service configured (the local app). Found in the browser pass.
- **The links card handles flagged and conflicting rows itself.** The design moved the links out of the answers list, but that list held the Confirm and keep-or-use-new controls. The card now draws both. Found by the branch review.
- **The first real call is the first ended call with `answered_at` set, unless refused.** The plan used the outcome. A worker crash marks an answered call `abandoned`, which would have left step six open. Found by the branch review.
- **Known, left as is.**
  - If the firstRun read fails on the very first load of Home, a workspace with a number shows Today and then the checklist about 15 seconds later. After one good read, the last good value holds.
  - Two existing screens still state a wait for a number: the plan card (`plan-card.tsx`) and the request panel (`phone.tsx`), "within about 2 working hours". This branch does not own them; they predate it.
