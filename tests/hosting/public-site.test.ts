import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  PUBLIC_PAGES,
  isHostedSite,
  localePath,
  siteOrigin,
} from "../../web/lib/site.ts";
import { pageMetadata } from "../../web/lib/public-meta.ts";
import { appHref } from "../../web/components/public/links.ts";
import { config, legacyRedirect } from "../../web/proxy.ts";

// Only the settings these tests change are touched; the rest of the
// environment is left as the runner set it.
const KEYS = ["JOMCALL_MODE", "APP_ORIGIN", "LOCAL_ORIGIN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function set(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    const value = key in values ? values[key] : undefined;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
after(() => set(saved as Record<string, string>));

test("registry has 25 unique pages with valid parents", () => {
  assert.equal(PUBLIC_PAGES.length, 25);
  const ids = new Set(PUBLIC_PAGES.map((p) => p.id));
  const paths = new Set(PUBLIC_PAGES.map((p) => p.path));
  assert.equal(ids.size, 25);
  assert.equal(paths.size, 25);
  for (const p of PUBLIC_PAGES) if (p.parent) assert.ok(ids.has(p.parent));
});

test("localePath", () => {
  assert.equal(localePath("pricing", "ms"), "/ms/pricing");
  assert.equal(localePath("home", "ms"), "/ms");
  assert.equal(localePath("home", "en"), "/");
  assert.equal(localePath("pricing", "en"), "/pricing");
});

test("legacyRedirect", () => {
  const r = (u: string) => legacyRedirect(new URL(u))?.href ?? null;
  assert.equal(r("https://x.test/pricing?lang=ms&theme=dark"), "https://x.test/ms/pricing?theme=dark");
  assert.equal(r("https://x.test/?lang=ms"), "https://x.test/ms");
  assert.equal(r("https://x.test/?lang=en&theme=dark"), "https://x.test/?theme=dark");
  assert.equal(r("https://x.test/app/calls?lang=ms"), null);
  assert.equal(r("https://x.test/pricing"), null);
  for (const p of ["/login", "/signup", "/docs", "/self-host", "/api/x"])
    assert.equal(r(`https://x.test${p}?lang=ms`), null);
});

test("proxy matcher skips app routes but not public paths that share a prefix", () => {
  const source = config.matcher[0].source;
  const re = new RegExp(`^${source}$`);
  for (const p of ["/", "/pricing", "/ms/pricing", "/apps-guide", "/application", "/login-help", "/docsify"])
    assert.ok(re.test(p), `${p} should reach the proxy`);
  for (const p of ["/app", "/app/calls", "/api/v1/session", "/login", "/signup", "/docs", "/docs/x", "/self-host", "/_next/static/x"])
    assert.ok(!re.test(p), `${p} should not reach the proxy`);
});

test("isHostedSite reads the mode at call time", () => {
  set({ JOMCALL_MODE: "hosted", APP_ORIGIN: "https://staging.jomcall.com" });
  assert.equal(isHostedSite(), true);
  set({ JOMCALL_MODE: "local" });
  assert.equal(isHostedSite(), false);
  set({});
  assert.equal(isHostedSite(), false);
});

test("appHref adds language and theme for app links", () => {
  assert.equal(appHref("/signup", "ms", "dark"), "/signup?lang=ms&theme=dark");
  assert.equal(appHref("/login", "en", "light"), "/login?lang=en&theme=light");
  assert.equal(appHref("/app", "en", "dark"), "/app?lang=en&theme=dark");
  assert.equal(
    appHref("/app/setup?workspace=w1", "ms", "light"),
    "/app/setup?workspace=w1&lang=ms&theme=light",
  );
});

test("pageMetadata hosted", () => {
  set({ JOMCALL_MODE: "hosted", APP_ORIGIN: "https://staging.jomcall.com" });
  const m = pageMetadata("pricing", "ms", { title: "T", description: "D" });
  assert.equal(m.alternates?.canonical, "https://staging.jomcall.com/ms/pricing");
  const langs = m.alternates?.languages as Record<string, string>;
  assert.equal(langs["x-default"], "https://staging.jomcall.com/pricing");
  assert.equal(langs.en, "https://staging.jomcall.com/pricing");
  assert.equal(langs.ms, "https://staging.jomcall.com/ms/pricing");
  assert.equal((m.openGraph as { locale?: string }).locale, "ms_MY");
  assert.deepEqual(m.robots, { index: false, follow: false });
});

test("pageMetadata local is noindex with relative paths", () => {
  set({ JOMCALL_MODE: "local", LOCAL_ORIGIN: "http://127.0.0.1:4182" });
  const m = pageMetadata("home", "en", { title: "T", description: "D" });
  assert.equal(m.alternates?.canonical, "/");
  assert.deepEqual(m.robots, { index: false, follow: false });
  assert.equal((m.openGraph as { locale?: string }).locale, "en_MY");
  set({});
  assert.equal(siteOrigin(), undefined);
});

test("siteOrigin hosted without APP_ORIGIN", () => {
  set({ JOMCALL_MODE: "hosted" });
  assert.throws(() => siteOrigin(), (e: Error) => {
    assert.match(e.message, /MISSING_SETTING: APP_ORIGIN/);
    assert.doesNotMatch(e.message, /https?:|\./);
    return true;
  });
});

// ---------------------------------------------------------------- home page
import { existsSync, readFileSync } from "node:fs";
import { home, sampleCall, CALL_LANGS, VOICED_LINES } from "../../web/content/public/home.ts";
import { rm } from "../../web/content/public/format.ts";
import { publicPlans } from "../../web/lib/pricing.ts";

const HOME_PAGES = { en: "web/app/(public)/page.tsx", ms: "web/app/ms/page.tsx" } as const;

test("home price line comes from the Starter plan", () => {
  assert.equal(rm(publicPlans[0].monthlyFeeSen), "RM 49.00");
  assert.equal(home.en.hero.from, `From ${rm(publicPlans[0].monthlyFeeSen)} a month`);
  assert.equal(home.ms.hero.from, `Bermula ${rm(publicPlans[0].monthlyFeeSen)} sebulan`);
  // No amount is typed into the copy by hand.
  assert.doesNotMatch(readFileSync("web/content/public/home.ts", "utf8"), /RM\s?\d/);
  assert.equal(rm(32), "RM 0.32");
  assert.equal(rm(12900), "RM 129.00");
  assert.equal(rmExact(4900), rm(4900));
});

test("home pages are static: metadata from pageMetadata, no query string", () => {
  assert.ok(!existsSync("web/app/page.tsx"), "old home route still exists");
  for (const [locale, file] of Object.entries(HOME_PAGES)) {
    const src = readFileSync(file, "utf8");
    assert.match(src, new RegExp(`export const metadata(?::\\s*Metadata)?\\s*=\\s*pageMetadata\\(\\s*"home",\\s*"${locale}"`));
    assert.doesNotMatch(src, /searchParams|generateMetadata|headers\(|cookies\(/);
    assert.match(src, new RegExp(`<HomePage locale="${locale}"`));
  }
});

test("home sections follow spec section 7 order", () => {
  const src = readFileSync("web/components/public/pages/home.tsx", "utf8");
  const order = ["hero", "bento", "problem", "how", "languages", "industries", "pricing", "faq", "closing"];
  const at = order.map((id) => src.indexOf(`data-section="${id}"`));
  for (const [i, n] of at.entries()) assert.ok(n >= 0, `missing section ${order[i]}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test("how it works uses the app checklist's six step names", () => {
  assert.deepEqual(home.en.how.steps.map((s) => s.name), [
    "Set up your business", "Test the agent", "Publish the agent",
    "Choose a plan", "Get a phone number", "Take your first real call",
  ]);
  assert.deepEqual(home.ms.how.steps.map((s) => s.name), [
    "Sediakan perniagaan anda", "Uji ejen", "Terbitkan ejen",
    "Pilih pelan", "Dapatkan nombor telefon", "Terima panggilan sebenar pertama",
  ]);
});

test("the sample call shows exactly what the recordings say", () => {
  const clips = JSON.parse(readFileSync("web/lib/demo-call.json", "utf8")) as Record<string, Record<string, { file: string; text: string }>>;
  assert.deepEqual([...CALL_LANGS], ["ms", "manglish", "zh", "en"]);
  assert.deepEqual(sampleCall.map((v) => v.id), [...CALL_LANGS]);
  // The greeting clip (0) also says the call may be recorded, so it is never played.
  assert.deepEqual([...VOICED_LINES], [1, 2, 4, 5]);
  for (const { id: lang, lines } of sampleCall) {
    assert.deepEqual(Object.keys(lines).sort(), ["1", "2", "4", "5"]);
    for (const n of VOICED_LINES) {
      assert.equal(lines[n], clips[lang][String(n)].text, `${lang} line ${n}`);
      assert.ok(existsSync(`web/public/demo-call/${lang}-${n}.m4a`), `${lang}-${n}.m4a`);
    }
  }
  const card = readFileSync("web/components/public/call-card.tsx", "utf8");
  assert.doesNotMatch(card, /-0\.m4a/);
});

test("forwarding codes on the home page match the app's phone screen", () => {
  const phone = readFileSync("web/components/core/phone.tsx", "utf8");
  for (const locale of ["en", "ms"] as const)
    for (const { code, meaning } of home[locale].bento.forward.rows) {
      assert.ok(phone.includes(`\`${code}`) || phone.includes(`"${code}`), `${code} not in phone.tsx`);
      assert.ok(phone.includes(`"${meaning}"`), `${meaning} not in phone.tsx`);
    }
});

test("home FAQ has six questions and WhatsApp appears only as waiting for Meta", () => {
  assert.equal(home.en.faq.items.length, 6);
  assert.equal(home.ms.faq.items.length, 6);
  // A question and its answer are read together.
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object" && "q" in v && "a" in v) strings.push(`${v.q} ${v.a}`);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(home);
  for (const s of strings.filter((s) => /whatsapp/i.test(s)))
    assert.match(s, /Meta/, `WhatsApp without Meta's approval: ${s}`);
});

// ------------------------------------------------------ home review round 1
import { nextInCycle } from "../../web/components/public/call-cycle.ts";
import { SAMPLE_USAGE } from "../../web/content/public/home.ts";

test("the call card cycles the languages once, then rests on the first", () => {
  const seen: number[] = [];
  let state = { voice: 0, auto: true };
  for (let i = 0; i < 10 && state.auto; i += 1) {
    state = nextInCycle(state.voice, CALL_LANGS.length);
    seen.push(state.voice);
  }
  assert.deepEqual(seen, [1, 2, 3, 0]);
  assert.equal(state.auto, false);
});

test("the usage bar is computed from the Starter plan, not typed", () => {
  const included = publicPlans[0].includedVoiceSeconds / 60;
  assert.equal(SAMPLE_USAGE.included, included);
  assert.ok(SAMPLE_USAGE.used > 0 && SAMPLE_USAGE.used < included);
  assert.equal(home.en.bento.price.usage, `${SAMPLE_USAGE.used} of ${included} minutes used`);
  assert.equal(home.ms.bento.price.usage, `${SAMPLE_USAGE.used} daripada ${included} minit digunakan`);
  const bento = readFileSync("web/components/public/bento.tsx", "utf8");
  assert.doesNotMatch(bento, /["'`]\d+%["'`]/);
});

test("a feature a plan lacks is listed apart from what it includes", () => {
  for (const locale of ["en", "ms"] as const) {
    const { payg } = home[locale].pricing.plans;
    assert.equal(payg.missing.length, 1);
    assert.ok(payg.features.every((f) => !/^(No|Tiada)\b/.test(f)), `${locale}: negative feature with a tick`);
  }
  assert.equal(home.en.pricing.plans.payg.missing[0], "No phone number");
  assert.equal(home.ms.pricing.plans.payg.missing[0], "Tiada nombor telefon");
});

// ------------------------------------------------------------ pricing page
import { clampMinutes, estimates, MAX_MINUTES } from "../../web/components/public/estimates.ts";
import { legalAnchors } from "../../web/components/public/legal-anchors.ts";
import { legalCopy } from "../../web/messages/legal.ts";
import { monthlyEstimateSen } from "../../web/lib/pricing.ts";
import { pricing, pricingFaq } from "../../web/content/public/pricing.ts";
import { rmExact } from "../../web/content/public/format.ts";

test("estimates: every phone plan's figure comes from monthlyEstimateSen; pay as you go shows its fee only", () => {
  for (const minutes of [0, 100, 400, 1000, 3000]) {
    const e = estimates(minutes);
    assert.deepEqual(e.rows.map((r) => r.code), publicPlans.map((p) => p.code));
    for (const row of e.rows) {
      const plan = publicPlans.find((p) => p.code === row.code)!;
      assert.equal(row.sen, plan.phoneNumbers > 0 ? monthlyEstimateSen(plan, minutes) : plan.monthlyFeeSen);
      if (!row.phone) assert.equal(row.sen, 0);
    }
  }
});

test("estimates: the cheapest plan is chosen among plans with a phone number", () => {
  // Pay as you go has no phone number, so it never takes the mark, even
  // though its figure is the lowest.
  const cheapest = (m: number) => estimates(m).cheapest;
  assert.equal(cheapest(0), "starter");
  assert.equal(cheapest(100), "starter");
  assert.equal(cheapest(1000), "growth");
  assert.equal(cheapest(400), "growth");
  // A tie goes to the lower monthly fee: both cost RM 129.00 at 350 minutes.
  const tie = estimates(350);
  assert.equal(tie.rows.find((r) => r.code === "starter")!.sen, 12900);
  assert.equal(tie.rows.find((r) => r.code === "growth")!.sen, 12900);
  assert.equal(tie.cheapest, "starter");
  const payg = estimates(0).rows.find((r) => r.code === "payg")!;
  assert.equal(payg.phone, false);
  // No phone number: minutes do not change its figure.
  assert.equal(estimates(3000).rows.find((r) => r.code === "payg")!.sen, payg.sen);
});

test("clampMinutes keeps 0 to 3000 in steps of 10 and survives bad input", () => {
  assert.equal(MAX_MINUTES, 3000);
  assert.equal(clampMinutes(-5), 0);
  assert.equal(clampMinutes(5000), 3000);
  assert.equal(clampMinutes(344), 340);
  assert.equal(clampMinutes(345), 350);
  assert.equal(clampMinutes("250"), 250);
  assert.equal(clampMinutes("abc"), 0);
  assert.equal(clampMinutes(""), 0);
  assert.equal(clampMinutes(Number.NaN), 0);
  assert.equal(clampMinutes(Number.POSITIVE_INFINITY), 0);
  assert.equal(clampMinutes(undefined), 0);
});

test("amounts are shown as RM 49.00 and come from the price table", () => {
  assert.equal(rmExact(4900), "RM 49.00");
  assert.equal(rmExact(32), "RM 0.32");
  assert.doesNotMatch(readFileSync("web/content/public/pricing.ts", "utf8"), /RM\s?\d/);
});

test("pricing FAQ has six questions in a fixed order and answers the trial question", () => {
  for (const locale of ["en", "ms"] as const) {
    const items = pricingFaq(locale);
    assert.equal(items.length, 6);
    assert.equal(items[4].q, pricing[locale].faq.trial.q);
    assert.ok(items.every((i) => i.q && i.a));
  }
  assert.match(pricing.en.faq.trial.a, /no free trial/i);
});

test("pricing pages are static and follow the home route pattern", () => {
  for (const [locale, file] of [["en", "web/app/(public)/pricing/page.tsx"], ["ms", "web/app/ms/pricing/page.tsx"]] as const) {
    const src = readFileSync(file, "utf8");
    assert.match(src, new RegExp(`pageMetadata\\(\\s*"pricing",\\s*"${locale}"`));
    assert.doesNotMatch(src, /searchParams|generateMetadata|headers\(|cookies\(/);
    assert.match(src, new RegExp(`<PricingPage locale="${locale}"`));
  }
  assert.ok(!existsSync("web/app/pricing/page.tsx"), "old pricing route still exists");
});

test("pricing page sends visitors to sign-up and signed-in owners to Billing", () => {
  const src = readFileSync("web/components/public/plan-button.tsx", "utf8");
  assert.match(src, /"\/signup"/);
  assert.match(src, /"\/app\/billing"/);
});

test("pricing content is scanned by the claims guard", () => {
  assert.ok(existsSync("web/content/public/pricing.ts"));
  assert.match(readFileSync("tests/hosting/public-claims.test.ts", "utf8"), /ROOT = resolve\("web\/content\/public"\)/);
});

test("pricing shows WhatsApp only as waiting for Meta", () => {
  for (const locale of ["en", "ms"] as const) {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (v && typeof v === "object" && "q" in v && "a" in v) strings.push(`${v.q} ${v.a}`);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(pricing[locale]);
    // Plain denials and a rate label say nothing is on offer; every other
    // mention carries Meta's approval.
    const plain = new Set(["No WhatsApp agent", "Tiada ejen WhatsApp", "WhatsApp agent conversation", "Perbualan ejen WhatsApp"]);
    for (const s of strings.filter((s) => /whatsapp/i.test(s) && !plain.has(s)))
      assert.match(s, /Meta/, `WhatsApp without Meta's approval: ${s}`);
  }
});

// ------------------------------------------------------------- legal pages
test("legal pages: every heading of the legal text gets a unique anchor, text unchanged", () => {
  for (const locale of ["en", "ms"] as const)
    for (const kind of ["privacy", "terms"] as const) {
      const doc = legalCopy[locale][kind];
      const anchors = legalAnchors(doc);
      assert.deepEqual(anchors.map((a) => a.heading), doc.sections.map((s) => s.heading));
      assert.equal(new Set(anchors.map((a) => a.id)).size, anchors.length);
      for (const a of anchors) assert.match(a.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
});

test("legal pages are static, in the public shell, with the legal text unchanged", () => {
  for (const kind of ["privacy", "terms"] as const)
    for (const [locale, dir] of [["en", "web/app/(public)"], ["ms", "web/app/ms"]] as const) {
      const src = readFileSync(`${dir}/${kind}/page.tsx`, "utf8");
      assert.match(src, new RegExp(`pageMetadata\\(\\s*"${kind}",\\s*"${locale}"`));
      assert.doesNotMatch(src, /searchParams|generateMetadata|headers\(|cookies\(/);
      assert.match(src, new RegExp(`<LegalPage kind="${kind}" locale="${locale}"`));
      assert.ok(!existsSync(`web/app/${kind}/page.tsx`), `old ${kind} route still exists`);
    }
  // The operator facts helper lives in one place.
  assert.match(readFileSync("web/components/public-pages.tsx", "utf8"), /from "\.\/public\/operator"/);
});

// react-dom/server is refused under the react-server condition the test runner
// uses, and the app's "@/" paths need the web tsconfig, so the pages are
// rendered in a child process. It also fills the operator facts into each
// text of the legal copy, the way the page does, so the test can look for it.
function renderLegal(): Record<string, { html: string; filled: Record<string, string> }> {
  const script = `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { LegalBody } from "./web/components/public/legal-body.tsx";
    import { fillOperator } from "./web/components/public/operator.tsx";
    import { legalCopy } from "./web/messages/legal.ts";
    const out = {};
    for (const locale of ["en", "ms"]) for (const kind of ["privacy", "terms"]) {
      const filled = {};
      for (const s of legalCopy[locale][kind].sections)
        for (const x of [...s.paragraphs, ...(s.list ?? []), ...(s.after ?? [])]) filled[x] = fillOperator(x);
      out[locale + "/" + kind] = { html: renderToStaticMarkup(createElement(LegalBody, { kind, locale })), filled };
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const stdout = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "", TSX_TSCONFIG_PATH: "web/tsconfig.json" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

test("legal body renders every heading and paragraph of the legal text, operator facts filled", () => {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const rendered = renderLegal();
  for (const locale of ["en", "ms"] as const)
    for (const kind of ["privacy", "terms"] as const) {
      const { html, filled } = rendered[`${locale}/${kind}`];
      const doc = legalCopy[locale][kind];
      for (const s of doc.sections) {
        assert.ok(html.includes(escape(s.heading)), `${locale} ${kind}: heading "${s.heading}"`);
        for (const x of [...s.paragraphs, ...(s.list ?? []), ...(s.after ?? [])])
          assert.ok(html.includes(escape(filled[x])), `${locale} ${kind}: text under "${s.heading}"`);
      }
      assert.doesNotMatch(html, /\{(?:name|reg|address|email|date)\}/, "operator placeholder left unfilled");
      for (const a of legalAnchors(doc)) assert.ok(html.includes(`id="${a.id}"`));
    }
});

// ---- Task 6: structured data, robots, sitemap, llms.txt -------------------
import { isIndexable } from "../../web/lib/site.ts";
import { breadcrumbLd, faqLd, ldScriptText, organizationLd, softwareAppLd, websiteLd } from "../../web/lib/json-ld.ts";
import { llmsText } from "../../web/lib/llms.ts";
import * as robotsModule from "../../web/app/robots.ts";
import * as sitemapModule from "../../web/app/sitemap.ts";
import { GET as llmsGet } from "../../web/app/llms.txt/route.ts";
import { findBannedClaims } from "../../web/content/public/claims.ts";

// web/ has no "type": "module", so tsx may hand back the default export one level down.
const unwrap = <T,>(m: unknown): T => {
  const d = (m as { default: unknown }).default;
  return ((d as { default?: unknown }).default ?? d) as T;
};
const robots = unwrap<() => ReturnType<typeof import("../../web/app/robots.ts").default>>(robotsModule);
const sitemap = unwrap<() => ReturnType<typeof import("../../web/app/sitemap.ts").default>>(sitemapModule);

const PROD = { JOMCALL_MODE: "hosted", APP_ORIGIN: "https://jomcall.com" } as const;
const STAGING = { JOMCALL_MODE: "hosted", APP_ORIGIN: "https://staging.jomcall.com" } as const;

test("isIndexable is true only for hosted jomcall.com", () => {
  set(PROD);
  assert.equal(isIndexable(), true);
  set(STAGING);
  assert.equal(isIndexable(), false);
  set({ JOMCALL_MODE: "hosted", APP_ORIGIN: "https://www.jomcall.com" });
  assert.equal(isIndexable(), false);
  set({ JOMCALL_MODE: "hosted", APP_ORIGIN: "https://jomcall.com.evil.test" });
  assert.equal(isIndexable(), false);
  set({ JOMCALL_MODE: "mock" });
  assert.equal(isIndexable(), false);
  set({});
  assert.equal(isIndexable(), false);
});

test("page metadata robots follow isIndexable", () => {
  const meta = { title: "t", description: "d" };
  set(STAGING);
  assert.deepEqual(pageMetadata("pricing", "en", meta).robots, { index: false, follow: false });
  set(PROD);
  assert.equal(pageMetadata("pricing", "en", meta).robots, undefined);
  set({ JOMCALL_MODE: "mock" });
  assert.deepEqual(pageMetadata("pricing", "en", meta).robots, { index: false, follow: false });
});

test("robots: closed everywhere but jomcall.com", () => {
  const rules = () => robots().rules as { allow?: string; disallow?: string | string[] };
  set({ JOMCALL_MODE: "mock" });
  assert.equal(rules().disallow, "/");
  set(STAGING);
  assert.equal(rules().disallow, "/");
  assert.equal(robots().sitemap, undefined);
  set(PROD);
  assert.equal(rules().allow, "/");
  for (const p of ["/app", "/api", "/invite", "/login", "/signup", "/forgot-password", "/open-link", "/admin"])
    assert.ok((rules().disallow as string[]).includes(p), p);
  assert.equal(robots().sitemap, "https://jomcall.com/sitemap.xml");
});

test("sitemap: 48 canonical urls with en and ms alternates on jomcall.com, empty elsewhere", () => {
  set(PROD);
  const map = sitemap();
  // 25 pages in two languages, less the forwarding guide, whose canonical
  // is /call-forwarding (Task 8).
  assert.equal(map.length, 48);
  assert.ok(!map.some((e) => e.url.includes("/guides/call-forwarding-malaysia")));
  assert.ok(map.some((e) => e.url === "https://jomcall.com/call-forwarding"));
  for (const entry of map) {
    const langs = (entry.alternates as { languages: Record<string, string> }).languages;
    assert.ok(langs.en?.startsWith("https://jomcall.com") && langs.ms?.startsWith("https://jomcall.com"));
  }
  assert.ok(map.some((e) => e.url === "https://jomcall.com/ms/pricing"));
  set(STAGING);
  assert.deepEqual(sitemap(), []);
  set({ JOMCALL_MODE: "mock" });
  assert.deepEqual(sitemap(), []);
  set({ JOMCALL_MODE: "local", LOCAL_ORIGIN: "http://localhost:4182" });
  assert.deepEqual(sitemap(), []);
});

test("llms.txt: 404 off jomcall.com, every url and no banned claim on it", async () => {
  set(STAGING);
  assert.equal(llmsGet().status, 404);
  set({ JOMCALL_MODE: "mock" });
  assert.equal(llmsGet().status, 404);
  set(PROD);
  const res = llmsGet();
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, llmsText());
  for (const { id, canonical } of PUBLIC_PAGES)
    for (const l of ["en", "ms"] as const) {
      const listed = body.includes(`https://jomcall.com${localePath(id, l)})`);
      // A page whose canonical is another page is not listed as its own page.
      assert.equal(listed, !canonical, id + l);
    }
  assert.deepEqual(findBannedClaims(body, "llms"), []);
  assert.ok(body.includes("RM 49.00") && body.includes("RM 129.00"));
  assert.ok(body.includes("waiting for Meta's approval"));
  assert.doesNotMatch(body, /tamil|free trial|calendar|recorded for|instant/i);
});

// <JsonLd> is rendered in a child process (react-dom/server is refused under
// the react-server condition), once with data and once with null.
function renderLd(): { html: string; none: string } {
  const script = `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { JsonLd } from "./web/components/public/json-ld.tsx";
    import { faqLd } from "./web/lib/json-ld.ts";
    process.stdout.write(JSON.stringify({
      html: renderToStaticMarkup(createElement(JsonLd, { data: faqLd([{ q: "a</script><b>", a: "x" }]) })),
      none: renderToStaticMarkup(createElement(JsonLd, { data: null })),
    }));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "", TSX_TSCONFIG_PATH: "web/tsconfig.json" },
    }),
  );
}

test("JSON-LD: offers, no ratings, escaped, absolute urls", () => {
  set(PROD);
  const app = softwareAppLd("en") as { offers: { price: string; priceCurrency: string }[] };
  assert.deepEqual(app.offers.map((o) => o.price), ["49.00", "129.00", "0.00"]);
  assert.ok(app.offers.every((o) => o.priceCurrency === "MYR"));
  const all = JSON.stringify([organizationLd(), websiteLd(), app, breadcrumbLd("privacy", "ms"), faqLd(pricingFaq("en"))]);
  assert.doesNotMatch(all, /aggregateRating|review|ratingValue/i);
  const crumbs = (breadcrumbLd("compare-voicemail", "en") as { itemListElement: { item: string }[] }).itemListElement;
  assert.deepEqual(crumbs.map((c) => c.item), [
    "https://jomcall.com/",
    "https://jomcall.com/compare",
    "https://jomcall.com/compare/voicemail",
  ]);
  const { html, none } = renderLd();
  assert.equal(html.match(/<\/script/g)?.length, 1);
  assert.ok(html.includes("a\\u003c/script>"));
  assert.equal(none, "");
  set({ JOMCALL_MODE: "mock" });
  assert.equal(organizationLd(), null);
  assert.equal(softwareAppLd("en"), null);
});
