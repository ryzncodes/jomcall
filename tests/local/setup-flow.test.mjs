// Static guards for the guided setup flow screens (web/components/core/setup).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "web/components/core/setup";
const expected = [
  "flow.tsx",
  "business-type.tsx",
  "interview.tsx",
  "review.tsx",
  "finish.tsx",
];
const sources = () =>
  readdirSync(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => ({ file: join(dir, f), text: readFileSync(join(dir, f), "utf8") }));

// Top-level arguments of the call whose "(" is at `open`. Skips strings,
// template literals and nested brackets, so commas inside them do not count.
function callArguments(text, open) {
  const args = [];
  let depth = 0,
    start = open + 1,
    i = open + 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  args.push(text.slice(start, i));
  // A trailing comma leaves an empty last argument.
  return args.map((a) => a.trim()).filter((a, n, all) => a || n < all.length - 1);
}

test("the setup flow files exist", () => {
  for (const f of expected) assert.ok(existsSync(join(dir, f)), `${f} missing`);
});

test("no setup stage has a Save button", () => {
  const offenders = [];
  for (const { file, text } of sources()) {
    if (/Save draft|Save knowledge/.test(text)) offenders.push(file);
    // A label that is exactly "Save" (or BM "Simpan"), not "Saved"/"Disimpan".
    if (/["'`>]\s*(Save|Simpan)\s*(["'`<]|$)/m.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("every w( call in the setup flow has an English and a BM argument", () => {
  const offenders = [];
  for (const { file, text } of sources()) {
    for (const m of text.matchAll(/(?<![\w.$])w\(/g)) {
      const open = m.index + 1;
      const args = callArguments(text, open);
      if (args.length !== 2 || args.some((a) => !a))
        offenders.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the local app renders SetupFlow for the setup screen", () => {
  const app = readFileSync("web/components/core/local-app.tsx", "utf8");
  const at = app.indexOf('screen === "setup"');
  assert.ok(at >= 0, "no setup screen branch");
  assert.match(app.slice(at, at + 200), /<SetupFlow\b/);
  assert.doesNotMatch(app, /\["builder",\s*"setup"\]/);
});

test("the setup flow stays out of the mock preview and pack data", () => {
  for (const { file, text } of sources())
    assert.doesNotMatch(text, /packs\/index|\.json["']/, file);
  for (const f of readdirSync("web/components/product"))
    assert.doesNotMatch(
      readFileSync(join("web/components/product", f), "utf8"),
      /core\/setup/,
      f,
    );
});

test("staff see the one setup message before anything loads", () => {
  const flow = readFileSync(join(dir, "flow.tsx"), "utf8");
  const at = flow.indexOf('workspace.role === "staff"');
  assert.ok(at >= 0 && at < flow.indexOf("<SetupLoader"), "staff check first");
  assert.ok(
    flow.includes("Setup is for owners and admins. Ask one of them to finish it."),
  );
  assert.ok(
    flow.includes("Persediaan untuk pemilik dan pentadbir. Minta mereka melengkapkannya."),
  );
});

test("the finish stage unlocks Publish only through the tested rule, on a fresh draft test", () => {
  const finish = readFileSync(join(dir, "finish.tsx"), "utf8");
  assert.match(finish, /unlocksPublish\(baseline\.current, d\)/);
  assert.match(finish, /searchParams\.delete\("testSession"\)/);
  assert.match(finish, /<LocalAgentTest[^>]*resume=\{false\}/);
  assert.match(finish, /<LocalAgentTest[^>]*startOn="draft"/);
  assert.doesNotMatch(finish, /setTested\(true\)[^]*setTested\(true\)/);
});

test("the interview prefills the name only through the tested rule", () => {
  const interview = readFileSync(join(dir, "interview.tsx"), "utf8");
  assert.match(interview, /namePrefill\(q\.fills,/);
  assert.doesNotMatch(interview, /fills\.includes\("facts\.business_name"\)/);
});

test("the chrome reads the channels command and hides unconnected channels", () => {
  const text = readFileSync("web/components/core/chrome.tsx", "utf8");
  assert.match(text, /execute\(\s*["']channels["']/);
  for (const key of ["phones", "whatsapp", "integrations"])
    assert.match(text, new RegExp(key));
});
