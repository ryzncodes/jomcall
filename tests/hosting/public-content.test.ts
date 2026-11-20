// Tier 1 content pages (spec section 5): how it works, call forwarding,
// languages, the FAQ hub, the industries index and the six industry pages.
// Checks the content's size and facts against their single sources, and that
// every route is static.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { businessTypes } from "../../packages/domain/src/setup/business-types.ts";
import { PUBLIC_PAGES, localePath } from "../../web/lib/site.ts";
import { common } from "../../web/content/public/common.ts";
import { home } from "../../web/content/public/home.ts";
import { howItWorks } from "../../web/content/public/how-it-works.ts";
import { FORWARD_CODES, forwarding } from "../../web/content/public/call-forwarding.ts";
import { languages } from "../../web/content/public/languages.ts";
import { faq, faqGroups, faqItems, FAQ_GROUPS } from "../../web/content/public/faq.ts";
import {
  INDUSTRY_SLUGS,
  industries,
  industriesIndex,
  SETUP_TYPE_IDS,
} from "../../web/content/public/industries.ts";

const LOCALES = ["en", "ms"] as const;

test("each industry has at least 4 questions and a sample call of at least 4 lines", () => {
  assert.deepEqual([...INDUSTRY_SLUGS], [
    "clinics", "salons", "car-workshops", "aircond-home-repair", "restaurants", "tuition-centres",
  ]);
  for (const locale of LOCALES)
    for (const slug of INDUSTRY_SLUGS) {
      const page = industries[locale][slug];
      assert.ok(page.faqs.length >= 4, `${locale} ${slug}: ${page.faqs.length} questions`);
      assert.ok(page.sample.length >= 4, `${locale} ${slug}: ${page.sample.length} sample lines`);
      assert.ok(page.calls.rows.length >= 3, `${locale} ${slug}: calls`);
      assert.ok(page.faqs.every((f) => f.q && f.a));
      // The agent speaks first and says it is an AI.
      assert.equal(page.sample[0].who, "agent", `${locale} ${slug}: sample opens with the agent`);
      assert.match(page.sample[0].text, /\bAI\b/, `${locale} ${slug}: sample opens with the AI disclosure`);
    }
});

test("the FAQ hub has at least 18 questions in the six groups of spec section 5", () => {
  assert.deepEqual([...FAQ_GROUPS], ["price", "number", "languages", "ai", "privacy", "whatsapp"]);
  for (const locale of LOCALES) {
    const items = faqItems(locale);
    assert.ok(items.length >= 18, `${locale}: ${items.length} questions`);
    assert.equal(new Set(items.map((i) => i.q)).size, items.length, `${locale}: duplicate question`);
    assert.deepEqual(faqGroups(locale).map((g) => g.id), [...FAQ_GROUPS]);
    for (const g of faqGroups(locale)) assert.ok(g.items.length >= 2, `${locale} ${g.id}`);
  }
  // The trial answer sits at a key the claims guard allows (faq.trial).
  assert.match(faq.en.groups.price.faq.trial.q, /free trial/i);
  assert.match(faq.en.groups.price.faq.trial.a, /^No\b.*no free trial/i);
  assert.match(faq.ms.groups.price.faq.trial.a, /^Tidak\b/);
});

test("how it works uses the app checklist's six step names, the same as home", () => {
  for (const locale of LOCALES)
    assert.deepEqual(
      howItWorks[locale].steps.items.map((s) => s.name),
      home[locale].how.steps.map((s) => s.name),
    );
  assert.deepEqual(howItWorks.en.steps.items.map((s) => s.name), [
    "Set up your business", "Test the agent", "Publish the agent",
    "Choose a plan", "Get a phone number", "Take your first real call",
  ]);
  assert.deepEqual(howItWorks.ms.steps.items.map((s) => s.name), [
    "Sediakan perniagaan anda", "Uji ejen", "Terbitkan ejen",
    "Pilih pelan", "Dapatkan nombor telefon", "Terima panggilan sebenar pertama",
  ]);
});

test("forwarding codes are exactly the app's phone screen codes", () => {
  const phone = readFileSync("web/components/core/phone.tsx", "utf8");
  assert.deepEqual(FORWARD_CODES.map((c) => [c.start, c.stop]), [
    ["**21*", "##21#"],
    ["**61*", "##61#"],
    ["**67*", "##67#"],
  ]);
  for (const { start, stop } of FORWARD_CODES) {
    assert.ok(phone.includes(`\`${start}\${local}#\``), `${start} not in phone.tsx`);
    assert.ok(phone.includes(`"${stop}"`), `${stop} not in phone.tsx`);
  }
  // The meanings match the app's wording.
  for (const locale of LOCALES) {
    const meanings = forwarding[locale].codes.rows.map((r) => r.name);
    assert.equal(meanings.length, FORWARD_CODES.length);
    for (const m of meanings) assert.ok(phone.includes(`"${m}"`), `${locale}: "${m}" not in phone.tsx`);
  }
});

test("each industry names the matching setup business type, word for word", () => {
  for (const slug of INDUSTRY_SLUGS) {
    const type = businessTypes.find((t) => t.id === SETUP_TYPE_IDS[slug]);
    assert.ok(type, `${slug}: no setup type ${SETUP_TYPE_IDS[slug]}`);
    assert.equal(industries.en[slug].setupType, type.en);
    assert.equal(industries.ms[slug].setupType, type.ms);
  }
});

test("car workshops take a message for the mechanic; they do not book or look up jobs", () => {
  for (const locale of LOCALES) {
    const page = industries[locale]["car-workshops"];
    const text = JSON.stringify([page.calls, page.sample, page.sampleOutcome, page.lead, page.description]);
    assert.doesNotMatch(text, /\bbook(?:s|ed|ing)?\b|\btempah/i, `${locale}: booking on the car workshop page`);
    assert.match(text, /mechanic|mekanik/i);
  }
});

test("samples are labelled as made up, with made-up names", () => {
  assert.equal(common.en.article.sample, "Sample call, made up");
  assert.equal(common.ms.article.sample, "Contoh panggilan, rekaan");
  for (const locale of LOCALES)
    for (const slug of INDUSTRY_SLUGS) assert.match(industries[locale][slug].sampleBusiness, /Contoh/);
  assert.match(languages.en.sample.business, /Contoh/);
  for (const locale of LOCALES) {
    const lines = languages[locale].sample.lines;
    assert.ok(lines.length >= 4);
    // The caller switches language: both BM and English turns are present.
    const spoken = lines.filter((l) => l.who !== "event").map((l) => l.lang);
    assert.ok(spoken.includes("en") && spoken.includes("ms"), `${locale}: the sample does not switch language`);
  }
  // The spoken lines are the same call on both pages.
  const said = (l: "en" | "ms") => languages[l].sample.lines.filter((x) => x.who !== "event").map((x) => x.text);
  assert.deepEqual(said("en"), said("ms"));
});

test("WhatsApp appears only as waiting for Meta's approval", () => {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object" && "q" in v && "a" in v) strings.push(`${v.q} ${v.a}`);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk([howItWorks, forwarding, languages, faq, industries, industriesIndex]);
  // A group heading that only names the topic says nothing is on offer.
  for (const s of strings.filter((s) => /whatsapp/i.test(s) && s !== "WhatsApp"))
    assert.match(s, /Meta/, `WhatsApp without Meta's approval: ${s}`);
});

test("no amount is typed into the new content by hand", () => {
  for (const name of ["how-it-works", "call-forwarding", "languages", "faq", "industries"])
    assert.doesNotMatch(readFileSync(`web/content/public/${name}.ts`, "utf8"), /RM\s?\d/, name);
});

// ------------------------------------------------------------------ routes

const PAGES = ["how-it-works", "call-forwarding", "languages", "faq", "industries"] as const;
const DIRS = { en: "web/app/(public)", ms: "web/app/ms" } as const;

test("each content page has a static route in both languages", () => {
  for (const locale of LOCALES)
    for (const id of PAGES) {
      const file = `${DIRS[locale]}/${id}/page.tsx`;
      assert.ok(existsSync(file), file);
      const src = readFileSync(file, "utf8");
      assert.match(src, new RegExp(`pageMetadata\\(\\s*"${id}",\\s*"${locale}"`), file);
      assert.match(src, new RegExp(`locale="${locale}"`), file);
      assert.doesNotMatch(src, /searchParams|headers\(|cookies\(/, file);
    }
});

test("industry pages are generated for the six slugs only, with metadata per slug", () => {
  const slugs = PUBLIC_PAGES.filter((p) => p.parent === "industries").map((p) => p.path.split("/").pop());
  assert.deepEqual(slugs, [...INDUSTRY_SLUGS]);
  for (const locale of LOCALES) {
    const file = `${DIRS[locale]}/industries/[slug]/page.tsx`;
    assert.ok(existsSync(file), file);
    const src = readFileSync(file, "utf8");
    assert.match(src, /export const dynamicParams = false/);
    assert.match(src, /export function generateStaticParams\(/);
    assert.match(src, /export async function generateMetadata\(/);
    assert.match(src, /pageMetadata\(/);
    assert.match(src, new RegExp(`locale="${locale}"`));
    assert.doesNotMatch(src, /searchParams|headers\(|cookies\(/);
  }
  for (const slug of INDUSTRY_SLUGS) assert.equal(localePath(`industries-${slug}`, "ms"), `/ms/industries/${slug}`);
});

test("FAQ markup: the question is the summary's text, never a heading inside it", () => {
  const list = readFileSync("web/components/public/faq-list.tsx", "utf8");
  assert.match(list, /<summary/);
  assert.doesNotMatch(list, /<summary[^>]*>[\s\S]*?<h[1-6][\s\S]*?<\/summary>/);
  for (const page of ["home", "pricing", "faq", "article"]) {
    const src = readFileSync(`web/components/public/pages/${page}.tsx`, "utf8");
    assert.doesNotMatch(src, /<summary/, `${page}.tsx builds its own disclosure`);
    assert.match(src, /<FaqList\b/, `${page}.tsx does not use FaqList`);
  }
});

test("the contents list folds into a disclosure on phones, also on the legal pages", () => {
  const toc = readFileSync("web/components/public/toc.tsx", "utf8");
  assert.match(toc, /<details/);
  assert.doesNotMatch(toc, /^["']use client["']/m);
  assert.match(readFileSync("web/components/public/legal-body.tsx", "utf8"), /<Toc\b/);
});

// ------------------------------------------------------------------ llms.txt
import { llmsText } from "../../web/lib/llms.ts";

test("llms.txt describes each content page with its own meta description", () => {
  const body = llmsText();
  for (const locale of LOCALES) {
    assert.ok(body.includes(howItWorks[locale].page.description));
    assert.ok(body.includes(forwarding[locale].page.description));
    assert.ok(body.includes(languages[locale].page.description));
    assert.ok(body.includes(faq[locale].page.description));
    assert.ok(body.includes(industriesIndex[locale].page.description));
    for (const slug of INDUSTRY_SLUGS) assert.ok(body.includes(industries[locale][slug].description), slug);
  }
  // Every description is one or more full sentences.
  for (const locale of LOCALES)
    for (const d of [
      howItWorks[locale].page.description, forwarding[locale].page.description,
      languages[locale].page.description, faq[locale].page.description,
      industriesIndex[locale].page.description,
      ...INDUSTRY_SLUGS.map((s) => industries[locale][s].description),
    ])
      assert.match(d, /\.$/, d);
});
