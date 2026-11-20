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
  assert.equal(r("https://x.test/pricing?lang=ms&theme=dark"), "https://x.test/ms/pricing");
  assert.equal(r("https://x.test/?lang=ms"), "https://x.test/ms");
  assert.equal(r("https://x.test/?lang=en&theme=dark"), "https://x.test/");
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
