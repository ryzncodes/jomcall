// The public shell (header, footer, tokens, fonts, theme script) stays apart
// from the app: no app code in the public bundle, one token set scoped to
// `.public`, fonts served from this site only, and a theme applied before
// the first paint on public pages and nowhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PRE_PAINT_SCRIPT, THEME_KEY } from "../../web/lib/theme-script.ts";
import { PUBLIC_PAGES } from "../../web/lib/site.ts";
import { common } from "../../web/content/public/common.ts";
import {
  FOOTER_PAGES,
  headerEntries,
  languageLink,
} from "../../web/components/public/nav.ts";

const PUBLIC_DIRS = ["web/components/public", "web/app/(public)", "web/app/ms"];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Every module specifier a file imports, re-exports or loads dynamically.
function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const FORBIDDEN = [resolve("web/components/core"), resolve("web/components/experience")];

function forbidden(file: string, spec: string): boolean {
  let target: string;
  if (spec.startsWith("@/")) target = resolve("web", spec.slice(2));
  else if (spec.startsWith(".")) target = resolve(dirname(file), spec);
  else return false;
  target = target.replace(/\.(ts|tsx)$/, "");
  return FORBIDDEN.some((f) => target === f || target.startsWith(f + "/"));
}

test("the public shell exists and is scanned", () => {
  const found = PUBLIC_DIRS.flatMap(files);
  for (const name of ["shell.tsx", "header.tsx", "nav-menu.tsx", "theme-toggle.tsx", "cta.tsx", "footer.tsx", "operator.tsx", "links.ts"])
    assert.ok(found.includes(join("web/components/public", name)), `missing ${name}`);
});

test("public pages import no app code and never read the query string", () => {
  for (const file of PUBLIC_DIRS.flatMap(files)) {
    const src = readFileSync(file, "utf8");
    for (const spec of specifiers(src))
      assert.ok(!forbidden(file, spec), `${file} imports ${spec}`);
    assert.doesNotMatch(src, /\buseSearchParams\b/, `${file} uses useSearchParams`);
  }
});

test("the guard catches relative and aliased app imports", () => {
  const file = "web/components/public/x.tsx";
  assert.ok(forbidden(file, "@/components/core/phone"));
  assert.ok(forbidden(file, "@/components/experience"));
  assert.ok(forbidden(file, "../core/state"));
  assert.ok(forbidden(file, "../experience.tsx"));
  assert.ok(!forbidden(file, "@/components/signed-in"));
  assert.ok(!forbidden(file, "./links"));
  assert.deepEqual(
    specifiers(`import { a } from "@/components/core/x";\nimport "./y.css";\nconst z = import("../experience");`),
    ["@/components/core/x", "./y.css", "../experience"],
  );
});

const css = readFileSync("web/app/public.css", "utf8");

test("public.css defines every Kaunter token", () => {
  const names = [
    "--paper", "--surface", "--forest", "--on-forest", "--lime", "--ink", "--muted", "--line",
    ...Array.from({ length: 10 }, (_, i) => `--space-${i + 1}`),
    "--radius-pill", "--radius-8", "--radius-12", "--radius-16", "--radius-24",
    "--ease", "--t-micro", "--t-std", "--t-reveal", "--frame", "--measure",
  ];
  for (const name of names) assert.match(css, new RegExp(`${name}\\s*:`), `missing ${name}`);
  for (const cls of [".t-display", ".t-h2", ".t-h3", ".t-lead", ".t-body", ".t-small", ".t-label", ".t-data"])
    assert.ok(css.includes(cls), `missing ${cls}`);
});

test("public.css uses the measured values", () => {
  const value = (name: string) => css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim();
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => value(`--space-${i + 1}`)),
    ["4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px", "96px", "128px"],
  );
  assert.equal(value("--ease"), "cubic-bezier(0.2, 0.8, 0.2, 1)");
  assert.equal(value("--t-micro"), "120ms");
  assert.equal(value("--t-std"), "220ms");
  assert.equal(value("--t-reveal"), "480ms");
  assert.equal(value("--frame"), "1200px");
  assert.equal(value("--measure"), "640px");
  assert.equal(value("--paper"), "#f2f4ee");
  assert.equal(value("--forest"), "#1f3a2e");
  assert.match(css, /\[data-theme="dark"\] \.public/);
  assert.match(css, /prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme="light"\]\) \.public/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/);
});

test("every public.css rule is scoped to .public", () => {
  // Strip comments and at-rule wrappers, then check each selector list.
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([^{}@]+)\{[^{}]*\}/g)) {
    const selectors = m[1].trim();
    if (!selectors || /^(from|to|\d+%)/.test(selectors)) continue;
    // Split on top-level commas only, not those inside :where(...) or :not(...).
    for (const sel of selectors.split(/,(?![^(]*\))/))
      assert.match(sel.trim(), /\.public|^body:has\(\.public\)/, `unscoped selector: ${sel.trim()}`);
  }
});

test("the root layout loads fonts locally and allows the theme script", () => {
  const layout = readFileSync("web/app/layout.tsx", "utf8");
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /import "\.\/public\.css"/);
  assert.match(layout, /PRE_PAINT_SCRIPT/);
  assert.doesNotMatch(layout, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  // Fonts belong to the public shell only: the app has its own --font-*
  // variables and must not get Plex Mono, nor preload the public faces.
  assert.doesNotMatch(layout, /fonts|fontVariables/);
  const shell = readFileSync("web/components/public/shell.tsx", "utf8");
  assert.match(shell, /import \{ fontVariables \} from "@\/lib\/fonts"/);
  assert.match(shell, /className=\{`public \$\{fontVariables\}`\}/);
  const fonts = readFileSync("web/lib/fonts.ts", "utf8");
  const vars = [...fonts.matchAll(/variable: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(vars, ["--kaunter-font-display", "--kaunter-font-text", "--kaunter-font-mono"]);
  assert.doesNotMatch(css, /var\(--font-(display|text|mono)\)/);
  assert.match(fonts, /from "next\/font\/local"/);
  assert.doesNotMatch(fonts, /next\/font\/google/);
  assert.equal(fonts.match(/display: "swap"/g)?.length, 3);
  assert.ok(existsSync("web/public/fonts/FamiljenGrotesk.ttf"));
  assert.ok(existsSync("web/public/fonts/FamiljenGrotesk-OFL.txt"));
});

// Runs the pre-paint script against a fake browser.
function run({
  path,
  search = "",
  stored,
  dark = false,
  storageThrows = false,
}: {
  path: string;
  search?: string;
  stored?: string;
  dark?: boolean;
  storageThrows?: boolean;
}) {
  const store = new Map<string, string>(stored === undefined ? [] : [[THEME_KEY, stored]]);
  const root = { lang: "en", dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const window = {
    get localStorage() {
      if (storageThrows) throw Error("SecurityError");
      return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    },
    location: { pathname: path, search },
    matchMedia: (q: string) => ({ matches: dark && q === "(prefers-color-scheme: dark)" }),
    document: { documentElement: root },
  };
  new Function("window", "document", "location", PRE_PAINT_SCRIPT)(window, window.document, window.location);
  return { theme: root.dataset.theme, scheme: root.style.colorScheme, lang: root.lang, stored: store.get(THEME_KEY) };
}

test("pre-paint script: stored choice, then the operating system", () => {
  assert.equal(run({ path: "/pricing", stored: "dark" }).theme, "dark");
  assert.equal(run({ path: "/pricing", stored: "light", dark: true }).theme, "light");
  assert.equal(run({ path: "/pricing", dark: true }).theme, "dark");
  assert.equal(run({ path: "/pricing" }).theme, "light");
  assert.equal(run({ path: "/pricing", stored: "blue", dark: true }).theme, "dark");
  assert.equal(run({ path: "/pricing", dark: true }).scheme, "dark");
});

test("pre-paint script: ?theme is honoured and stored", () => {
  const r = run({ path: "/", search: "?theme=dark" });
  assert.equal(r.theme, "dark");
  assert.equal(r.stored, "dark");
  assert.equal(run({ path: "/", search: "?theme=dark", stored: "light" }).theme, "dark");
  assert.equal(run({ path: "/", search: "?theme=red", stored: "light" }).theme, "light");
});

test("pre-paint script survives blocked storage", () => {
  assert.equal(run({ path: "/faq", storageThrows: true, dark: true }).theme, "dark");
  assert.equal(run({ path: "/faq", search: "?theme=dark", storageThrows: true }).theme, "dark");
});

test("pre-paint script sets Bahasa Melayu on /ms pages only", () => {
  assert.equal(run({ path: "/ms" }).lang, "ms");
  assert.equal(run({ path: "/ms/" }).lang, "ms");
  assert.equal(run({ path: "/ms/pricing" }).lang, "ms");
  assert.equal(run({ path: "/pricing" }).lang, "en");
});

test("pre-paint script leaves app pages alone", () => {
  for (const path of ["/app", "/app/calls", "/login", "/signup", "/msx", "/ms/app"]) {
    const r = run({ path, stored: "dark", dark: true });
    assert.equal(r.theme, undefined, path);
    assert.equal(r.lang, "en", path);
  }
});

test("the footer links every public page once", () => {
  assert.deepEqual([...FOOTER_PAGES].sort(), PUBLIC_PAGES.map((p) => p.id).sort());
});

test("header menus follow the visitor flow, in both languages", () => {
  for (const locale of ["en", "ms"] as const) {
    const entries = headerEntries(locale, "pricing");
    const shape = entries.map((e) =>
      e.kind === "link" ? e.href : [e.id, e.items.length, e.foot?.href ?? null],
    );
    const prefix = locale === "ms" ? "/ms" : "";
    assert.deepEqual(shape, [
      ["product", 4, null],
      ["industries", 6, `${prefix}/industries`],
      `${prefix}/pricing`,
      ["resources", 3, null],
    ]);
    const pricing = entries.find((e) => e.kind === "link");
    assert.equal(pricing?.kind === "link" && pricing.current, true);
  }
  assert.deepEqual(languageLink("en", "faq"), { href: "/ms/faq", label: "Bahasa Melayu", lang: "ms" });
  assert.deepEqual(languageLink("ms", "home"), { href: "/", label: "English", lang: "en" });
});

test("English and BM labels have the same keys and BM avoids Indonesian words", () => {
  const keys = (o: object, at = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === "object" && v ? keys(v, `${at}${k}.`) : [`${at}${k}`],
    );
  assert.deepEqual(keys(common.ms), keys(common.en));
  const bm = JSON.stringify(common.ms).toLowerCase();
  for (const word of ["kamu", "uang", "kantor", "mobil", "bisa"])
    assert.doesNotMatch(bm, new RegExp(`\\b${word}\\b`), word);
});

test("the call to action keeps one width while the session check runs", () => {
  // Every state reserves the other label's width, and phones use short labels,
  // so the header never jumps or overflows at 360 px when signed in.
  const cta = readFileSync("web/components/public/cta.tsx", "utf8");
  assert.match(cta, /cta-reserve/);
  assert.match(css, /\.public \.cta-reserve\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*?\.public \.site-header \.cta-full\s*\{\s*display:\s*none/);
  for (const locale of ["en", "ms"] as const) {
    assert.ok(common[locale].openWorkspaceShort.length <= common[locale].getStarted.length + 2, locale);
  }
});
