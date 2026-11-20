# Public Pages and Kaunter Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JomCall's three client-rendered public pages with 25 static, bilingual (EN at `/…`, BM at `/ms/…`) pages in the Kaunter visual system, with metadata, JSON-LD, robots, sitemap and `llms.txt`.

**Architecture:** New server-component pages share one set of page components that take a `locale`, fed by typed `{ en, ms }` content modules. Client islands only for theme, mobile menu, signed-in button, pricing estimator and the hero call card. The old `Experience` path stays for `/app`, auth, `/docs`, `/self-host`. One root layout; BM gets `Content-Language`, a `lang="ms"` wrapper and a pre-paint `documentElement.lang`.

**Tech Stack:** Next.js 16.4 (App Router, `proxy.ts`, metadata routes), React 19.3, TypeScript, plain CSS custom properties, `next/font/local`, Node test runner via `tsx` (`npm run test:local`).

**Spec:** `docs/superpowers/specs/2026-11-21-public-pages-design.md` (read sections 3, 5, 6 and 11 before any task).

## Global Constraints

- Read `web/AGENTS.md` and the relevant guide in `node_modules/next/dist/docs/` before writing Next code; this Next differs from training data.
- Claims: only spec section 3's plain table as plain claims; hedged features only in its allowed wording; nothing from "Banned outright".
- Every sample business, caller and call is made up and labelled "Sample call, made up" / "Contoh panggilan, rekaan".
- Never change legal text in `web/messages/legal.ts`; operator facts only from `web/lib/operator.ts`.
- Prices only from `web/lib/pricing.ts` (`publicPlans`, `publicPrices`, `monthlyEstimateSen`); amounts shown as `RM 49` style via one formatter.
- Fonts self-hosted; no request from a visitor's browser to Google or any third party.
- Tokens exactly as spec 6.1/6.2: type scale, 4 px spacing scale (4, 8, 12, 16, 24, 32, 48, 64, 96, 128), radii (pill, 8, 12, 16, 24), motion 120/220/480 ms with `cubic-bezier(.2,.8,.2,1)`, 1,200 px frame, 640 px text column.
- No all-caps labels, no icon-grid tiles, one floating shadow per page, no scroll fade-ins on every section.
- Every public route is static in the `build:hosted` route table (○ or ●), never ƒ.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `feat/public-pages-seo` in `/Users/faiz/Documents/project/call-agent-seo`.
- Log any deviation from the spec in `NOTES.md` at the repo root of the worktree.

## Review Focus

1. A visitor on an old link `/?lang=ms&theme=dark` or `/pricing?lang=ms` expects the BM page, not the English one (Task 1 test: `legacyRedirect`).
2. A signed-in owner on a public page expects "Open your workspace", never a flash of "Get started" that sends them to sign-up (Task 2: CTA renders a neutral placeholder while checking).
3. A phone at 360 px with the mobile menu open expects Escape and the close button to work and focus to return to the menu button (Task 2 test + browser check in Task 10).
4. Dark theme chosen on a public page expects the app and login to open dark (`?theme=dark` added to links into `/login`, `/signup`, `/app`) (Task 2 test: `appHref`).
5. A missing BM string expects a type error, not a blank heading (Task 3: shared `PageContent` type with `{ en: T; ms: T }`).

---

### Task 1: Site registry, metadata helper, language routing

**Files:**
- Create: `web/lib/site.ts`, `web/lib/public-meta.ts`, `web/proxy.ts`
- Modify: `web/next.config.ts` (add `headers()`)
- Test: `tests/hosting/public-site.test.ts`

**Interfaces:**
- Produces:
  - `type PublicLocale = "en" | "ms"`
  - `type PublicPageId` = union of the 25 ids below
  - `PUBLIC_PAGES: readonly { id: PublicPageId; path: string; parent?: PublicPageId }[]` with paths (EN; BM is `/ms` + path, home is `/ms`): `/`, `/pricing`, `/how-it-works`, `/call-forwarding`, `/languages`, `/faq`, `/industries`, `/industries/clinics`, `/industries/salons`, `/industries/car-workshops`, `/industries/aircond-home-repair`, `/industries/restaurants`, `/industries/tuition-centres`, `/compare`, `/compare/voicemail`, `/compare/receptionist`, `/compare/answering-service`, `/compare/whatsapp-bot`, `/trust`, `/guides`, `/guides/what-is-an-ai-receptionist`, `/guides/missed-calls-cost`, `/guides/call-forwarding-malaysia`, `/privacy`, `/terms`
  - `localePath(id: PublicPageId, locale: PublicLocale): string`
  - `siteOrigin(): string | undefined` — `APP_ORIGIN` in hosted mode; throws `Error("MISSING_SETTING: APP_ORIGIN")` when hosted and unset; `undefined` in mock/local
  - `pageMetadata(id, locale, { title, description }): Metadata` in `public-meta.ts` — sets `title`, `description`, `alternates.canonical`, `alternates.languages` (`en`, `ms`, `x-default` → en), `openGraph` (`locale` `en_MY` / `ms_MY`), and `robots` noindex outside hosted. With no origin, canonical/alternates are relative paths.
  - `legacyRedirect(url: URL): URL | null` in `proxy.ts` (exported for tests): for a public path with `lang=ms` → `/ms` + path, dropping `lang` and `theme`; `lang=en` → same path without `lang`/`theme`; otherwise `null`. Non-public paths (`/app`, `/login`, `/signup`, `/docs`, `/self-host`, `/api`) → `null`.

- [ ] **Step 1: Write failing tests** in `tests/hosting/public-site.test.ts`:
  - `PUBLIC_PAGES` has 25 unique ids and unique paths; every `parent` exists.
  - `localePath("pricing","ms") === "/ms/pricing"`, `localePath("home","ms") === "/ms"`, `localePath("home","en") === "/"`.
  - `legacyRedirect(new URL("https://x.test/pricing?lang=ms&theme=dark"))?.href === "https://x.test/ms/pricing"`; `"/?lang=ms"` → `"/ms"`; `"/?lang=en&theme=dark"` → `"/"`; `"/app/calls?lang=ms"` → `null`; `"/pricing"` → `null`.
  - `pageMetadata("pricing","ms",…)` with `APP_ORIGIN=https://staging.jomcall.com` and `JOMCALL_MODE=hosted` has canonical `https://staging.jomcall.com/ms/pricing` and `languages["x-default"] === "https://staging.jomcall.com/pricing"`.
  - hosted with no `APP_ORIGIN`: `siteOrigin()` throws `/MISSING_SETTING: APP_ORIGIN/` and the message does not contain any URL.
- [ ] **Step 2:** `npm run test:local -- tests/hosting/public-site.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement** the three files. `proxy.ts` exports `proxy(request)` calling `legacyRedirect` and returning `NextResponse.redirect(url, 301)`; `config.matcher` limited to requests with a `lang` query (`has: [{ type: "query", key: "lang" }]`) on public paths. `next.config.ts` `headers()` returns `Content-Language: ms` for `/ms` and `/ms/:path*`.
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5: Commit** `feat(web): public page registry, metadata and BM paths`.

### Task 2: Kaunter tokens, fonts and the public shell

**Files:**
- Create: `web/public/fonts/FamiljenGrotesk.ttf` (variable, from the upstream OFL release in the google/fonts GitHub repository, `ofl/familjengrotesk`), `web/public/fonts/FamiljenGrotesk-OFL.txt`, `web/lib/fonts.ts`, `web/app/public.css`, `web/components/public/shell.tsx`, `header.tsx`, `nav-menu.tsx` (client), `theme-toggle.tsx` (client), `cta.tsx` (client), `footer.tsx`, `operator.tsx`, `links.ts`
- Modify: `web/app/layout.tsx` (import `public.css`, font variables on `<html>`, `suppressHydrationWarning`, inline pre-paint script)
- Test: `tests/hosting/public-site.test.ts` (extend), `tests/hosting/public-shell.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_PAGES`, `localePath`, `PublicLocale` (Task 1).
- Produces:
  - `<PublicShell locale page>{children}</PublicShell>` — server component: header, `<main lang={locale}>` (BM wrapper), footer, preview notice outside hosted.
  - `appHref(path: string, locale: PublicLocale, theme: "light" | "dark"): string` in `links.ts` — adds `lang` and `theme` query params; used for `/login`, `/signup`, `/app/*`.
  - CSS custom properties in `public.css` scoped to `.public`: colours (spec 6 table, light and dark under `[data-theme="dark"] .public` and `prefers-color-scheme` when no stored choice), `--space-1..10`, `--radius-pill|8|12|16|24`, `--ease`, `--t-micro|std|reveal`, `--frame: 1200px`, `--measure: 640px`, type classes `.t-display .t-h2 .t-h3 .t-lead .t-body .t-small .t-label .t-data` with desktop and ≤ 640 px values from spec 6.2.
  - Pre-paint script: reads `localStorage["jomcall-theme"]` (in try/catch), else `?theme`, else `prefers-color-scheme`; sets `documentElement.dataset.theme`; sets `documentElement.lang = "ms"` when the path is `/ms` or starts with `/ms/`.
- Header menus and labels per spec section 7; CTA: `useSignedIn(HOSTED)`; while `undefined` render a same-size neutral placeholder; signed in → "Open your workspace" to `appHref("/app", …)`; else "Get started" to `appHref("/signup", …)`.
- Mobile menu: button with `aria-expanded`/`aria-controls`, full-height sheet, focus trapped, Escape and close button restore focus to the menu button.

- [ ] **Step 1: Write failing tests:**
  - `appHref("/signup","ms","dark") === "/signup?lang=ms&theme=dark"`.
  - `tests/hosting/public-shell.test.ts`: no file under `web/components/public/` or `web/app/(public)/` or `web/app/ms/` imports from `@/components/core`, `@/components/experience` or `next/navigation`'s `useSearchParams`; `public.css` defines every token name listed above; `layout.tsx` contains `suppressHydrationWarning` and no `fonts.googleapis.com`.
- [ ] **Step 2:** run both test files → FAIL.
- [ ] **Step 3: Implement** fonts (`next/font/local` for Familjen Grotesk, Public Sans, IBM Plex Mono with `display: "swap"` and `adjustFontFallback`), tokens, shell components.
- [ ] **Step 4:** tests → PASS; `npm run typecheck` → passes.
- [ ] **Step 5: Commit** `feat(web): Kaunter tokens, fonts and public shell`.

### Task 3: Content model and claims test

**Files:**
- Create: `web/content/public/types.ts`, `web/content/public/common.ts` (nav, footer, CTA, labels), `web/content/public/claims.ts`
- Test: `tests/hosting/public-claims.test.ts`

**Interfaces:**
- Produces:
  - `type Bilingual<T> = { en: T; ms: T }`
  - `type FaqItem = { q: string; a: string }`, `type Section = { heading: string; body: string[] }`, `type SampleLine = { who: "caller" | "agent"; text: string }`
  - `type PageCopy = { title: string; description: string; h1: string; lead: string }`
  - `BANNED: { pattern: RegExp; allowIn?: string }[]` in `claims.ts` — from spec section 3 "Banned outright" plus `/\bwe record\b/i`; `free trial` allowed only in the FAQ item keyed `faq.trial`.
  - `findBannedClaims(text: string, where: string): string[]`
- [ ] **Step 1: Write failing tests:** `findBannedClaims("Calls are not recorded.","x")` → `[]`; `"Calls are recorded."` → one hit; `"Never miss a call again"` → hit; `"JomCall does not speak Tamil yet."` → `[]`; `"Speaks BM, English and Tamil"` → hit; `"There is no free trial."` with `where="faq.trial"` → `[]`, with `where="home.hero"` → hit; `"PDPA compliant"` → hit; `"books automatically"` → hit. A second test walks every module under `web/content/public/`, flattens all strings with their key path, and asserts no hits; a third asserts `en` and `ms` of every exported `Bilingual` have identical key paths.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** types, `claims.ts`, `common.ts` (EN and BM).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(web): public content model and banned-claims test`.

### Task 4: Home page with the call card and bento

**Files:**
- Create: `web/content/public/home.ts`, `web/components/public/pages/home.tsx`, `web/components/public/call-card.tsx` (client), `web/components/public/bento.tsx`, `web/app/(public)/page.tsx`, `web/app/ms/page.tsx`
- Delete: `web/app/page.tsx` (its route moves to `(public)`)
- Test: `tests/hosting/public-site.test.ts` (extend)

**Interfaces:**
- Consumes: `PublicShell`, `pageMetadata`, content types.
- Produces: `<HomePage locale />`; `<CallCard locale lines />` — cycles BM → Manglish → 中文 → English every 2.6 s unless `prefers-reduced-motion`; language chips are buttons (`aria-pressed`); "Hear a sample call" plays `public/demo-call/<lang>-<n>.m4a` for the selected language in order, with a stop control.
- Section order exactly as spec section 7 "Home, in order". Hero copy: promise, "From RM 49 a month" from `publicPlans[0]`, three ticks from the plain claims table, reassurance "Prepaid wallet in RM, no card charged automatically. Calls are not recorded." (BM equivalent). Bento tiles per spec 6.3 item 2.
- [ ] **Step 1: Write failing test:** the home page modules' rendered price text equals `RM 49` derived from `publicPlans[0].monthlyFeeSen`; `web/app/(public)/page.tsx` and `web/app/ms/page.tsx` export `metadata` (or `generateMetadata` without `searchParams`) and do not reference `searchParams`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** tests → PASS; `npm run build:hosted` with a test `APP_ORIGIN=https://example.test` → `/` and `/ms` shown as static.
- [ ] **Step 5: Commit** `feat(web): Kaunter home page in EN and BM`.

### Task 5: Pricing, privacy and terms

**Files:**
- Create: `web/content/public/pricing.ts`, `web/components/public/pages/pricing.tsx`, `web/components/public/estimator.tsx` (client), `web/components/public/pages/legal.tsx`, routes `web/app/(public)/{pricing,privacy,terms}/page.tsx`, `web/app/ms/{pricing,privacy,terms}/page.tsx`
- Delete: `web/app/pricing/page.tsx`, `web/app/privacy/page.tsx`, `web/app/terms/page.tsx`
- Test: `tests/hosting/public-site.test.ts` (extend)

**Interfaces:**
- Consumes: `monthlyEstimateSen`, `publicPlans`, `publicPrices`, `legalCopy`, `fillOperator` (move `fillOperator` into `web/components/public/operator.tsx` and re-export from `public-pages.tsx` so in-app users keep working).
- Estimator: minutes slider and number input (0-3000, step 10), shows each plan's monthly estimate with `monthlyEstimateSen`, marks the cheapest; Growth's WhatsApp line uses `whatsappWaiting.short`.
- Plan buttons: visitors → `appHref("/signup")`; signed in → `appHref("/app/billing")`.
- Pricing FAQ (6 items, `FAQPage` in Task 6): how the wallet works, what a minute costs past the allowance, plan changes, what pay as you go means, WhatsApp status, `faq.trial`-style "no free trial" answer keyed `pricing.trial` (add to the `allowIn` list).
- [ ] **Step 1: Write failing tests:** for minutes 0, 100, 400, 1000 the estimator's pure helper `estimates(minutes)` returns `monthlyEstimateSen` for each plan and the cheapest code (`payg` at 0, `starter` at 100, `growth` at 1000); legal page renders `legalCopy.en.privacy` section headings verbatim.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(web): pricing with estimator; legal pages in the public shell`.

### Task 6: JSON-LD, robots, sitemap, llms.txt; page-titles test

**Files:**
- Create: `web/lib/json-ld.ts`, `web/components/public/json-ld.tsx`, `web/app/robots.ts`, `web/app/sitemap.ts`, `web/app/llms.txt/route.ts`
- Modify: `tests/hosting/page-titles.test.ts`
- Test: `tests/hosting/public-site.test.ts` (extend)

**Interfaces:**
- Produces: `organizationLd()`, `websiteLd()`, `softwareAppLd(locale)` (one `Offer` per `publicPlans` entry, `priceCurrency: "MYR"`, price in RM as a decimal string), `faqLd(items: FaqItem[])`, `breadcrumbLd(id, locale)`; `<JsonLd data />` renders `<script type="application/ld+json">` with `<` escaped.
- `robots()`: hosted → allow `/`, disallow `/app`, `/api`, `/invite`, `/login`, `/signup`, `/forgot-password`, `/open-link`, `/admin`, sitemap URL; mock/local → disallow `/`.
- `sitemap()`: hosted → every `PUBLIC_PAGES` entry in both locales with `alternates.languages`; mock/local → `[]`.
- `llms.txt`: hosted → text with a title line, one-line summary, the plain facts from spec section 3, and each page's absolute URL with its description; mock/local → 404. `export const dynamic = "force-static"`.
- `page-titles.test.ts`: pages under `web/app/(public)/` and `web/app/ms/` must export `metadata`/`generateMetadata` built with `pageMetadata(`; all other pages keep the `pageTitle(` rule.
- [ ] **Step 1: Write failing tests:** sitemap in hosted mode has 50 URLs and each has `en` and `ms` alternates; robots in mock mode disallows `/`; `softwareAppLd("en").offers` prices are `"49.00"`, `"129.00"`, `"0.00"`; `JSON.stringify` of `<JsonLd>` output contains no raw `</script`; `llms.txt` body contains every page URL and passes `findBannedClaims`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**; add `JsonLd` to the shell (Organization, WebSite), home and pricing (SoftwareApplication), pages with FAQs (FAQPage), inner pages (BreadcrumbList).
- [ ] **Step 4:** PASS, including the updated page-titles test.
- [ ] **Step 5: Commit** `feat(web): structured data, robots, sitemap and llms.txt`.

### Task 7: Tier 1 content pages

**Files:**
- Create: content modules `web/content/public/{how-it-works,call-forwarding,languages,faq,industries}.ts`; page components `web/components/public/pages/{article,industry,industries-index,faq}.tsx` and `web/components/public/{faq-list,sample-call,toc}.tsx`; routes under `web/app/(public)/` and `web/app/ms/` for `how-it-works`, `call-forwarding`, `languages`, `faq`, `industries`, `industries/[slug]` (`generateStaticParams` over the six slugs, `dynamicParams = false`)

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: `<ArticlePage locale copy sections faqs? />` (reading layout: 640 px column, sticky contents list on desktop, varied bands); `<IndustryPage locale slug />`; `industries: Bilingual<Record<IndustrySlug, IndustryCopy>>` with `IndustryCopy = PageCopy & { calls: Section; sample: SampleLine[]; setupType: string; faqs: FaqItem[] }`.
- Copy rules: spec sections 3 and 10. Forwarding page uses the hedged wording and the codes `**21*`, `**61*`, `**67*`, `##21#` exactly as `web/components/core/phone.tsx:286-288`. Car workshops page is about taking a message for the mechanic. Booking-led industries use the hedged booking wording. FAQ hub: about 20 items in the six groups from spec section 5, including `faq.trial` ("Is there a free trial? No…").
- [ ] **Step 1:** extend `public-claims.test.ts` coverage is automatic (it walks the folder); add a test that each industry has ≥ 4 FAQs and a sample of ≥ 4 lines, and that `faq.ts` has ≥ 18 items.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** pages and EN copy, then BM copy.
- [ ] **Step 4:** tests PASS; `build:hosted` route table shows all new routes static.
- [ ] **Step 5: Commit** `feat(web): how it works, forwarding, languages, FAQ and industry pages`.

### Task 8: Tier 2 pages

**Files:**
- Create: content `web/content/public/{compare,trust,guides}.ts`; components `web/components/public/pages/{compare,index-list}.tsx`, `web/components/public/worksheet.tsx` (client, missed-calls worksheet); routes for `compare`, `compare/[slug]`, `trust`, `guides`, `guides/[slug]` in both locales.

**Interfaces:**
- Consumes: `ArticlePage`, `FaqList`.
- Compare pages: a "when each is better" section and a factual table; no named rivals; the receptionist page's cost is an input the visitor types (the worksheet component in `cost` mode) unless a cited figure with source and date is added.
- Missed-calls worksheet: inputs calls missed per week, share that would have booked, average sale in RM; output monthly RM at stake; no invented statistics.
- `/guides/call-forwarding-malaysia` sets its canonical to `/call-forwarding` if its body is under 60% new text (builder's call, record in `NOTES.md`).
- Trust page: plain facts table rows only; links Privacy and Terms; no "PDPA compliant".
- [ ] **Step 1: Write failing test:** worksheet pure helper `missedValueSen({ perWeek: 10, share: 0.3, averageSen: 8000 })` returns `Math.round(10 * 52 / 12 * 0.3 * 8000)`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; static in route table.
- [ ] **Step 5: Commit** `feat(web): comparison, trust and guide pages`.

### Task 9: Auth panel copy and retiring the old marketing code

**Files:**
- Modify: `web/components/core/auth.tsx` (side-panel copy and headings only), `web/app/login/page.tsx`, `web/app/signup/page.tsx` (titles "Log in to JomCall" / "Log masuk ke JomCall", "Create your JomCall account" / "Cipta akaun JomCall anda"), `web/components/experience.tsx` (drop `marketing`, `pricing`, `privacy`, `terms` screens), `web/components/public-pages.tsx` (keep only what `/docs` and in-app screens still import)
- Delete: `web/components/marketing.tsx` and CSS selectors used only by it, once `grep` shows no importer
- Test: existing tests

**Interfaces:**
- Panel copy: what JomCall is, then the path after sign-up: set up, test in the browser, choose a plan, get your JomCall number. Fields, checks, Turnstile unchanged.
- [ ] **Step 1:** `grep -rn "marketing\"\|<Marketing\|screen=\"pricing\"" web` → only the lines being removed.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** `npm run typecheck`, `npm run test:guards`, `npm run check:core` → pass.
- [ ] **Step 4: Commit** `refactor(web): auth panel copy; remove old marketing screens`.

### Task 10: BM pass, full checks, browser check, PR

**Files:**
- Modify: BM strings in `web/content/public/*.ts` from the `bebenang:manusiawi` pass
- Create: `.agent/handoff.md` entry; `AGENTS.md` current-state entry; research doc Tier 0 line amended for the `<html lang>` deviation

- [ ] **Step 1:** Run `bebenang:manusiawi` on every BM string; apply fixes; rerun `public-claims.test.ts`.
- [ ] **Step 2:** `npm run typecheck && npm run test:guards && npm run check:core` → all pass.
- [ ] **Step 3:** `npm run build:hosted` (test `APP_ORIGIN`), `npm run build:mock`, `npm run build:local` → pass; hosted route table: every public route ○ or ●.
- [ ] **Step 4:** Browser check (hosted build served locally) at 390 px and 1280 px, EN, BM, dark: home, pricing (estimator), one industry page, FAQ, mobile menu (Escape, focus return), old `/?lang=ms` link redirects to `/ms`; keyboard focus visible; reduced motion stops the call card; Lighthouse mobile on `/` (LCP < 2.5 s, CLS < 0.1). Screenshots saved to `output/public-pages/`.
- [ ] **Step 5:** Commit, push the branch, open the PR into `main` (body ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)"; says BM needs a native read and lists owner steps: confirm `APP_ORIGIN` on Vercel for builds). Do not merge.
