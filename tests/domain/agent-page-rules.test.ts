import { test } from "node:test";
import assert from "node:assert/strict";
import {
  viewOf,
  statusOf,
  weekSummary,
  validSettings,
  sameSettings,
  afterConflict,
  saveLineOf,
  gapTitle,
  channelWords,
  gapConflictKind,
  setDraft,
  dropDraft,
  gapConflictAction,
} from "../../web/components/core/agent/rules.ts";
import {
  VOICE_PRESETS,
  voiceFor,
} from "../../packages/contracts/src/voices.ts";
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

test("saveLineOf picks the line for the save state", () => {
  const idle = { status: "idle", invalid: [], waiting: false, unsaved: false } as const;
  assert.equal(saveLineOf(idle), "none");
  assert.equal(saveLineOf({ ...idle, status: "saved" }), "saved");
  // In flight with nothing newer waiting: Saving, though still unsaved.
  assert.equal(
    saveLineOf({ ...idle, status: "saving", unsaved: true }),
    "saving",
  );
  // A newer edit is waiting while a save is in flight.
  assert.equal(
    saveLineOf({ ...idle, status: "saving", unsaved: true, waiting: true }),
    "notSaved",
  );
  assert.equal(saveLineOf({ ...idle, invalid: ["name"] }), "notSaved");
  assert.equal(
    saveLineOf({ ...idle, status: "conflict", unsaved: true }),
    "notSaved",
  );
  assert.equal(
    saveLineOf({ ...idle, status: "error", unsaved: true }),
    "error",
  );
});

test("afterConflict keeps every field in the set", () => {
  const server = { ...base, name: "S", greeting: "S", instructions: "S" };
  const local = { ...base, name: "L", greeting: "L", instructions: "L" };
  const kept = afterConflict(server, local, ["name", "instructions"]);
  assert.equal(kept.name, "L");
  assert.equal(kept.instructions, "L");
  assert.equal(kept.greeting, "S");
  assert.deepEqual(afterConflict(server, local, []), server);
});

test("validSettings maps an empty, free-text or unknown voice to the default", () => {
  for (const v of ["", "warm and calm", "Nobody"]) {
    const { send } = validSettings({ ...base, voicePreference: v }, base);
    assert.equal(send.voicePreference, voiceFor(""));
  }
  const keep = validSettings({ ...base, voicePreference: VOICE_PRESETS[1] }, base);
  assert.equal(keep.send.voicePreference, VOICE_PRESETS[1]);
});

test("gapTitle: topic wins, else the start of the answer, never longer than 200", () => {
  const answer =
    "  Yes, we open   on Sundays from 10 to 4 and also on public holidays unless stated ";
  const collapsed = answer.replace(/\s+/g, " ").trim().slice(0, 60);
  assert.equal(gapTitle("", answer), collapsed);
  assert.equal(collapsed.length <= 60, true);
  assert.equal(gapTitle("  Sunday hours ", answer), "Sunday hours");
  assert.equal(gapTitle("x".repeat(300), "a").length, 200);
  assert.equal(gapTitle.length, 2);
});

test("channelWords: names known channels and drops unknown ones", () => {
  assert.deepEqual(channelWords(["voice", "x"]), {
    en: "Voice test",
    ms: "Ujian suara",
  });
  assert.deepEqual(channelWords(["text", "phone", "whatsapp", "text"]).en, "Typed test, Phone, WhatsApp");
  assert.deepEqual(channelWords([]), { en: "", ms: "" });
});

test("gapConflictKind: an unmoved agent revision means the gap was stale", () => {
  assert.equal(gapConflictKind(7, 7), "gap");
  assert.equal(gapConflictKind(7, 8), "agent");
});

test("drafts: a reload that replaces the list leaves typed text alone", () => {
  let d = setDraft({}, "g1", { answer: "Open Sundays" });
  d = setDraft(d, "g1", { topic: "Hours" });
  d = setDraft(d, "g2", { answer: "Second" });
  assert.deepEqual(d.g1, { answer: "Open Sundays", topic: "Hours" });
  // No call drops a draft except dropDraft: g1 is not in a new list, still kept.
  assert.deepEqual(d.g2, { answer: "Second", topic: "" });
});

test("drafts: only a stored save drops its draft", () => {
  const d = setDraft(setDraft({}, "g1", { answer: "a" }), "g2", { answer: "b" });
  const after = dropDraft(d, "g1");
  assert.equal("g1" in after, false);
  assert.equal(after.g2!.answer, "b");
  assert.equal("g1" in d, true);
});

test("gapConflictAction: still open retries once with the fresh revision", () => {
  const fresh = [{ id: "g1", status: "open" as const, revision: 5 }];
  assert.deepEqual(gapConflictAction(fresh, "g1", 0), { kind: "retry", revision: 5 });
  assert.deepEqual(gapConflictAction(fresh, "g1", 1), { kind: "error" });
});

test("gapConflictAction: gone or no longer open means handled", () => {
  assert.deepEqual(gapConflictAction([], "g1", 0), { kind: "handled" });
  assert.deepEqual(
    gapConflictAction([{ id: "g1", status: "resolved", revision: 6 }], "g1", 0),
    { kind: "handled" },
  );
});

test("gapConflictAction: no fresh list means error", () => {
  assert.deepEqual(gapConflictAction(undefined, "g1", 0), { kind: "error" });
});
