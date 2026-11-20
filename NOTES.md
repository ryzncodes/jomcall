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

## 2026-11-21: public pages, Task 2 (branch `feat/public-pages-seo`)

Deviations from the Task 2 brief and spec section 6, each with its reason.

- Two more font files. `PublicSans.ttf` and `IBMPlexMono.ttf` are static 400 files, so the spec's weight 500 (labels, data) would render at 400. Added `PublicSans-Variable.ttf` (OFL, `ofl/publicsans` in google/fonts) and `IBMPlexMono-Medium.ttf` (OFL, `ofl/ibmplexmono`); the existing OFL texts cover them (same licence, whitespace-only differences). The old files stay because `globals.css` uses them.
- Theme order follows the spec, not the brief: a valid `?theme` wins and is stored ("honoured once (and stored)"), then the stored choice, then the operating system. The brief listed the stored choice first.
- The pre-paint script acts only on public paths (from `PUBLIC_PAGES`, both languages). On `/app`, `/login` and `/signup` the app still takes its theme from `?theme`; a stored public choice there would flash dark before the app's own effect reset it. Until Tasks 4 and 5 replace the old `/`, `/pricing`, `/privacy` and `/terms` Experience screens, those four can still flash when the stored choice differs from their `?theme`.
- Fonts live on the public shell, not on `<html>` (fix round 1): the font variables are set on `#public-root` and named `--kaunter-font-*`, because app CSS already reads `var(--font-mono)`. Only `shell.tsx` imports `lib/fonts.ts`, so app routes preload none of them. Only Familjen Grotesk is preloaded; all three swap over a size-adjusted Arial fallback.
- The header call to action uses a short label on phones ("Workspace" / "Ruang kerja" when signed in), and every state of the button reserves the width of the other state's label, so it neither jumps nor overflows at 360 px (fix round 1).
- `legacyRedirect` keeps `?theme` and drops only `lang` (controller ruling, fix round 1), so a theme from the app is honoured once and stored.
- `THEME_KEY` lives in `web/lib/theme-key.ts` so client code can read it without pulling the page registry (and `hosting.ts`) into the browser bundle.
- Nav data (header menus, footer groups, language link) lives in `web/components/public/nav.ts`, a plain module, so tests check it without loading client components.
- `fillOperator` is written again in `web/components/public/operator.tsx`; the copy in `public-pages.tsx` is a client module and stays until that file is removed.
- The mobile menu uses `@radix-ui/react-dialog` (already a dependency) for the focus trap, Escape and focus return; its portal mounts inside `#public-root` so the scoped tokens apply.
