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

- Task 3: claims patterns skip a match when a negation word (not, no, never, tidak, belum ...) sits in the 20 characters before it in the same sentence; `free trial` is `strict` (no negation exemption, allowed only by key `faq.trial` or `pricing.trial`). Spec lists no BM patterns; BM equivalents were added where natural.

- Task 4 (home page), deviations and builder calls:
  - The recorded greeting (`public/demo-call/*-0.m4a`, all four languages) also says "this call may be recorded", which contradicts "Calls are not recorded". The call card never plays line 0 and never quotes it; it shows a UI event "Greets the caller and says it is an AI" instead and plays lines 1, 2, 4 and 5 only. Owner step: re-record the four greetings without the recording sentence, then the card can play them.
  - The card's transcript lines are copied into `web/content/public/home.ts` (so the claims test scans them) and a test asserts they equal `web/lib/demo-call.json` clip by clip. The booking-check line reads "Checked bookings: 3 pm is free" instead of the old "Sample calendar checked", to stay clear of calendar-sync wording.
  - The mockup's headline "Every call answered" and the tile "Every call summarised" were not used (the first is the banned "answers every call" reworded; the second has no source). The mockup's "**61* Forward when busy" was wrong: `**61*` is "when you do not answer", `**67*` is "busy" (`phone.tsx`).
  - Forwarding codes are typed in `home.ts` because public code may not import `web/components/core`; a test reads `phone.tsx` as text and checks each code and its meaning are there.
  - Home FAQ question on recording reads "Is there a recording of each call?": the claims regex hits "Are calls recorded?" even as a question. "Does it work on WhatsApp?" became "What about WhatsApp?" for the same reason.
  - `.t-data` gained `word-spacing: -0.25em` (Plex Mono's space is a full cell, so "RM 49" read as two words).
  - Home classes `hero`, `closing` and `text-link` collided with old marketing CSS in `globals.css`; the home uses `home-hero`, `home-closing` and `link-arrow`.
  - `tests/hosting/page-titles.test.ts` (controller ruling): pages under `app/(public)/` and `app/ms/` must export `metadata = pageMetadata(...)`; every other page keeps the `pageTitle(` rule.
  - Industry links point at pages Tasks 6-7 build; until then they 404.
  - Deleting `web/app/page.tsx` leaves stale `.next-*/types/validator.ts` files that fail `tsc`; delete `web/.next-*/types` (build output) once, then builds regenerate them.
  - Fix round 1 (review `task-4-review-1.md`), calls beyond the findings:
    - The bento at 1024 px and up is now calls (rows 1-2) beside booking over price, then forwarding, transfer and honest in three equal tiles, then the languages as one full-width strip; the reviewer's "languages 10/13" option would have left the price tile two columns wide, too narrow for "RM 49" at 56 px.
    - The cycle's pause no longer follows hover or any focus inside the card: the Pause button (its own control) pauses it, and keyboard focus on a language chip or the card off screen still do. With hover and focus pausing, pressing Play left the bar paused while the pointer or focus stayed on the button.
    - Audio: voiced clips chain straight from `ended` (the 300 ms gap timer is gone). The booking check still waits 900 ms on a timer, but loads the next clip at once and calls play() on the same element; WebKit keeps an element unlocked after a tap-started play. Not checked on a real iPhone.
    - The class `usage-bar` collided with `app/remaining.css` (a 20 px top margin, the source of the uneven gap); renamed `usage-meter`.
    - The honest tile gained a foot line ("An agent cannot be published without the AI introduction."), the same claim as the home FAQ answer, to fill the tile's empty lower half.
    - Phones: call rows put the outcome badge under the name (long BM outcomes squeezed the names onto two lines); the call card's side padding is 16 px under 400 px and language chips use 8 px padding under 641 px so both chip rows stay on one line at 360 px.
    - The header language link is `nowrap`; at 1024-1199 px the header row gap and link padding drop one step so the row still fits.
    - Language specimens: the duplicate chip is gone and the Manglish label names it ("Manglish: BM and English, mixed"); labels and lines share rows through subgrid so a wrapped label does not push its line down. Chinese breaks only after words of two or more characters (`Intl.Segmenter` plus `<wbr>`, and `word-break: keep-all`), so 三点吗？ stays whole.
