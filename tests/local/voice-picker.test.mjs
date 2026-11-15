// Static guards for the Agent builder's voice picker and its sample clips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const picker = "web/components/core/voice-picker.tsx";
const tsList = () => {
  const text = readFileSync("packages/contracts/src/voices.ts", "utf8");
  const body = text.match(/VOICE_PRESETS = \[([^\]]*)\]/)[1];
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

test("the TypeScript voice list and the Python worker's PRESETS match", () => {
  const py = readFileSync("voice/jomcall_voice/worker.py", "utf8");
  const body = py.match(/^PRESETS = \(([^)]*)\)/m)[1];
  const pyList = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pyList, tsList());
  assert.equal(tsList().length, 5);
});

test("the web app takes the voice names from the shared constant, not a copy", () => {
  const offenders = [];
  for (const f of readdirSync("web/components", { recursive: true })) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const text = readFileSync("web/components/" + f, "utf8");
    if (/["']Sulafat["']|["']Achird["']/.test(text)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
  assert.match(readFileSync(picker, "utf8"), /packages\/contracts\/src\/voices/);
});

test("the old free-text hint and field are gone from the Agent builder", () => {
  const agent = readFileSync("web/components/core/agent.tsx", "utf8");
  assert.doesNotMatch(agent, /No speech provider is connected/);
  assert.doesNotMatch(agent, /Tiada penyedia suara disambungkan/);
  assert.doesNotMatch(agent, /Voice preference/);
  assert.match(agent, /<VoicePicker/);
});

test("every w( call in the voice picker has an English and a BM argument", () => {
  const text = readFileSync(picker, "utf8");
  const calls = [...text.matchAll(/(?<![\w.$])w\(\s*(`[^`]*`|"[^"]*")\s*,\s*(`[^`]*`|"[^"]*")\s*,?\s*\)/g)];
  const all = [...text.matchAll(/(?<![\w.$])w\(/g)];
  assert.ok(all.length > 0);
  assert.equal(calls.length, all.length);
  for (const [, en, ms] of calls) assert.notEqual(en, ms);
});

test("the voice picker never says local or this computer", () => {
  const text = readFileSync(picker, "utf8");
  const strings = [...text.matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((m) => m[2]);
  const offenders = strings.filter((s) => /\blocal\b|this computer|komputer ini|tempatan/i.test(s));
  assert.deepEqual(offenders, []);
});

test("the sample list names only files that exist, and every clip is listed", () => {
  const list = JSON.parse(readFileSync("web/lib/voice-samples.json", "utf8"));
  const dir = "web/public/voice-samples";
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(m4a|wav)$/.test(f)) : [];
  assert.deepEqual(Object.values(list).sort(), onDisk.sort());
  const voices = tsList();
  for (const [key, file] of Object.entries(list)) {
    const [voice, lang] = key.split("-");
    assert.ok(voices.includes(voice), key);
    assert.ok(["en", "ms"].includes(lang), key);
    assert.match(file, new RegExp(`^${key}\\.m4a$`));
    // A few seconds of speech: keep each clip small.
    assert.ok(readFileSync(`${dir}/${file}`).length < 200_000, file);
  }
});

test("the sample generator refuses to run without --paid and sends fixed text", () => {
  const py = readFileSync("voice/jomcall_voice/samples.py", "utf8");
  assert.match(py, /if not args\.paid:/);
  assert.match(py, /Hi, thanks for calling\. How can I help you today\?/);
  assert.match(py, /Hai, terima kasih kerana menghubungi kami\. Boleh saya bantu\?/);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["voice:samples"], /jomcall_voice\.samples/);
  assert.doesNotMatch(pkg.scripts["voice:samples"], /--paid/);
});

test("git keeps the AAC sample clips and still ignores every other audio file", () => {
  const ignored = (path) =>
    spawnSync("git", ["check-ignore", "-q", "--no-index", path]).status === 0;
  assert.equal(ignored("web/public/voice-samples/Kore-en.m4a"), false);
  assert.equal(ignored("web/public/voice-samples/Kore-en.wav"), true);
  assert.equal(ignored("web/public/other/clip.m4a"), true);
  assert.equal(ignored("recording.m4a"), true);
});

test("the phone line and the browser test use the one voice fallback", () => {
  for (const file of [
    "engine/src/agent/phone-call.ts",
    "packages/domain/src/agent-test/voice-session.ts",
  ]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /voiceFor\(settings\.voicePreference\)/, file);
    assert.doesNotMatch(text, /VOICE_PRESETS\.find/, file);
  }
});

test("the Play button changes its label and does not also set aria-pressed", () => {
  const text = readFileSync(picker, "utf8");
  assert.doesNotMatch(text, /aria-pressed/);
  assert.match(text, /role="alert"/);
  assert.match(text, /Your earlier note/);
});
