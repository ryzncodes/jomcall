# Public pages: competitor research and recommended page set

Date: 2026-11-21. Status: research and recommendation only. Nothing is built
until the owner approves the page list.

## 1. How this was researched

- **Mobbin:** this session has two Mobbin connections. The local `mobbin` MCP
  server answers every call with "Mobbin MCP requires a paid plan" (its
  account has no paid plan). The claude.ai Mobbin connector works and was
  used for section patterns (see section 2.1). Mobbin has no AI-receptionist
  sites, so the patterns come from other SaaS sites; competitor research came
  from their live sites.
- **Live sites** (opened in Chrome on 2026-11-21): Smith.ai, Goodcall, Rosie,
  Synthflow, Retell AI, Dialzara, Bland, respond.io, SleekFlow. For each one we
  read the sitemap (page count grouped by section), the structured data on the
  home page, the hreflang tags and `/llms.txt`. We also read the outline of one
  page of each main type: a comparison page, an industry page, an FAQ hub and a
  language page.
- **Malaysian and regional players** (web search): Hiiiilo, a WhatsApp
  receptionist for clinics, salons and spas (from RM599 a month); Wabot,
  WhatsApp bots (RM30 to RM290); SleekFlow (`ms-my` locale); respond.io, which
  was founded in Malaysia; an "AI Receptionist Malaysia" agency; and vendor blog
  guides about AI voice agents in Malaysia. We found no Malaysian product that
  sells AI phone answering with published RM prices.
- Nothing was copied. This document records page types and why they work, not
  anyone's wording, names or layout.

## 2. What competitors publish

Sitemap sizes, taken on 2026-11-21:

| Site | Pages | Biggest sections |
|---|---|---|
| Smith.ai | 2,383 | blog 1,629; integrations 142; 4 sets of comparison pages (40-70 each); case studies 54; industries 36; free templates and documents 72 |
| Goodcall | 1,457 | programmatic pages: "business productivity AI" 594, phone numbers by area code 229, answering services by industry or competitor 187, scheduling software by industry 145 |
| Retell AI | 14,508 | 11 languages × 1,309 pages; use cases 212; glossary 91; area codes 66; **language pages 64** (including Malay); integrations 61 |
| respond.io | 15,132 | 13 languages × 1,164 pages; help centre 315; **one page per FAQ, 106 pages**; customer stories 51; industries 21 |
| Bland | 1,844 | blog 1,267; changelog 247; compare 94; integrations 49; industries 43; alternatives 21; glossary; trust and security |
| Dialzara | 791 | blog 550; compare 121; industries 89; alternatives 8; a dedicated FAQ page; a voices page |
| Synthflow | 353 | blog 157; German copy 65 (`/de`); compare 30; industry 12; compliance 6; customer stories 12 |
| Rosie | 133 | blog 70; industries 28; solutions 10; a "wall of love" page |

Structured data seen: `Organization` and `WebSite` (all), `SoftwareApplication`
or `Product` (Retell, Synthflow, Bland, Dialzara, Rosie), `FAQPage` (all except
respond.io's home page), `Service` (Smith.ai, Rosie), `BreadcrumbList` (Bland,
respond.io, Dialzara comparison pages), `Article` (Dialzara comparison pages).

`llms.txt`: Smith.ai (15 KB), Goodcall (11 KB), Rosie (5 KB), Retell (5 KB),
Bland (125 KB), Dialzara (209 KB), respond.io (242 KB), SleekFlow (13 KB).
Synthflow has none. The best is Rosie's: one dense paragraph covering what the
product is, who it is for, the price, the languages and the integrations, then
links. That gives an answer engine short facts it can quote.

Hreflang: Retell (11 languages), respond.io (13), Synthflow (en, de) and
SleekFlow (15, including `ms-my`) put each language at its own path. Smith.ai,
Goodcall, Dialzara and Bland are English only.

### Page types and why they work

| Page type | Who has it | Why it ranks or gets quoted |
|---|---|---|
| Industry / use-case pages | all eight | Matches searches like "answering service for [trade]". 700-2,000 words each, with that trade's pains, how the product answers, how it works in steps, and an FAQ (`FAQPage`). |
| Comparison "X vs Y" | Smith.ai, Dialzara, Bland, Synthflow | High buying intent. Dialzara's has two summaries, the price worked out, a feature table, "choose A when / choose B when", switching help and an FAQ, about 900 words. |
| Alternatives pages | Dialzara, Bland, Synthflow | Catches "[competitor] alternatives" searches. |
| FAQ hub, one page or section per question | respond.io (106), Dialzara | Each question is its own heading with a direct first-sentence answer. This is the format answer engines lift from most easily. |
| Language pages | Retell (64) | "Malay AI voice agent". Retell's Malay page is about 680 words of generic text that could be about any language. **A real Malaysian page can do better.** |
| Glossary | Retell (91), Bland | Defines terms such as "AI receptionist" or "call forwarding"; often quoted for "what is …" answers. |
| Guides / blog | all | The bulk of the traffic, mostly listicles like "best AI receptionist 2026". Costly to keep up. |
| Templates and free documents | Smith.ai (72) | Call scripts, after-hours phone tree templates. Brings in links. |
| Programmatic area-code pages | Goodcall, Retell | Not useful in Malaysia (no area-code buying intent). |
| Integrations directory | Smith.ai, Retell, Bland | Needs real integrations. |
| Case studies | Smith.ai, Synthflow, Bland | Needs real customers. |
| Trust / security / compliance | Bland, Synthflow | Answers "is it safe / compliant" searches, and buyers check it. |
| Pricing page plus FAQ | all | `Offer` data; questions about price are among the most common AI prompts. |
| Translated site | Retell, respond.io, SleekFlow, Synthflow | Each language at its own URL, with hreflang. |

### 2.1 Section patterns from Mobbin (layout ideas only, nothing copied)

- **Industry index:** a grid of cards, each with an icon, the industry name,
  one line of outcome and a "learn more" link (Canva, Zendesk, TheyDo,
  PayPal). Fits `/industries`.
- **Category comparison table:** the product in one column against kinds of
  alternative, not named rivals (Firecrawl compares against "manual uploads",
  "browser extensions" and "generic scrapers"; Superpower against "a typical
  annual physical"). This is exactly the shape of the Tier 2 category
  comparisons. Named-rival tables (Jasper vs ChatGPT, Notion vs Monday) are
  the pattern we leave out.
- **Cost estimator:** one usage slider with the monthly total beside it,
  sometimes with a plan picker and a line-by-line breakdown (Stripe Sigma,
  Duolingo for Business, Cofounder, Teak). Fits the pricing calculator: minutes
  slider, plan picker, fee plus overage, total in RM.
- **FAQ:** questions grouped under category headings, with category labels
  in a left column on wide screens and stacked on mobile (Zendesk, Maxima
  Therapy, YLLW, Klarna). Fits the FAQ hub; each question still gets its own
  heading and anchor.

## 3. Where JomCall stands today (staging, 2026-11-21)

Checked on `staging.jomcall.com`:

- No `robots.txt`, no `sitemap.xml`, no `llms.txt` (all 404).
- No canonical URL, no hreflang, no JSON-LD, no Open Graph tags.
- Bahasa Melayu exists only as `?lang=ms` on the same URL. The server always
  sends `<html lang="en">` and fixes it in the browser afterwards.
- Every public page is rendered per request (`cache-control: no-store`)
  because it reads the query string. The HTML does contain the text (the `h1`
  is server-rendered), but nothing is cached at the edge.
- Every internal link carries `?lang=…&theme=…`, so one page has many URLs.
- Public pages: home, pricing, privacy, terms, login, sign-up. `/docs`,
  `/admin` and `/self-host` return 404 on hosted.

**JomCall's openings:**

- A Malaysian product that answers phone calls in BM, English, Manglish and
  Mandarin is something no competitor we checked has a real page for.
- BM-language content on this topic is close to empty.
- Prices are in RM and public.
- The code is public (source-available), which is a trust point no competitor
  has.

## 4. Recommended page set

Ranked by impact and effort. Every page is in English and BM, uses only
features that ship today, and marks any sample as made up.

### Tier 0: technical base (do first; every new page depends on it)

1. **Language in the path:** English at `/…`, BM at `/ms/…`, for public pages
   only (`/app` keeps `?lang`). Old `?lang=ms` public links get a 301 redirect.
   The server sends the right `<html lang>`.
   *Amended 2026-11-21 (build):* the build sends `<html lang="en">` on every
   page, because Next has a single root layout. BM pages instead set
   `<main lang="ms">` (and `lang` on the public shell), send the
   `Content-Language: ms` header, and run a pre-paint script that sets
   `document.documentElement.lang` to `ms`. See `NOTES.md` (Task 10) for the
   deviation.
2. **Static public pages:** built once and served from the edge. The theme
   follows the device setting plus the existing toggle, not the URL.
3. **Per-page metadata:** title, description, canonical, hreflang (`en`, `ms`,
   `x-default`) and Open Graph.
4. **`robots.txt`, `sitemap.xml`, `llms.txt`:** hosted build only, with the
   origin taken from config (staging now, jomcall.com later). Mock and local
   stay `noindex`. `robots` keeps `/app`, `/api`, `/invite` and the auth pages
   out of search.
5. **JSON-LD:** `Organization` and `WebSite` site-wide; `SoftwareApplication`
   with MYR `Offer`s on home and pricing; `FAQPage` where a page has questions;
   `BreadcrumbList` on inner pages.

Effort: medium (a routing change for public pages). Impact: high. Without
this, none of the pages below can be indexed properly in BM.

### Tier 1: high impact, content the product already supports

6. **Industry pages, 6 to start:** clinics, salons and beauty, car workshops,
   air-con and home repair, restaurants (table bookings), tuition centres. Each
   matches an existing setup business type and pattern pack. Each page has
   that business's typical calls, what JomCall does on them, a made-up sample
   conversation, how setup works, and an FAQ. An `/industries` index page
   links them. The other setup types (bakery and catering, homestay, parts
   shop, law firm, laundry and repair) come in a later round.
7. **Languages page:** "an AI receptionist that speaks BM, English, Manglish
   and Mandarin". It covers how it follows the caller's language, a made-up
   mixed-language sample, and what it does not do (no Tamil, for example).
   This is the clearest gap competitors leave.
8. **FAQ hub:** about 20 questions, each with its own heading and a direct
   first sentence, in groups: price and billing, phone number and forwarding,
   languages, what the AI does and does not do, privacy (calls not recorded,
   AI disclosure, export and delete), WhatsApp status. `FAQPage` JSON-LD.
9. **Pricing page upgrade:** a minutes calculator using the existing
   `monthlyEstimateSen`, a short pricing FAQ, and `Offer` JSON-LD. Figures come
   from `web/lib/pricing.ts`.
10. **How it works plus a call-forwarding guide:** the steps (pick a type,
    answer the questions, test in the browser, forward your number). The
    forwarding guide uses the same codes as the app (`**21*`, `**61*`,
    `**67*`) and explains each choice. Carrier-specific claims are left out
    unless the app already states them.

### Tier 2: medium impact

11. **Category comparison pages, 4:** JomCall vs voicemail, vs hiring a
    receptionist, vs a human call-answering service, vs a WhatsApp-only bot.
    These are fair, factual and need no claims about named rivals. A
    receptionist's cost appears only as a cited MYR figure or the owner's own
    number.
12. **Trust and privacy page:** facts only. Calls are not recorded. The AI
    says it is an AI. Where data is stored. Export and delete. The public
    source code. Staff and caller data rules. It says nothing like "PDPA
    compliant", because the cross-border decision is still open. It links the
    owner's Privacy and Terms pages, which stay unchanged.
13. **Two or three evergreen guides:** for example, "What an AI receptionist
    is and what it is not", "Missed calls: what they cost a small business
    (with a worksheet)", "Setting up call forwarding in Malaysia".

### Left out, with the reason

| Page | Reason |
|---|---|
| Named "JomCall vs [Competitor]" and "[Competitor] alternatives" | Each needs dated, sourced facts about another company's product and price, and the clean-room rule raises the risk. Possible later, with the owner's approval of each named rival. |
| Integrations directory | None is live. |
| Case studies, testimonials, "wall of love" | No real customers to quote. |
| Area-code or city programmatic pages | No matching search intent in Malaysia; they would be thin pages. |
| Glossary | Low value at this size; the FAQ and guides cover the key terms. |
| Large blog | Ongoing writing cost; start with the 2 or 3 guides. |
| Templates (call scripts and so on) | Possible later. |

## 5. Visitor flow: what the market does and where JomCall differs

Owner request, 2026-11-21: include UI, UX and flow fixes, so that JomCall's
public flow feels familiar to someone who has seen other AI receptionists.

### 5.1 The common flow (Rosie, Dialzara, Goodcall live; Vapi, Chatbase, ElevenLabs on Mobbin)

| Step | Market convention |
|---|---|
| Header | Product or Solutions menu, Industries menu, Pricing, Resources, Log in, one primary button ("Free trial" / "Get started"), and often a demo phone number or "Book a demo" beside it. |
| Hero | One-line promise; **the starting price in the hero** (Rosie, Dialzara); three short ticks of what it does; a primary button plus a one-line reassurance under it ("7-day trial, cancel anytime"). |
| Live proof | **Call a real demo number** (Rosie, Dialzara "hear it live right now") or **talk to the agent in the browser** (Goodcall "Talk to Gabi", Vapi "Talk to Vapi", ElevenLabs "Call AI agent"). |
| Home order | Problem → how it works in 3-4 steps ("set up in 15 minutes": learn the business → check → forward your number → it answers) → features → hear a call → **pricing at a glance** → industries → FAQ → final call to action. |
| Pricing | Each plan's button goes straight to sign-up; a usage estimator; an FAQ under the plans. |
| Sign-up | Short: email and password, or Google; a split screen with the product promise or proof beside the form; email confirmation. |
| First run | The agent is built from something the owner already has: the Google business listing or website (Rosie, Goodcall, Chatbase), then a test call, then a "getting started" checklist (Chatbase: 1 of 6 done). |

### 5.2 JomCall today, against that flow (staging, 2026-11-21)

| Step | JomCall now | Gap |
|---|---|---|
| Header | How it works, The conversation, Your control (page anchors), Pricing, BM, theme, Log in, Get started | No Industries or Resources menu; anchors only work on the home page. |
| Hero | "Every hello. Handled." with "Get started" and "Try a sample call" | No price in the hero, no ticks of what it does, no reassurance line. |
| Live proof | A recorded sample conversation (made-up business, AI voices) | No live demo: no number to call, and visitors cannot talk to the agent. |
| Home order | Problem, conversation sample, workspace preview, control, FAQ (4 questions) | No step-by-step "how it works", no pricing at a glance, no industries. The sample call rows in the workspace preview link to `/app/calls`, which sends a visitor to log in. |
| Pricing | Plan cards; buttons say "Choose in Billing" and go to `/app/billing` | A signed-out visitor lands on log-in, not sign-up; no estimator; no FAQ. |
| Sign-up | Email, password, Turnstile, email confirmation; left panel says "Every relationship. One workspace." | The panel's words describe a CRM, not a receptionist; the page title is "Create workspace access". No Google sign-in. |
| First run | Setup: pick a business type, answer up to 8 questions or bring a price list, review, test in the browser, publish; then choose a plan, get a number, forward calls | Not built from a website or Google listing; no visible checklist of the whole path to the first real call. |

### 5.3 What this work fixes, and what goes elsewhere

In this work (public site, up to the sign-up form):

- Header with Product, Industries, Pricing and Resources menus (mobile menu
  too), Log in, and "Get started" going to sign-up (or "Open your workspace"
  when signed in, as now).
- Hero with "From RM49 a month", three ticks of what it does today, and a
  true reassurance line (prepaid wallet in RM, no card charged automatically,
  keep your number).
- Home page in the market order, including a 4-step "how it works", pricing
  at a glance and an industries strip. The workspace preview no longer
  sends visitors into the app.
- Pricing buttons go to sign-up for visitors and to Billing for signed-in
  owners; an estimator; an FAQ.
- A full footer linking every public page (also helps search engines find
  them).
- Sign-up and log-in copy: the panel describes the receptionist and what
  happens after sign-up (set up, test, choose a plan, forward your number).
  The fields and checks are unchanged.
- A "call our demo line" card that appears only when a demo number is set in
  config; hidden until the owner provides one.

Not in this work, with the reason:

- Google sign-in: a new auth provider and outbound service, which is the
  owner's decision.
- Building the agent from a website or Google listing, and a first-run
  checklist: in-app onboarding, which is a separate project (and the
  one-page agent screen design is already in progress on
  `docs/agent-page-design`).
- A free trial: JomCall has none; the copy will not claim one.

## 6. Visual design: is the current site at award level?

Owner request, 2026-11-21: award-level UI and UX (Awwwards standard), using
well-curated components or methods such as bento grids where they fit.

### 6.1 Current home page (staging, desktop, 2026-11-21)

Strengths: calm, editorial and consistent. Sage and forest-green palette,
large grotesk headlines with a two-tone second line, generous white space, a
photographic hero (a translucent green phone), a dark section for the sample
conversation, a believable workspace preview, and a light-green closing band.
It already looks better than most competitors' templated sites.

Why it is not yet award level:

1. **One rhythm, repeated.** Almost every section is "big headline on the
   left, short paragraph on the right, thin rule below". Nothing changes the
   pace, so a long scroll reads as more of the same.
2. **Low density, low contrast.** Body and label text is small grey on a grey
   background, so it fades away, especially in the stats row and the "how it
   works" cards. Large areas of the page carry one sentence.
3. **Little in motion.** Apart from the sample call, nothing reacts to
   scrolling or pointing. Award sites use one or two strong, purposeful
   interactions, not many.
4. **One typeface does everything.** There is no contrast between display and
   text type and no mono or numeric accent, beyond the call timer.
5. **Not distinctly Malaysian.** Apart from the BM text in the demo, nothing
   says Malaysia: no languages shown on the page, no local business scenes,
   no RM in view until Pricing.
6. **Proof is hidden.** The strongest asset, hearing the agent in BM, Manglish
   and Mandarin, sits mid-page behind a play button.

### 6.2 Patterns seen in strong references (Mobbin)

- **Bento grids** with mixed tile sizes, each tile a small live product view,
  not an icon and a sentence (V7, FLORA, Swap, Jasper).
- **Hero = the product working:** "Talk to …" in the hero (PlayAI, Vapi,
  Goodcall), or a voice card carousel with play buttons (ElevenLabs).
- **Sticky scroll stories:** a list of features on one side, with the visual
  on the other changing as you scroll (Figma).
- **Restrained type pairing:** a display serif or condensed face for
  headlines with a neutral grotesk and a mono for numbers.

### 6.3 Measured tokens (computed styles, 2026-11-21)

Measurements of the rendered pages, used as a reference for scale and rhythm.
No CSS, markup or copy was taken.

| Site | Headline | Body | Families | Radii | Motion |
|---|---|---|---|---|---|
| ElevenLabs | 44/48 px, weight 300, tight tracking | 18/28.8 px | display face + Inter + a mono | pill (9999) and 4, 12, 16, 24 px | 150-300 ms, standard ease |
| V7 | 60/56 px, weight 500 | 16/20 px | Inter + a serif accent | pill, round | 150-300 ms, strong ease-out |
| Linear | 64/64 px, H2 48/48, weight 510 | 15/24 px | Inter Variable + a mono | pill and 8-12 px | 100-160 ms |
| Vapi | 80/82 px, weight 600, tracking -4 px | 16 px | one display grotesk + a grid mono | 1, 8, 12 px | 150-300 ms |
| **JomCall now** | **132/127 px**, H2 30-56 px, weight 400 | **13/19.5 px**, labels 10-12 px in grey #5B695F | Public Sans (+ Plex, Manrope) | mostly 3 px | (not measured) |

What this says about JomCall: body and label text is 3-6 px smaller than every
reference, and in a low-contrast grey; the hero headline is oversized relative
to the rest; all headings use weight 400, so there is no weight contrast; one
small radius everywhere gives no hierarchy between buttons, cards and frames.
Targets for the redesign: body 16-18 px, labels at least 13 px at AA contrast,
H1 56-88 px, H2 36-48 px, a display/text/mono pairing, pill buttons with
12-20 px card radii, motion at 150-300 ms with an ease-out curve.

Directions for JomCall are to be shown as mockups and chosen by the owner
before the design is written up.

## 7. Expectations to set

- `FAQPage` markup no longer earns Google rich results for most sites. Its
  value now is on-page answers that answer engines can quote, so write each
  answer to stand on its own.
- Ranking takes weeks to months after jomcall.com is live. Indexing staging is
  a waste: once jomcall.com is live, staging should be `noindex` (owner step).
- The BM copy has had no native review. A `manusiawi` pass (it catches
  Indonesian words) is planned, but a human read is still needed.
- Owner decision, 2026-11-21: Tier 0, Tier 1 and Tier 2 are all approved for
  this work (about 20 pages × 2 languages).
