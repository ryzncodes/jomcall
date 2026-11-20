// The public site may only claim what is built (spec section 3). This test
// fails on any banned claim in any string under web/content/public/, in
// English or Bahasa Melayu, and checks the two languages have the same shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findBannedClaims } from "../../web/content/public/claims.ts";

const ROOT = resolve("web/content/public");

test("banned claims are caught and the required negations pass", () => {
  const hit = (t: string, w = "x") => findBannedClaims(t, w).length;
  assert.equal(hit("Calls are not recorded."), 0);
  assert.equal(hit("Calls are recorded."), 1);
  assert.equal(hit("We record every call."), 1);
  assert.equal(hit("Never miss a call again"), 1);
  assert.equal(hit("Unlimited calls for RM49"), 1);
  assert.equal(hit("Answers every call"), 1);
  assert.equal(hit("Answers many calls at once"), 1);
  assert.equal(hit("Your number is ready within 2 hours"), 1);
  assert.equal(hit("Siap dalam 30 minit"), 1);
  assert.equal(hit("JomCall reads your website and learns your prices"), 1);
  assert.equal(hit("Imports from your Facebook page"), 1);
  assert.equal(hit("JomCall does not speak Tamil yet."), 0);
  assert.equal(hit("Speaks BM, English and Tamil"), 1);
  assert.equal(hit("There is no free trial.", "faq.trial"), 0);
  assert.equal(hit("There is no free trial.", "pricing.trial"), 0);
  assert.equal(hit("There is no free trial.", "home.hero"), 1);
  assert.equal(hit("PDPA compliant"), 1);
  assert.equal(hit("Syncs with Google Calendar"), 1);
  assert.equal(hit("Calendar sync included"), 1);
  assert.equal(hit("Instant booking alerts to your phone"), 1);
  assert.equal(hit("WhatsApp is available now"), 1);
  assert.equal(hit("WhatsApp is live"), 1);
  assert.equal(hit("WhatsApp is waiting for Meta's approval."), 0);
  assert.equal(hit("WhatsApp is not available yet."), 0);
  assert.equal(hit("books appointments"), 0);
  assert.equal(hit("Panggilan anda akan dirakam"), 1);
  assert.equal(hit("Panggilan tidak dirakam"), 0);
});

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return /\.ts$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [];
  });
}

type Flat = [string, string][];
function flatten(v: unknown, path: string, out: Flat) {
  if (typeof v === "string") out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => flatten(x, `${path}.${i}`, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) flatten(x, path ? `${path}.${k}` : k, out);
}

// Key paths of a value, with array indexes kept (lengths must match too).
function shape(v: unknown, path = ""): string[] {
  const out: Flat = [];
  flatten(v, path, out);
  return out.map(([p]) => p);
}

async function modules() {
  const out: { file: string; name: string; value: unknown }[] = [];
  for (const file of tsFiles(ROOT)) {
    const rel = file.slice(ROOT.length + 1).replace(/\.ts$/, "").replace(/\//g, ".");
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) out.push({ file: rel, name, value });
  }
  return out;
}

const isBilingual = (v: unknown): v is { en: unknown; ms: unknown } =>
  !!v && typeof v === "object" && "en" in v && "ms" in v;

test("no string under web/content/public/ makes a banned claim", async () => {
  const hits: string[] = [];
  let count = 0;
  for (const { file, name, value } of await modules()) {
    if (name === "BANNED" || typeof value === "function") continue;
    const flat: Flat = [];
    flatten(value, `${file}.${name}`, flat);
    for (const [path, text] of flat) {
      count += 1;
      // Content keys like `faq.trial` are matched on the key path.
      hits.push(...findBannedClaims(text, path));
    }
  }
  assert.ok(count > 0, "walker found no strings");
  assert.deepEqual(hits, []);
});

test("en and ms of every Bilingual export have the same key paths", async () => {
  const problems: string[] = [];
  for (const { file, name, value } of await modules()) {
    if (!isBilingual(value)) continue;
    assert.deepEqual(Object.keys(value).sort(), ["en", "ms"], `${file}.${name}`);
    const en = shape(value.en);
    const ms = shape(value.ms);
    if (JSON.stringify(en) !== JSON.stringify(ms)) problems.push(`${file}.${name}`);
  }
  assert.deepEqual(problems, []);
});
