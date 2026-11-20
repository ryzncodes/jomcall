import { test, after } from "node:test";
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
  assert.equal(m.robots, undefined);
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
  assert.equal(rm(publicPlans[0].monthlyFeeSen), "RM 49");
  assert.equal(home.en.hero.from, `From ${rm(publicPlans[0].monthlyFeeSen)} a month`);
  assert.equal(home.ms.hero.from, `Bermula ${rm(publicPlans[0].monthlyFeeSen)} sebulan`);
  // No amount is typed into the copy by hand.
  assert.doesNotMatch(readFileSync("web/content/public/home.ts", "utf8"), /RM\s?\d/);
  assert.equal(rm(32), "RM 0.32");
  assert.equal(rm(12900), "RM 129");
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
