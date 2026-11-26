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

## 2026-11-21: public pages, merge with main and typecheck fix

- The 13 typecheck errors this branch's notes called a baseline came from this branch. Tests now import `web/lib/public-meta.ts`, `root-meta.ts`, `page-title.ts`, `web/app/robots.ts` and `sitemap.ts`, which imported types from `"next"`; that loads `next/types/global.d.ts`, which makes `process.env.NODE_ENV` read-only across the root typecheck, so unrelated tests that set it failed. The types now come from `web/lib/next-metadata.ts`, which re-exports them from `next/dist/lib/metadata/types/metadata-interface.js` (a deep path inside Next; recheck it on a Next upgrade). Typecheck is 0 errors.
- Merged `main` (#85 first-run checklist, #87 no time promise for a number). Only `.agent/handoff.md` and `NOTES.md` conflicted; both sides kept. The checklist labels moved to `web/components/core/home/copy.ts`, so the panel step test reads them there and expects all six.
- `web/lib/launch.ts` launch notice: transfer is now "to your staff during opening hours" / "kepada staf anda dalam waktu operasi" (was "to your team when needed").

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

## Task 5: pricing, privacy, terms

- Cheapest plan: brief said `payg` at 0 minutes; controller ruling applies. `estimates()` marks the cheapest only among plans with a phone number, tie to the lower fee (0/100/350 -> starter, 400/1000 -> growth). The payg row is shown and says "browser tests only".
- Amounts use `rmExact` ("RM 49.00") in `format.ts`; `rm` (home) unchanged.
- `pricing.trial` was already allowed. The trial answer lives at `faq.trial` (a key the guard already allows); `pricingFaq(locale)` returns the six in page order (trial fifth). The claims test already scans every file in `web/content/public/`, so `pricing.ts` is covered; I added an assertion for it.
- `fillOperator` was duplicated in `public-pages.tsx`; it now re-exports the one in `public/operator.tsx`.
- Self-host note kept (spec: card stays) as a quiet block linking to `/self-host` and the source.
- Added "Prices are in MYR, before SST" (matches the terms text; the old page said "No SST is charged", which the terms contradict). Owner should confirm SST.
- The estimator's slider and box are two views of one value; typing follows the exact number and snaps to the 10-minute step on blur.
- Legal text is rendered verbatim from `legalCopy`. It still says calls "may be recorded", which conflicts with the owner rule "calls are not recorded"; not changed here (legal text is not ours to edit).

## Task 6 (structured data, robots, sitemap, llms.txt)
- Sitemap and `llms.txt` follow `isIndexable()` (ruling), not "hosted": staging gets `[]` and a 404 `llms.txt`. Both still build as static routes.
- The sitemap lists all 25 pages in both languages, including pages Tasks 7-8 have not built yet (they 404 until then); `llms.txt` describes those with their nav label.
- `app/robots.ts`, `sitemap.ts` and `llms.txt/route.ts` import with relative paths (`../lib/site`), not `@/`, because the test runner does not resolve the `@/` alias.
- JSON-LD builders return null with no origin (mock/local); `<JsonLd>` renders nothing for null. `faqLd` needs no origin. Organization and WebSite are in the shell (every public page).
- Existing test "pageMetadata hosted" used a staging origin and expected indexing; it now expects noindex there (spec section 9).
- `page-titles.test.ts` already had the `pageMetadata(` rule from Task 4; unchanged.
- Offer prices are plain decimal strings built from sen; the Growth line in `llms.txt` omits WhatsApp (the banned-claims test reads "WhatsApp agent once ... ready" as availability).

## Task 7: how it works, call forwarding, languages, FAQ, industries
- How it works shows six steps, not the "four" in spec section 5: the brief says to use the section 7 checklist names, which are six (the same as home).
- `page-titles.test.ts` widened: a public page under a `[param]` folder must return `pageMetadata(` from `generateMetadata`; the others keep `export const metadata = pageMetadata(`.
- Extra page components beyond the brief (`pages/how-it-works.tsx`, `call-forwarding.tsx`, `languages.tsx`) on the shared `pages/article.tsx` layout, so the routes stay thin.
- `SampleLine` gained `who: "event"` (a tick such as "Message saved for the mechanic") and an optional `lang`, used for `lang` attributes in the sample call.
- Forwarding: the four codes the app's phone screen shows (`**21*`, `**61*`, `**67*`, `**62*` and their stops), in the app's order; the parity test reads every code pair out of `phone.tsx`. `##002#` (cancel all) is left out because the app does not show it.
- Restaurants: table requests are taken as messages for staff, not booked (bookings are capacity-one, party size is not handled). Car workshops: a message for the mechanic, no booking, no job lookup (`lookup_job_status` is not built). No page promises reschedule or cancel.
- Home and pricing FAQs switched to the shared `FaqList` (question as plain summary text, no heading inside summary).
- Legal pages: the old `.legal-toc` list (and its CSS) is replaced by the shared `Toc`, a `<details>` on phones and a sticky list from 1024 px.
- The FAQ trial answer sits at `faq.groups.price.faq.trial`, so the claims guard's `.faq.trial.` path rule allows it.
- `industries.ts` imports the setup business types from `packages/domain/src/setup/business-types.ts` so each page names the setup type word for word.
- FAQ hub has 22 questions (spec asks at least 18).
- The BM copy passed a pattern scan (no Indonesian words; two fixes) but still needs a native speaker's read.
- Sample calls name car models (Myvi, Saga) as everyday examples; all businesses, people and plates are made up.
- Review round 1: BM uses "temu janji" on the Task 7 pages, as the coordinator ruled; `home.ts` (not this task's file) still says "janji temu" three times and "menyerahkan pemanggil" once, so the site mixes both until home is aligned.
- Review round 1: stylists and visit times are described as added on JomCall's Bookings page ("halaman Tempahan"), the app's own screen name; setup only stores them as fact text.

## Task 8: comparison, trust and guide pages
- Forwarding guide canonical: `/guides/call-forwarding-malaysia` (both languages) points its canonical, alternates and og:url at `/call-forwarding`. The judgement: the codes card, the steps and the stop codes are the same facts as the full page, and spec section 5 bans carrier-specific claims, so honest new text stays well under 60 percent of the body. The page is kept short (what forwarding is, the codes, before you dial, a link to the full guide). Done with an optional `canonical` field in `PUBLIC_PAGES` and `canonicalPage(id)`, read by `pageMetadata`.
- Because of that, the sitemap lists 48 URLs (was 50) and `llms.txt` omits the guide. Two existing tests in `public-site.test.ts` changed on purpose: the sitemap count and the llms "every page listed" loop (now `listed === !canonical`).
- Extra files beyond the brief: `codes-card.tsx` (the forwarding codes card, extracted from `pages/call-forwarding.tsx` and reused by the guide, so no code is typed twice), `pages/trust.tsx`, `pages/guide.tsx`, and `worksheet-math.ts` (the pure arithmetic and clamps; the brief's test imports it so the client island stays thin).
- No concurrency number is stated: `JOMCALL_MAX_CONCURRENT_CALLS` defaults to 1 and is configurable, so the receptionist and answering-service pages say JomCall takes "a limited number of calls at a time" and the next caller hears the line is busy.
- The missed-calls worksheet starts from example figures (10 calls, 30 percent, RM 80) and says above the fields that they are an example to start from, not an average. The fine print says the figure is the visitor's own estimate.
- The receptionist cost sheet starts with an empty cost field and states no difference or saving; it shows the visitor's figure beside JomCall's month at the same minutes (cheapest plan with a phone number, from `estimates`). No salary figure anywhere.
- `rm()` prints no thousands separator (RM 1040.00), as everywhere else on the site; not changed here.
- The trust page is fact rows and the two document links only (binding decision 5). An earlier draft quoted the privacy notice's provider list word for word; it was removed after review because it was not a fact row, the claims guard does not scan `web/messages/legal.ts`, and that legal text names Meta (WhatsApp) and says payments are not live. A fact row in our own words now points to the privacy notice for the providers.
- Index pages (`/compare`, `/guides`) reuse the existing `.index-list` rows through `pages/index-list.tsx`.
- Compare tables are a description list: on phones each cell carries its own visible label; from 768 px the labels move to a header row and the three columns sit side by side. All 20 new routes measured scrollWidth 360 at 360 px.
- The BM copy passed the pattern scan and the "temu janji" rule but still needs a native speaker's read.
- Playwright could only write screenshots inside the main repo (`call-agent/.playwright-mcp/t8/`); they were copied to `output/public-pages/task8-*`.
- Review round 1: `rm()` now prints a thousands separator and a no-break space after RM ("RM 1,040.00"), site-wide. The formatter tests now expect U+00A0.
- Review round 2: that no-break space also reached meta descriptions, FAQ answers (FAQPage JSON-LD) and `llms.txt` (through the page descriptions it quotes; only its plan line used `rmText()`). `plainSpaces()` in `format.ts` now turns it back into a plain space at the three exits: `pageMetadata` (title, description, Open Graph; there are no Twitter tags), `faqLd` plus `ldScriptText` (every structured-data script), and the whole `llmsText()` output. The visible page keeps the no-break space. `describe()` in `llms.ts` is exported so a test can check every page's metadata.
- Review round 1: the worksheet's visible units stay decoration; each label carries the unit for screen readers in a visually hidden span ("(percentage, 0 to 100)"). "(in minutes)" tripped the stated-wait guard, so the minutes unit is said as "(number of minutes)".
- Review round 1: "terbuka kepada umum" (reads as open source) also appeared in `faq.ts` and `pricing.ts` (Task 7 and earlier copy); both now say "tersedia kepada umum", and a test bans "sumber terbuka", "terbuka kepada umum" and "open source" in every public content module.
- Review round 1: "helaian (kira)" became "kalkulator" throughout the BM Tier 2 copy.

## Task 9: auth panel copy, old marketing retired

- Titles use the brief's exact strings ("Log in to JomCall", "Create your JomCall account", BM equivalents) through `pageTitle(` with `absolute: true`, so the tab reads exactly that (the double " · JomCall" suffix was fixed).
- Panel copy lives in the new `web/lib/auth-panel.ts` (no shared message file touched). The old decorative bar lines in the side panel were replaced by the six-step list. `tests/hosting/auth-panel.test.ts` reads `home.tsx` as text and checks the five in-app step names equal the panel's first five; step 6 is checked against the spec's wording (the in-app home has no sixth step entry).
- `PublicPages` in `web/components/public-pages.tsx` now renders only `docs` (the pricing, privacy and terms branches are gone). Still exported and needed: `PublicFrame` (auth, access, platform), `OperatorDetails` (used by `PublicFrame`), `fillOperator` re-export, `PublicPages`.
- `web/components/marketing.tsx` deleted. In `globals.css` removed 179 rule blocks and trimmed 2 selector lists whose selector contained a class used only by the old marketing screen (no importer in any .ts/.tsx, absent from other CSS). Kept on purpose: `@keyframes` that only deleted rules used; `.site-footer-links` rules in `remaining.css`; classes also used elsewhere (`button`, `eyebrow`, `faq`, `hero`, `closing`, `promise`, `site-header`, `site-footer`, `header-actions`, `skip-link`, `text-link`, `workflow`, ...) because the new public CSS or in-app screens still use them.
- `inbox.tsx`, `contacts.tsx`, `whatsapp-settings.tsx`, `lib/api/service.ts`: "marketing" there is the WhatsApp/consent purpose, unrelated; untouched.

## Task 10: BM pass, checks, browser check, docs

- `<html lang>` deviation from the research doc's Tier 0 item 1 ("the server sends the right `<html lang>`"). Next has one root layout (`web/app/layout.tsx`), so every page, BM included, is built with `<html lang="en">`. A BM page instead: sets `lang="ms"` on the public shell and on `<main>` (`web/components/public/shell.tsx`), so the content reads as BM before any script runs; is served with `Content-Language: ms` (`web/next.config.ts`, `/ms` and `/ms/:path*`); and runs the pre-paint script (`web/lib/theme-script.ts`), which sets `document.documentElement.lang` to `ms` on BM public paths. Two root layouts (one per language, through route groups) would send the right `<html lang>` from the server; that was not done on this branch and is left to the final review. The research doc carries a dated amendment.
- BM pass: the two sample-call lines that say "Janji temu" (`sampleCall` line 5 and the bento's booking quote) were left as they are. They are what the recordings in `web/public/demo-call/` say (a test keeps line 5 equal to the clip text), so changing them to the house term "temu janji" would put words in the recording's mouth. Fix with the owner step to re-record the greetings.
- Typecheck: `tests/hosting/auth-panel.test.ts` (commit `c6a0a36`) had added two implicit-`any` errors (TS7022) above the 13-error baseline. Typed the two locals; typecheck is back to 13, all in `tests/`. (Correction, 2026-11-21: those 13 were not a `main` baseline; see the merge note below.)
- Browser check: the hosted build runs under `next start` without hosted services. The one thing that fails is the header's session check, `GET /api/v1/session`, which answers 500 there (no Supabase). In the real hosted app a signed-out visitor gets 401 from the same request, and Chrome logs either as a "Failed to load resource" console entry on every public page. Not changed here (it is the app's auth API, from #81); listed for the final review.

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

## 2026-11-26: AI call summaries (branch `feat/call-summary`)

Deviations from `docs/superpowers/specs/2026-11-26-call-summary-design.md`, each with its reason, and the controller's rulings a reader of the code needs.

- Queue by trigger, not in `agent_call`. Spec 6.2 says `app_private.agent_call` inserts the row. That function is redefined in many migrations; the build queues from an `after update of state on app.call` trigger instead (same pattern as `app_private.follow_up_from_call_turn`), which covers both `call_end` and `maintain`.
- One success rule, not two. Spec 6.3 has two success-word rules. The build implements the stricter phrase guard of the "Guards (builder's call after review)" bullet; the older single-word rule is dropped because a real call never creates a booking. Task 1 updated the spec's text to match.
- PATCH sets each field exactly as given, in both language columns; null means empty. There is no "leave unchanged": the edit form sends all three fields, and a next step of "none" must be expressible. All three null clears the summary. A partial PATCH from another client would blank the fields it left out.
- The browser check of the screens was done by the controller, not the implementer (the implementer's environment may lack the browser pane and the local dev server): 375 px, English light, Bahasa Melayu dark, staff view. English dark, Bahasa Melayu light and desktop width were not checked.
- The paid summary check (`npm run check:call-summary -- --paid`) was not run in the build: it spends on Anthropic and waits for the owner's go-ahead.
- Skip rule (final review ruling, 2026-11-26): a call with 1 completed turn and 15 s or more is summarized when its outcome is `transferred`, `transfer_failed`, `handoff`, `message` or `booking_proposed`; otherwise fewer than 2 completed turns stays `TOO_SHORT`; no completed turn is `NO_TURNS`. Reason: staff cannot read turns, so a one-turn transfer or message call would otherwise show them nothing; the spec's 6.2 has a dated builder's note. The migration was edited in place (it is applied to nothing but the local database) and the function was re-applied locally with psql. The three one-turn paid cases (c03 and c15 `transferred`, c10 `handoff`) now match a production path. `global-constraints.md` in the build workspace still states the old rule; the ruling supersedes it.
- Known limit: names and addresses are kept out of production summaries by the prompt alone. The code guard catches only digit runs, the IC pattern, email addresses and the caller's number; a summary that repeats a caller's name or street is not rejected in production. The paid check does catch them for its 16 made-up cases (each case lists its `forbidden` details), so it measures how often the prompt slips, but it does not protect real calls.
- False-success guard (final review, revised in the guard follow-up 2026-11-26): English and BM phrase families matched after lowercasing and collapsing whitespace. Caught: a booking noun followed directly, or after an auxiliary within three words, by "confirmed", "made", "scheduled", "arranged", "disahkan", "dibuat" or "berjaya" ("booking confirmed", "Booking made for Saturday", "the appointment for Saturday is confirmed", "Tempahan berjaya", "Tempahan dibuat untuk pagi Sabtu"); "confirmed the booking"; "has been booked", "booked for", "booked Saturday"; "telah ditempah"; a message noun followed directly, or after an auxiliary, by "sent", "passed", "forwarded", "relayed", "delivered", "dihantar" or "disampaikan" ("Message passed to staff", "Mesej telah disampaikan kepada staf"); "sent / forwarded the message". The gap between noun and verb never crosses a comma, a sentence break or a joining word (and, dan, then, kemudian, lalu, but, tetapi, so, jadi, or, atau), so "asked for an appointment and confirmed their contact number" passes. Read-back passes: "confirmed the booking request details", "confirmed the appointment time they wanted" (the word after the booking noun is request, details, time, date, day, they, he, she or the caller). Availability passes: a day or time of day (or "it") as the subject of "was booked" or "sudah ditempah", and anything booked followed by ", so" or ", jadi" ("Saturday was booked, so the caller asked for Sunday"); "slot" is not in that subject list, because "Slot sudah ditempah" stays a claim. Spans removed first: questions and conditions up to the end of the clause ("asked whether the booking was confirmed", "sama ada tempahan telah disahkan", "if the booking is confirmed"), requests ("asked to be booked", "asked for an appointment to be scheduled", "wanted a message passed to the manager", "asked to have a message sent", "minta untuk ditempah"), pending and negated forms ("to be confirmed", "not been booked", "akan dibuat", "belum disahkan"), "fully booked", "booked up". A claim written inside a question or condition clause ("asked whether …, booking confirmed" with a comma) is not caught; a claim after a full stop or semicolon is. "Pesanan" and "tempahan" also mean "order" in BM, so "pesanan yang dihantar" (the order delivered) passes. Still left to the prompt: claims in other words ("all set for Saturday", "staff will see you then", "sudah beres"), a claim after "and" or a comma that does not repeat the booking noun ("asked for a booking and it was confirmed" passes; "…, and the booking was confirmed" is caught), and claims with no booking or message noun ("confirmed for Saturday"). "The slot was booked" without "so" is caught, even when it means availability. The regexes are bounded (no nested unbounded repeats); about 0.08 ms per summary field on 500-character adversarial text. The Mandarin phrases stay substrings.
