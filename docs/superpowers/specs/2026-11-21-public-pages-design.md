# Public pages: search, answer engines and the Kaunter redesign

Date: 2026-11-21. Status: draft for the owner's approval.
Research and ranked page list: `docs/research/2026-11-21-public-pages-seo.md`
(referred to below as "the research").

## 1. Intent

The owner feels JomCall's public pages are shallow and do poorly in search
engines (SEO), answer engines (AEO: Google's AI answers, Perplexity) and
generative engines (GEO: ChatGPT, Claude, Gemini). Competitors have hundreds
to thousands of pages; JomCall has three (home, pricing, legal), all of them
rendered in the browser, with BM only through `?lang=ms`, and no robots,
sitemap, canonical, hreflang, structured data or `llms.txt`.

The owner wants:

- the page set competitors use, where it fits JomCall (approved: Tiers 0, 1
  and 2 of the research, about 20 pages in English and BM);
- the public flow to match what owners have seen elsewhere ("we need to be
  the same as the current market flow or else it'll be awkward for people to
  onboard");
- award-level visual design. Of three mockups the owner picked direction A,
  "Kaunter", on 2026-11-21.

Success: every public page is built as static HTML in both languages, each
page answers one question clearly enough to be quoted, search engines can
find every page from the sitemap, and the site looks clearly better than
today, with the same brand.

## 2. Goals, non-goals, anti-goals

Goals:

- Tier 0 technical base, Tier 1 and Tier 2 pages (section 5), EN and BM.
- The visitor-flow fixes in research section 5.3, except the demo line,
  which the owner dropped.
- Direction A visual system (section 6) on every public page.
- Static rendering, fast pages, and accessible markup.

Non-goals:

- `/app`, the in-app screens, and the auth forms' fields and checks. Only
  the auth pages' side-panel copy and titles change.
- Google sign-in, building the agent from a website, a first-run checklist
  (separate work; a sibling session is on onboarding).
- Named "JomCall vs [rival]" pages, integrations, case studies, area-code
  pages, glossary, a big blog (research section 4, "Left out").
- Privacy and Terms legal text: unchanged, only re-hosted in the new shell.

Anti-goals (a failure even if everything builds):

- Any claim JomCall cannot back today (section 3). Specifically, the site must never say
  or imply: calls are recorded; WhatsApp is live (it is waiting for Meta's
  approval, `WHATSAPP_WAITING_FOR_META`); there is a free trial; Tamil is
  supported; calendar sync exists; transfer is anything but a blind transfer
  during opening hours; JomCall is "PDPA compliant" (the cross-border
  decision is open); the owner is notified instantly of each booking (not
  verified to exist, so not claimed).
- Real customer data, testimonials, logos or names. Every sample business,
  caller and call is made up and labelled so.
- Copy, names, layout or assets taken from competitors. Reference sites gave
  measured sizes only (research 6.3).
- A public page that silently renders dynamically or on the client.

## 3. Facts the copy may use

Owner decision, 2026-11-21 (final, replacing an earlier answer): the site
may claim **everything that is built**, even before a real customer has
used it. Every claim still traces to a source in this table, and the
anti-goals in section 2 stand in full.

| Claim | Source |
|---|---|
| Answers phone calls on a JomCall number, day and night, with an AI that says it is an AI | Phone line live since the phone-first launch (2026-11-20); disclosure required to publish |
| Speaks BM, English, Manglish and Mandarin, following the caller | Spoken path; `public/demo-call/{ms,en,manglish,zh}-*.m4a` |
| Answers questions from the business's own facts and price list | Knowledge core |
| Books appointments into JomCall's bookings, with the time read back to the caller | Bookings; read-back enforced before a booking is recorded |
| Takes messages for the team | take_message |
| Passes the caller to your staff during opening hours (a blind transfer) | Phone line, transfer tool |
| Keep your number: forward its calls to your JomCall number (`**21*`, `**61*`, `**67*`, `##21#`) | `web/components/core/phone.tsx:286-288` (the single source) |
| You request a JomCall number in the app; a person sets it up. No wait time is ever stated; reuse `launchCopy` | Phone number request flow (#64), `web/lib/launch.ts` |
| From RM49 a month, prepaid MYR wallet, no card charged automatically | `web/lib/pricing.ts`, `launchCopy` |
| Calls are not recorded | Owner rule for this work |
| Export and delete a contact's data | Contacts PDPA actions |
| Setup: pick a business type, answer up to 8 questions, or bring a price list as a photo, PDF, CSV file or pasted text (no Excel files); review, test in the browser, publish | Guided setup (#24); import door, `JOMCALL_SETUP_READER=anthropic` in production (owner, 2026-11-21) |
| Source code is public under FSL-1.1-ALv2 | `LICENSE.md` |
| Sign-up is self-serve | `AGENTS.md`, 2026-11-20 |
| Where data is stored and which providers receive it | The privacy notice (`@/messages/legal`), quoted, not restated |
| WhatsApp: waiting for Meta's approval | `whatsappWaiting` copy |

Not claimed until it has merged: reading the owner's website (approved,
first-run's later PR) and the "Your links" card (then only as "Add your
website and social links; customers who ask get them.").

Banned outright (the test fails on them): "never miss a call", "unlimited
calls", "answers every call", "answers many calls at once" (the service
takes 2 at a time today), any stated wait for the phone number ("within 2
hours", "in minutes"), any claim that JomCall imports or reads your
website, Facebook, Instagram or Google Maps, "calls are recorded", "free
trial" (outside the FAQ answers saying there is none), "PDPA compliant",
Tamil listed as supported, "calendar sync" or syncing with Google
Calendar, a transfer described as anything but passing the call to staff
during opening hours, instant booking alerts to the owner, WhatsApp as
available.

## 4. Approaches considered

Routing and rendering (owner left the how to me; my calls):

1. **Keep `Experience` and add pages to it.** Cheapest, but `Experience`,
   `Controls`, `Brand` and `href()` read `useSearchParams`, so every page
   renders on the client behind Suspense and stays `no-store`. Defeats the
   goal. Rejected.
2. **Two root layouts** (route groups `(en)` and `(ms)` with their own
   `<html lang>`). Correct `lang` from the server, but every existing route
   moves under a group, the experimental `globalNotFound` flag is needed, and
   every open branch touching `web/app` conflicts. Rejected for now.
3. **Chosen: one root layout, a new server-rendered public shell.** New
   server-component pages under `web/app/(public)/` for English and
   `web/app/ms/` for BM, sharing one set of page components that take a
   `locale` prop. Typed EN/BM content modules. Small client islands only for:
   theme toggle, mobile menu, the pricing estimator, the call demo, and the
   signed-in button. The old `Experience` path stays for `/app`, login,
   sign-up, forgot, invite, `/docs` and `/self-host`.

   Correct language without a second layout:
   - `next.config.ts` `headers()` sends `Content-Language: ms` for `/ms` and
     `/ms/:path*` (works with static pages);
   - the BM pages wrap content in `<div lang="ms">`;
   - a tiny inline script in the root layout sets `documentElement.lang`
     from the path before paint; `<html>` gets `suppressHydrationWarning`.

   Deviation from the research: Tier 0 item 1 says "the server sends the
   right `<html lang>`". The server sends `Content-Language` and a `lang`
   wrapper instead; the `<html>` attribute is set before paint. Record this
   in the research doc and `NOTES.md`. Revisit two root layouts when no
   other branch is open on `web/app`.

Visual direction: three mockups shown on 2026-11-21 (A Kaunter, evolve the
current brand; B Suara, new voice-first identity; C Kedai, shop-signboard
look). The owner picked **A**.

## 5. Pages

All pages exist at `/<slug>` (English) and `/ms/<slug>` (BM), same slugs.
Each page: unique title and description, canonical, hreflang `en`, `ms`,
`x-default` (English), Open Graph, `BreadcrumbList` (inner pages), one H1,
a direct first sentence under each question heading.

Tier 0 (base):

- Static rendering for every page above; the build's route table shows each
  as static (○ or ●), never ƒ.
- `web/proxy.ts`: a 301 from public pages with `?lang=ms` to `/ms/...`
  (dropping `lang` and `theme`); `?lang=en` drops the parameter. `/app`,
  auth pages, `/docs`, `/self-host` keep `?lang`.
- `app/robots.ts`, `app/sitemap.ts`, and `app/llms.txt/route.ts`: hosted
  build only (`notFound()` or empty in mock and local, which stay
  `noindex`). Robots disallows `/app`, `/api`, `/invite`, `/login`,
  `/signup`, `/forgot-password`, `/open-link`, `/admin`. The sitemap lists
  every public page in both languages with `alternates.languages`.
  `llms.txt` lists every page with a one-line summary, then the key facts
  from section 3.
- JSON-LD: `Organization` and `WebSite` site-wide; `SoftwareApplication`
  with MYR `Offer`s (from `publicPlans`) on home and pricing; `FAQPage`
  where a page has questions; `BreadcrumbList` on inner pages.

Tier 1:

| Path | Content |
|---|---|
| `/` | Home, in market order (section 7) |
| `/pricing` | Plans from `publicPlans`, minutes estimator (`monthlyEstimateSen`), rates from `publicPrices`, pricing FAQ, `Offer` JSON-LD. Plan button: sign-up for visitors, Billing when signed in. |
| `/how-it-works` | The four steps, what the owner does at each, a link to the forwarding guide |
| `/call-forwarding` | Forwarding guide: what `**21*`, `**61*`, `**67*` and `##21#` each do, when to pick which, mobile vs office line in general terms. No carrier-specific claims beyond what the app states. |
| `/languages` | BM, English, Manglish, Mandarin; how it follows the caller; a made-up mixed-language sample; what it does not do (no Tamil yet) |
| `/faq` | About 20 questions in groups: price and billing, number and forwarding, languages, what the AI does and does not do, privacy, WhatsApp status. `FAQPage`. |
| `/industries` | Index of the six industry pages |
| `/industries/clinics`, `/salons`, `/car-workshops`, `/aircond-home-repair`, `/restaurants`, `/tuition-centres` | Each: the calls this business gets, what JomCall does with each, a made-up sample call, how setup fits (the matching setup business type), FAQ. Booking-led pages may claim bookings (section 3). |

Tier 2:

| Path | Content |
|---|---|
| `/compare` | Index |
| `/compare/voicemail`, `/compare/receptionist`, `/compare/answering-service`, `/compare/whatsapp-bot` | Fair category comparisons: when each option is better, a factual table. No named rivals. A receptionist's cost appears only as a cited MYR figure (source and date on the page) or as an input the visitor types. |
| `/trust` | Facts only (section 3): not recorded, AI disclosure, where data is stored, export and delete, public source, links to Privacy and Terms. No "PDPA compliant". |
| `/guides` | Index |
| `/guides/what-is-an-ai-receptionist`, `/guides/missed-calls-cost`, `/guides/call-forwarding-malaysia` | Evergreen guides. The missed-calls guide is a worksheet the visitor fills in, no invented statistics. The forwarding guide may share content with `/call-forwarding` and must canonicalise or differ enough to justify both; builder's call. |

Existing `/privacy` and `/terms` move into the new shell with unchanged
text from `@/messages/legal`.

Total: 25 paths in each language, 50 pages. Auth pages are not in the set
(they keep `?lang` and stay out of search).

## 6. Visual system: direction A, "Kaunter"

Keeps the brand people have seen (forest, sage, paper) and fixes what the
research found (6.1): one rhythm, small low-contrast text, one typeface,
no Malaysian signal, proof buried.

Tokens (CSS custom properties, light and dark):

| Token | Light | Dark |
|---|---|---|
| paper (page) | `#f2f4ee` | `#121a16` |
| surface (cards) | `#ffffff` | `#1b2620` |
| forest (primary, buttons) | `#1f3a2e` | `#d6eba8` (inverted) |
| lime (accent tiles) | `#d6eba8` | `#2c4a3b` |
| ink (text) | `#17241d` | `#eef3ea` |
| muted (secondary text) | `#4b5b51` (AA on paper) | `#b3c2b8` (AA on paper) |
| line | `#d5dbcf` | `#2d3a33` |

The builder checks every text pair for WCAG AA and adjusts values, not the
look.

### 6.1 Design system, measured from award-level sites

Owner request, 2026-11-21: take the design system of award-level sites as
the reference. Measured on 2026-11-21 from the rendered pages of Linear,
Stripe, Raycast and ElevenLabs (plus Vapi and V7 in research 6.3) with
computed styles: sizes, weights, tracking, spacing, radii, shadows,
transition timing. No CSS, markup, copy or assets were taken; the numbers
below are JomCall's own scale, set to the same level.

What the references share:

| Property | Linear | Stripe | Raycast | ElevenLabs | What JomCall takes |
|---|---|---|---|---|---|
| H1 | 64/64 w510, -1.41 px | 48/55 w300, -0.96 px | 64/70 w600 | 44/48 w300, -0.88 px | 40-64 px, tracking about -0.022em |
| H2 | 48/48 w510, -1.06 px | 32-56 w300, -0.02em | 32/38 w500, -0.8 px | 32/36 w300 | 30-44 px, -0.02em |
| Body | 15/24 | 16/22 | 14-16/22-26 | 15-18/22-29 | 17/27 (larger, owners read on phones) |
| Families | Inter + Berkeley Mono | Söhne + Source Code Pro | Inter + Geist Mono | Waldenburg + Inter | display + text + mono, all three refs use a mono for data |
| Spacing seen most (gap) | 4, 6, 8, 12 | 8, 16, 32, 64 | 8, 12, 16, 24, 32 | 6, 8, 12 | a 4 px base: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 |
| Heading to heading (desktop) | 1,078-1,375 px | 991-2,743 px | 533-1,375 px | 401-901 px | sections 112-128 px padding desktop, 64-72 px phone |
| Content width | 1,436 frame; 540-620 text | 1,266; 400 text | 1,204; 450 text | | 1,200 frame; 640 text column |
| Radii | pill, 4, 8, 12 | 1-8 | 8, 11, 12, 16, 20, pill | 2, 4, 12, 16, 24, pill | pill buttons and chips; 8 inputs; 12 small cards; 16 cards; 24 frames |
| Shadow | 1 px rings, one soft float | one long soft float | 1 px rings | | 1 px ring for edges; one soft float for the hero card only |
| Motion | 100 ms (most), 160, 400-700 | 300 ms (most), 800 for reveals | 200-400 ms | 150-300 ms | 120 ms micro, 220 ms standard, 480 ms reveal; ease-out `cubic-bezier(.2,.8,.2,1)` |

What makes these sites read as award level, and the rule JomCall takes from
each:

1. **Weight and size contrast, not colour, makes hierarchy.** Headings are
   big and tight; body is quiet. Rule: one display weight (600), body 400,
   no third weight for emphasis.
2. **A strict small spacing scale.** Almost every gap is 4, 8, 12, 16, 24
   or 32. Rule: only scale values; no one-off margins.
3. **Few radii, each with a job.** Rule: the five radii above, by element
   type.
4. **Edges by hairline rings, not drop shadows.** Rule: shadows only on
   the one floating element per page.
5. **Product views, not illustrations.** Rule: every visual is a small real
   view of JomCall (made-up data), never stock art or icon grids.
6. **Fast, quiet motion.** Most transitions are 100-300 ms; long motion is
   kept for one reveal. Rule: as the motion row above; no scroll-triggered
   fade-in on every section.
7. **A mono face for data.** Rule: RM amounts, times, codes and call
   durations in Plex Mono.
8. **Generous section spacing with a narrow text column.** Rule: 640 px
   text column inside a 1,200 px frame; sections 112-128 px apart.

Quality floor (part of "done"): text contrast AA; visible focus ring on
every control; layout holds at 360 px; no layout shift from fonts (size
adjust on the fallback); largest image or text paints under 2.5 s on a
mid-range phone on 4G (Lighthouse mobile); reduced motion stops auto
cycling.

### 6.2 JomCall tokens

Type scale (desktop / phone):

| Role | Size and line height | Weight, tracking | Face |
|---|---|---|---|
| Display (H1) | 64/64 / 40/42 | 600, -0.022em | Familjen Grotesk |
| H2 | 44/48 / 30/34 | 600, -0.02em | Familjen Grotesk |
| H3 | 22/28 / 20/26 | 600, -0.01em | Familjen Grotesk |
| Lead | 20/30 / 18/28 | 400 | Public Sans |
| Body | 17/27 | 400 | Public Sans |
| Small | 15/22 | 400 | Public Sans |
| Label | 13/18 | 500 | Public Sans (sentence case, never all caps) |
| Data | matches its context | 500 | IBM Plex Mono |

Fonts:

- Familjen Grotesk (OFL) is new; Public Sans and IBM Plex Mono are
  already in `web/public/fonts`. The mockup used JetBrains Mono; Plex is
  close enough, so no new mono.
- All self-hosted with `next/font/local`; visitors' browsers never call
  Google Fonts.

Spacing, width, radii, shadow and motion: as the "What JomCall takes"
column in 6.1, defined once as CSS custom properties.

### 6.3 Signature moments

Spend boldness here, keep the rest quiet):

1. **Hero call card**: a dark forest card showing a made-up call that
   switches between BM, Manglish, 中文 and English every few seconds, with
   language chips the visitor can tap. It reuses the existing demo audio in
   `public/demo-call/` so "Hear a sample call" plays the selected language.
2. **Bento of live product views** under the hero: mixed tile sizes, each a
   small view of the product (today's calls with outcomes, a booking
   with the time read back, the RM49 tile, a forwarding-code tile,
   passing a caller to staff during opening hours, the four languages, "the
   AI says it is an AI; calls are not recorded"). No icon-plus-sentence
   tiles.

Everything else (industry pages, guides, FAQ) uses a calm reading layout:
left-aligned text column under 75 characters, a sticky in-page contents list
on desktop, varied section rhythm (full-bleed band, two-column, bento) so a
long page does not repeat one pattern.

Theme: follows `prefers-color-scheme`, the toggle stores the choice in
`localStorage` (`jomcall-theme`), an inline pre-paint script applies it to
avoid a flash. `?theme=dark` is still honoured once (and stored). Links into
`/login`, `/signup` and `/app` add `?lang=<locale>&theme=<theme>` from the
client island so the app keeps today's behaviour.

## 7. Visitor flow

- **Header**: brand; menus Product (How it works, Languages, Call
  forwarding, Trust), Industries (six plus "All industries"), Pricing,
  Resources (FAQ, Guides, Compare); language switch to the same page in the
  other language; theme; Log in; primary "Get started" (to sign-up) or
  "Open your workspace" when signed in (`useSignedIn`, hosted only). Mobile:
  one menu button, a full-height sheet, focus trapped, Escape closes.
- **Home, in order**: hero (promise, "From RM49 a month", three ticks, Get
  started plus "Hear a sample call", reassurance "Prepaid wallet in RM, no
  card charged automatically. Calls are not recorded."); bento; the problem
  (missed calls); how it works (the six steps); languages; industries strip;
  pricing at a glance (three plans, link to Pricing); FAQ (6); closing band
  with Get started.
- The workspace preview no longer links visitors into `/app`.
- **Pricing**: plan buttons as above; estimator; FAQ.
- **Footer**: every public page grouped, language switch, operator details
  (`OperatorDetails`), licence line, Privacy and Terms.
- **The path after sign-up** (sign-up panel, home "how it works", and the
  `/how-it-works` page) uses the in-app checklist's six steps, in this
  order and with these names, so the public promise matches what the owner
  sees after sign-up (source of truth `checklist()` in
  `web/lib/core/home-rules.ts`; first-run design §5.1, PR #84):
  1. Set up your business / Sediakan perniagaan anda
  2. Test the agent / Uji ejen
  3. Publish the agent / Terbitkan ejen
  4. Choose a plan / Pilih pelan
  5. Get a phone number / Dapatkan nombor telefon
  6. Take your first real call / Terima panggilan sebenar pertama (forward
     your business number to your JomCall number)
  After creating a workspace the app opens `/app/setup` (first-run §5.2).
- **Sign-up and log-in panels**: new copy that describes the receptionist
  and the six steps above; titles "Create your JomCall account" / "Log in to
  JomCall" and BM equivalents. Fields and checks unchanged.
- WhatsApp appears only as "waiting for Meta's approval" while
  `WHATSAPP_WAITING_FOR_META` is true.

## 8. Modes

- **Hosted**: everything above; indexable only when `isIndexable()` (section 9).
- **Mock (4181) and local (4182)**: the same public pages render (so they
  can be checked) with `noindex`, no robots, sitemap or `llms.txt`, and a
  one-line footer notice that this is a preview build. The hosted copy in
  `launchCopy` becomes the only copy for the new pages; the old mock wording
  ("fictional calls", "not a price offer") stays only inside the mock app
  screens.

## 9. Origin and indexing

Owner decision, 2026-11-21 (final): wait for jomcall.com. The live site at
`staging.jomcall.com` stays `noindex`, robots disallows everything there,
and nothing invites search engines to index it. The sitemap, canonical,
hreflang and `llms.txt` are built now. Indexing turns on by itself only
when the origin's host is `jomcall.com` (owner step later: point
`APP_ORIGIN` at it). One helper, `isIndexable()` in `web/lib/site.ts`, is
true only in hosted mode with that host; robots, page metadata and the
sitemap read it.

Canonical, hreflang, Open Graph URLs and the sitemap need an absolute
origin, fixed into static HTML at build time. Source: `APP_ORIGIN` read at
build in hosted mode, through one helper (`web/lib/site.ts`). If it is
missing at build time, the build fails in hosted mode with a message naming
the variable (never its value), so a localhost origin can never ship. The
builder confirms how `build:hosted` gets `APP_ORIGIN` locally (a test value
for the check) and that Vercel's staging environment has it for builds
(owner step if not). Public pages and `/app` share one origin today, so `APP_ORIGIN` serves
both. If production later splits them, a separate `PUBLIC_SITE_ORIGIN`
setting is added then.

## 10. Content and language

- Content lives in typed modules under `web/content/public/` (one per page
  family), each exporting `{ en, ms }` with the same shape so a missing BM
  string is a type error.
- Copy follows the frontend-design writing rules: plain verbs, sentence
  case, no all-caps labels, each FAQ answer stands on its own (answer
  engines quote it).
- BM copy goes through the `bebenang:manusiawi` pass (it catches
  Indonesian words). The PR says the BM still needs a native speaker's read.
- Sample calls, businesses and callers are made up and labelled
  ("Sample call, made up" / "Contoh panggilan, rekaan").

## 11. Tests and checks

- `tests/hosting/public-site.test.ts` (runs in `check:core`):
  - every page path exists in both languages and is in the sitemap with
    both alternates;
  - every page has a title, description and canonical;
  - prices on pages equal `publicPlans` and `publicPrices`;
  - banned claims (affirmative only): the "Banned outright" list in
    section 3, plus "we record". The test includes cases proving the required
    negations pass ("Calls are not recorded", "no free trial", "not Tamil
    yet").
  - the EN and BM content modules have the same keys.
- Existing guard tests stay green; add a guard if the public pages import
  anything from `web/components/core` app code.
- Done means: `npm run typecheck`, `npm run test:guards`,
  `npm run check:core`, `build:hosted`, `build:mock`, `build:local` pass;
  the hosted build's route table shows every public page static; a browser
  check at 390 px and desktop in English, BM and dark theme of home,
  pricing, one industry page, FAQ and the mobile menu; keyboard focus
  visible; reduced motion respected.

## 12. Build order

1. Tier 0 + the new shell (header, footer, theme, tokens, fonts) + home +
   pricing + privacy/terms moved. All checks green, commit.
2. Tier 1 content pages.
3. Tier 2 pages.
4. Sign-up and log-in panel copy.
5. BM pass, browser check, PR.

If time runs short, the PR can stop after step 1 or 2 and still be
coherent.

## 13. Builder calls recorded after the review

- Car workshop page is about taking a message for the mechanic, not job
  status: `lookup_job_status` has no connected job system.
- `tests/hosting/page-titles.test.ts` requires `pageTitle(...)`, which reads
  the query string; it is updated so static public pages use per-locale
  `metadata` and the app and auth pages keep `pageTitle`.
- Familjen Grotesk is fetched once from its upstream OFL release (Google
  Fonts GitHub repository) and committed as a file with its licence.
- JSON-LD `Organization` uses the brand name JomCall, with the operator's
  legal name from `OperatorDetails` as `legalName`.
- The pricing self-host card stays as it is.

## 14. Left to the builder

- Exact component split and CSS organisation (a new `public.css` is
  expected; old marketing CSS is removed once nothing uses it).
- Exact copy within section 3's facts and section 10's rules.
- Whether `/guides/call-forwarding-malaysia` canonicalises to
  `/call-forwarding`.
- Open Graph image: one static image per language, or text-only cards.
- Dark-theme value tuning for AA.

## 15. Coordination with the first-run work (PR #84)

Owner request, 2026-11-21: the public pages and the first-run work must not
contradict each other.

- This work owns: `web/components/marketing.tsx`, `web/components/public-pages.tsx`,
  `web/components/public/`, `web/content/public/`, `web/lib/site.ts`,
  `web/lib/public-meta.ts`, the new public routes, and the auth pages'
  side-panel copy and titles.
- First-run owns: `web/lib/core/home-rules.ts`, `home.tsx`, setup
  finish/review/bring, `chrome.tsx`, `packages/contracts/src/core.ts`, the
  `firstRun` read.
- Shared: `web/messages/en.json`, `web/messages/ms.json`, `web/lib/launch.ts`.
  Add keys only; never rename or remove a key this work did not add.
- Forwarding codes have one source: `web/components/core/phone.tsx`.
- Whoever opens a pull request second rebases on `main` first.

## 16. Risks

- **Single root layout**: `<html lang>` is set before paint rather than by
  the server; `Content-Language` and the `lang` wrapper cover crawlers.
  Low risk; revisit later.
- **Large diff in `web/`**: other open branches touching marketing files
  will conflict. Mitigation: the old components are deleted only at the end.
- **BM quality**: no native review yet.
- **Ranking**: weeks to months after jomcall.com is live; `FAQPage` rarely
  earns rich results now, its value is quotable answers.
