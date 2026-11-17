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
