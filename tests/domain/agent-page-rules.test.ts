import { test } from "node:test";
import assert from "node:assert/strict";
import {
  viewOf,
  statusOf,
  weekSummary,
  validSettings,
  sameSettings,
  afterConflict,
} from "../../web/components/core/agent/rules.ts";
import type { AgentSettings } from "../../packages/contracts/src/core.ts";

const base: AgentSettings = {
  name: "Aina",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "Hai",
  instructions: "",
  aiDisclosure: "AI",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "",
};
const day = [{ start: "09:00", end: "17:00" }];

test("viewOf reads the hash and falls back to home", () => {
  assert.equal(viewOf("#hours"), "hours");
  assert.equal(viewOf("#nope"), "home");
  assert.equal(viewOf(""), "home");
  assert.equal(viewOf("#"), "home");
});

test("statusOf", () => {
  assert.deepEqual(statusOf(null, 5), { state: "unpublished", changes: 5 });
  assert.deepEqual(statusOf("v", 0), { state: "live", changes: 0 });
  assert.deepEqual(statusOf("v", 3), { state: "pending", changes: 3 });
});

test("weekSummary", () => {
  assert.deepEqual(weekSummary(null), {
    en: "Hours not set yet",
    ms: "Waktu belum ditetapkan",
  });
  const mon6 = [day, day, day, day, day, day, []];
  assert.deepEqual(weekSummary(mon6), {
    en: "Mon to Sat 9:00 to 17:00",
    ms: "Isn hingga Sab 9:00 hingga 17:00",
  });
  const gaps = [day, [], day, [], day, [], []];
  assert.equal(weekSummary(gaps).en, "Mon, Wed, Fri 9:00 to 17:00");
  const vary = [day, day, day, day, day, [{ start: "09:00", end: "13:00" }], []];
  assert.deepEqual(weekSummary(vary), {
    en: "Hours vary by day",
    ms: "Waktu berbeza mengikut hari",
  });
  assert.deepEqual(weekSummary([[], [], [], [], [], [], []]), {
    en: "Closed every day",
    ms: "Tutup setiap hari",
  });
});

test("validSettings replaces an invalid field by its last valid value", () => {
  const r = validSettings({ ...base, name: "" }, { ...base, name: "Old" });
  assert.equal(r.send.name, "Old");
  assert.deepEqual(r.invalid, ["name"]);
  const l = validSettings({ ...base, languages: [] }, base);
  assert.deepEqual(l.send.languages, ["ms", "en"]);
  assert.deepEqual(l.invalid, ["languages"]);
  const ok = validSettings({ ...base, greeting: "Selamat" }, base);
  assert.equal(ok.send.greeting, "Selamat");
  assert.deepEqual(ok.invalid, []);
});

test("sameSettings ignores key order", () => {
  const reordered = Object.fromEntries(
    Object.entries(base).reverse(),
  ) as AgentSettings;
  assert.equal(sameSettings(base, reordered), true);
  assert.equal(sameSettings(base, { ...base, name: "B" }), false);
});

test("afterConflict keeps only the focused field", () => {
  const server = { ...base, name: "Server", greeting: "S" };
  const local = { ...base, name: "Mine", greeting: "L" };
  const kept = afterConflict(server, local, "greeting");
  assert.equal(kept.greeting, "L");
  assert.equal(kept.name, "Server");
  assert.deepEqual(afterConflict(server, local, null), server);
});
