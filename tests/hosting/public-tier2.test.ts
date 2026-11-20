// Tier 2 pages (spec section 5): the comparison pages and their index, the
// trust page, and the guides and their index. Checks that every JomCall
// claim comes from its single source, that no rival is named, that the
// forwarding guide's canonical points at /call-forwarding, and that every
// route is static.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PUBLIC_PAGES, canonicalPage, localePath } from "../../web/lib/site.ts";
import { pageMetadata } from "../../web/lib/public-meta.ts";
import { whatsappWaiting } from "../../web/lib/launch.ts";
import { llmsText } from "../../web/lib/llms.ts";
import {
  COMPARE_SLUGS,
  FACT_KEYS,
  compare,
  compareIndex,
  compareLabels,
  jomcallFacts,
} from "../../web/content/public/compare.ts";
import { trust } from "../../web/content/public/trust.ts";
import { GUIDE_SLUGS, guides, guidesIndex, worksheetCopy } from "../../web/content/public/guides.ts";

const LOCALES = ["en", "ms"] as const;
const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
};
const MODULES = ["compare", "trust", "guides"] as const;

// --------------------------------------------------------------- compare

test("the four comparison slugs are the registry's", () => {
  const slugs = PUBLIC_PAGES.filter((p) => p.parent === "compare").map((p) => p.path.split("/").pop());
  assert.deepEqual(slugs, [...COMPARE_SLUGS]);
});

test("every JomCall cell is a line of jomcallFacts, in both languages", () => {
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(jomcallFacts[locale]).sort(), [...FACT_KEYS].sort());
    for (const key of FACT_KEYS) assert.ok(jomcallFacts[locale][key].trim(), `${locale} ${key}`);
    for (const slug of COMPARE_SLUGS)
      for (const row of compare[locale][slug].table.rows)
        assert.ok((FACT_KEYS as readonly string[]).includes(row.us), `${locale} ${slug}: ${row.us}`);
  }
  // Each fact names its spec section 3 row in the source.
  const src = readFileSync("web/content/public/compare.ts", "utf8");
  const block = src.slice(src.indexOf("export const jomcallFacts"), src.indexOf("  ms: {", src.indexOf("export const jomcallFacts")));
  for (const key of FACT_KEYS) assert.match(block, new RegExp(`// §3[^\\n]*\\n\\s*${key}:`), key);
  // The rows mean the same thing in both languages.
  for (const slug of COMPARE_SLUGS)
    assert.deepEqual(
      compare.en[slug].table.rows.map((r) => r.us),
      compare.ms[slug].table.rows.map((r) => r.us),
      slug,
    );
});

test("each comparison says when the other option is better, with a table", () => {
  for (const locale of LOCALES)
    for (const slug of COMPARE_SLUGS) {
      const page = compare[locale][slug];
      assert.ok(page.table.rows.length >= 6, `${locale} ${slug}: rows`);
      assert.ok(page.better.them.points.length >= 3, `${locale} ${slug}: the other option`);
      assert.ok(page.better.us.points.length >= 3, `${locale} ${slug}: JomCall`);
      assert.ok(page.faqs.length >= 3 && page.faqs.every((f) => f.q && f.a));
      assert.equal(page.better.them.name.startsWith(page.them), true, `${locale} ${slug}: the other option comes first`);
    }
});

test("no rival product is named", () => {
  const text = strings([compare, compareIndex, compareLabels, guides, trust]).join("\n");
  assert.doesNotMatch(
    text,
    /\b(?:Smith\.ai|Ruby|Dialpad|Aircall|RingCentral|Ooma|Grasshopper|Talkdesk|Vapi|Bland|Retell|Synthflow|Goodcall|TeamFollowUp|WATI|Interakt|Gupshup|respond\.io|ManyChat|Twilio|Maxis|Celcom|Digi|U Mobile|Unifi|TM)\b/i,
  );
});

test("the receptionist page states no salary: the visitor types it", () => {
  for (const name of MODULES)
    assert.doesNotMatch(readFileSync(`web/content/public/${name}.ts`, "utf8"), /RM\s?\d/, name);
  const page = readFileSync("web/components/public/pages/compare.tsx", "utf8");
  assert.match(page, /slug === "receptionist"[\s\S]*?<Worksheet locale=\{locale\} mode="cost" \/>/);
  const sheet = readFileSync("web/components/public/worksheet.tsx", "utf8");
  assert.match(sheet, /useState\(""\)/, "the cost field starts empty");
  for (const locale of LOCALES)
    assert.match(compare[locale].receptionist.table.rows.find((r) => r.us === "price")!.them, /sheet|helaian/i);
});

test("the WhatsApp bot page says plainly that JomCall's WhatsApp is waiting for Meta", () => {
  for (const [i, locale] of LOCALES.entries()) {
    assert.equal(jomcallFacts[locale].whatsapp, `${whatsappWaiting.title[i]}.`);
    assert.equal(compareLabels[locale].waiting.title, `${whatsappWaiting.title[i]}.`);
    const page = compare[locale]["whatsapp-bot"];
    assert.ok(page.table.rows.some((r) => r.us === "whatsapp"));
    assert.ok(page.description.includes(whatsappWaiting.short[i]), `${locale}: description`);
    // No other JomCall fact mentions WhatsApp.
    for (const key of FACT_KEYS.filter((k) => k !== "whatsapp"))
      assert.doesNotMatch(jomcallFacts[locale][key], /whatsapp/i, `${locale} ${key}`);
  }
  const src = readFileSync("web/components/public/pages/compare.tsx", "utf8");
  assert.match(src, /slug === "whatsapp-bot" \?[\s\S]*?l\.waiting\.title/);
});

// ----------------------------------------------------------------- trust

test("the trust page makes no compliance or certification claim", () => {
  const text = strings(trust).join("\n");
  assert.doesNotMatch(text, /complian|certif|patuh|pematuhan|PDPA|ISO\b|SOC ?2|GDPR/i);
  // The component's markup, without its comments.
  const page = readFileSync("web/components/public/pages/trust.tsx", "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(page, /complian|certif|patuh|PDPA/i);
});

test("the trust page is fact rows and document links only, nothing quoted from the legal text", () => {
  const page = readFileSync("web/components/public/pages/trust.tsx", "utf8");
  assert.doesNotMatch(page, /<blockquote|legalCopy\[locale\]\.privacy\.sections|providersSection/);
  // The providers row points to the privacy notice, in the facts table.
  assert.match(page, /fact: t\.providers\.fact[\s\S]*?href=\{privacy\}/);
  assert.match(page, /\(\["privacy", "terms"\] as const\)\.map/);
  for (const locale of LOCALES) assert.doesNotMatch(trust[locale].providers.detail, /record|rakam|WhatsApp|Meta/i);
});

test("the trust facts start with calls not being recorded and the AI disclosure", () => {
  assert.equal(trust.en.facts.rows[0].fact, "Calls are not recorded.");
  assert.equal(trust.ms.facts.rows[0].fact, "Panggilan tidak dirakam.");
  assert.match(trust.en.facts.rows[1].fact, /AI/);
  assert.match(trust.en.operator.detail, /\{name\}.*\{reg\}/);
  assert.equal(trust.en.facts.rows.length, trust.ms.facts.rows.length);
});

// ---------------------------------------------------------------- guides

test("the three guide slugs are the registry's", () => {
  const slugs = PUBLIC_PAGES.filter((p) => p.parent === "guides").map((p) => p.path.split("/").pop());
  assert.deepEqual(slugs, [...GUIDE_SLUGS]);
});

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

test("the forwarding guide's canonical, alternates and Open Graph URL are /call-forwarding", () => {
  assert.equal(canonicalPage("guides-call-forwarding-malaysia"), "call-forwarding");
  // Only this page names another page as its canonical.
  assert.deepEqual(PUBLIC_PAGES.filter((p) => p.canonical).map((p) => p.id), ["guides-call-forwarding-malaysia"]);
  set({ JOMCALL_MODE: "hosted", APP_ORIGIN: "https://jomcall.com" });
  for (const locale of LOCALES) {
    const m = pageMetadata("guides-call-forwarding-malaysia", locale, guides[locale]["call-forwarding-malaysia"]);
    const target = `https://jomcall.com${localePath("call-forwarding", locale)}`;
    assert.equal(m.alternates?.canonical, target);
    const langs = m.alternates?.languages as Record<string, string>;
    assert.equal(langs.en, "https://jomcall.com/call-forwarding");
    assert.equal(langs.ms, "https://jomcall.com/ms/call-forwarding");
    assert.equal((m.openGraph as { url?: string }).url, target);
    // Its own title stays.
    assert.equal(m.title, guides[locale]["call-forwarding-malaysia"].title);
    // Every other new page is its own canonical.
    const own = pageMetadata("guides-missed-calls-cost", locale, guides[locale]["missed-calls-cost"]);
    assert.equal(own.alternates?.canonical, `https://jomcall.com${localePath("guides-missed-calls-cost", locale)}`);
  }
});

test("the forwarding guide reuses the app's codes and points to the full guide", () => {
  const page = readFileSync("web/components/public/pages/guide.tsx", "utf8");
  assert.match(page, /<CodesCard locale=\{locale\} \/>/);
  assert.match(page, /localePath\("call-forwarding", locale\)/);
  assert.match(readFileSync("web/components/public/pages/call-forwarding.tsx", "utf8"), /<CodesCard locale=\{locale\} \/>/);
  for (const name of MODULES)
    assert.doesNotMatch(
      readFileSync(`web/content/public/${name}.ts`, "utf8"),
      /(?:\*\*|##)\d+[*#]/,
      `${name}: a code typed by hand`,
    );
});

test("the missed-calls guide is a worksheet with the visitor's own figures", () => {
  const page = readFileSync("web/components/public/pages/guide.tsx", "utf8");
  assert.match(page, /<Worksheet locale=\{locale\} mode="missed" \/>/);
  assert.match(worksheetCopy.en.missed.example, /example[^.]*not an average/i);
  assert.match(worksheetCopy.ms.missed.example, /contoh[^.]*bukan purata/i);
  assert.match(worksheetCopy.en.missed.fine, /your own estimate/);
  assert.match(worksheetCopy.ms.missed.fine, /anggaran anda sendiri/);
  // No statistic about callers anywhere in the new content.
  const text = strings([compare, guides, trust, worksheetCopy]).join("\n");
  assert.doesNotMatch(text, /\b\d+% of (?:callers|customers|businesses|people|calls)\b|\bstud(?:y|ies) (?:show|found)/i);
});

// --------------------------------------------------------- shared rules

test("no page promises that every caller is caught", () => {
  const text = strings([compare, compareIndex, compareLabels, trust, guides, guidesIndex, worksheetCopy]).join("\n");
  assert.doesNotMatch(
    text,
    /\bevery (?:job|request|time|parent|caller)\b|\bno (?:one|parent|caller) is\b|nobody is missed|never miss|always answers|setiap kali|tercicir|tiada sesiapa/i,
  );
});

test("nothing claims browser tests are free, or that the agent never makes things up", () => {
  const text = strings([compare, trust, guides]).join("\n");
  assert.doesNotMatch(text, /tests? (are )?(not (billed|charged)|free)|ujian[^.]*(tidak dicaj|percuma)/i);
  assert.doesNotMatch(text, /does not make up|never makes up|mereka-reka/i);
});

test("BM uses temu janji and plain wording", () => {
  const ms = strings([compare.ms, compareIndex.ms, compareLabels.ms, trust.ms, guides.ms, guidesIndex.ms, worksheetCopy.ms]).join("\n");
  assert.doesNotMatch(ms, /janji temu|menyerahkan|tuturkan|memegang talian|Menyuruh|buat masa ini|berterus terang|Adakah percubaan|Apa berlaku|\bkamu\b|\buang\b|\bkantor\b|\bmobil\b/);
});

// ---------------------------------------------------------------- routes

const DIRS = { en: "web/app/(public)", ms: "web/app/ms" } as const;

test("the compare, trust and guides indexes have static routes in both languages", () => {
  for (const locale of LOCALES)
    for (const id of ["compare", "trust", "guides"] as const) {
      const file = `${DIRS[locale]}/${id}/page.tsx`;
      assert.ok(existsSync(file), file);
      const src = readFileSync(file, "utf8");
      assert.match(src, new RegExp(`pageMetadata\\(\\s*"${id}",\\s*"${locale}"`), file);
      assert.match(src, new RegExp(`locale="${locale}"`), file);
      assert.doesNotMatch(src, /searchParams|headers\(|cookies\(/, file);
    }
});

test("comparison and guide pages are generated for their slugs only, with metadata per slug", () => {
  for (const locale of LOCALES)
    for (const family of ["compare", "guides"] as const) {
      const file = `${DIRS[locale]}/${family}/[slug]/page.tsx`;
      assert.ok(existsSync(file), file);
      const src = readFileSync(file, "utf8");
      assert.match(src, /export const dynamicParams = false/);
      assert.match(src, /export function generateStaticParams\(/);
      assert.match(src, new RegExp(`return pageMetadata\\(\`${family}-\\$\\{slug\\}\`, "${locale}", ${family === "compare" ? "compare" : "guides"}\\.${locale}\\[slug\\]\\)`));
      assert.match(src, new RegExp(`locale="${locale}"`));
      assert.doesNotMatch(src, /searchParams|headers\(|cookies\(/);
    }
});

test("llms.txt describes each Tier 2 page with its own meta description", () => {
  process.env.JOMCALL_MODE = "mock";
  const body = llmsText();
  for (const locale of LOCALES) {
    const descriptions = [
      compareIndex[locale].page.description,
      ...COMPARE_SLUGS.map((s) => compare[locale][s].description),
      trust[locale].page.description,
      guidesIndex[locale].page.description,
      ...GUIDE_SLUGS.filter((s) => s !== "call-forwarding-malaysia").map((s) => guides[locale][s].description),
    ];
    for (const d of descriptions) {
      assert.ok(body.includes(d), d);
      assert.match(d, /\.$/, d);
    }
    // The canonicalised guide is not listed as a page of its own.
    assert.ok(!body.includes(guides[locale]["call-forwarding-malaysia"].description));
  }
});
