import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_PAGES,
  localePath,
  siteOrigin,
} from "../../web/lib/site.ts";
import { pageMetadata } from "../../web/lib/public-meta.ts";
import { legacyRedirect } from "../../web/proxy.ts";

const saved = { ...process.env };
function set(values: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries({ NODE_ENV: "test", ...values }))
    if (value !== undefined) process.env[key] = value;
}
after(() => set(saved));

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
