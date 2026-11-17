import { test } from "node:test";
import assert from "node:assert/strict";
import {
  viewOf,
  statusOf,
  weekSummary,
  validSettings,
  sameSettings,
  sameDay,
  afterConflict,
  saveLineOf,
  gapTitle,
  channelWords,
  gapConflictKind,
  setDraft,
  dropDraft,
  draftsAfter,
  gapConflictAction,
  presetOf,
  applyPreset,
  copyToOpenDays,
  dayError,
  closedWeek,
  normalizeTime,
  dayProblem,
  nextBlock,
  todayKL,
  closureProblem,
  weekToSend,
  mergeWeek,
  type Interval,
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
  const vary = [
    day,
    day,
    day,
    day,
    day,
    [{ start: "09:00", end: "13:00" }],
    [],
  ];
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
  const idle = {
    status: "idle",
    invalid: [],
    waiting: false,
    unsaved: false,
  } as const;
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
  const keep = validSettings(
    { ...base, voicePreference: VOICE_PRESETS[1] },
    base,
  );
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
  assert.deepEqual(
    channelWords(["text", "phone", "whatsapp", "text"]).en,
    "Typed test, Phone, WhatsApp",
  );
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
  const d = setDraft(setDraft({}, "g1", { answer: "a" }), "g2", {
    answer: "b",
  });
  const after = dropDraft(d, "g1");
  assert.equal("g1" in after, false);
  assert.equal(after.g2!.answer, "b");
  assert.equal("g1" in d, true);
});

test("gapConflictAction: still open retries once with the fresh revision", () => {
  const fresh = [{ id: "g1", status: "open" as const, revision: 5 }];
  assert.deepEqual(gapConflictAction(fresh, "g1", 0), {
    kind: "retry",
    revision: 5,
  });
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

// ---- opening hours helpers ----
const nine: Interval[] = [{ start: "09:00", end: "17:00" }];
const week = (open: number[], blocks: Interval[] = nine): Interval[][] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => (open.includes(d) ? blocks : []));

test("presetOf reads the week", () => {
  assert.equal(presetOf(week([0, 1, 2, 3, 4, 5, 6])), "everyday");
  assert.equal(presetOf(week([0, 1, 2, 3, 4])), "weekdays");
  assert.equal(presetOf(week([0, 1, 2, 3, 4, 5])), "custom");
  const mixed = week([0, 1, 2, 3, 4]);
  mixed[2] = [{ start: "10:00", end: "18:00" }];
  assert.equal(presetOf(mixed), "custom");
  assert.equal(presetOf(closedWeek), "custom");
});

test("applyPreset fills from the first open day", () => {
  const w = closedWeek.map((_, d) =>
    d === 1 ? [{ start: "10:00", end: "18:00" }] : [],
  );
  const ten = [{ start: "10:00", end: "18:00" }];
  assert.deepEqual(applyPreset(w, "weekdays"), week([0, 1, 2, 3, 4], ten));
  assert.deepEqual(
    applyPreset(w, "everyday"),
    week([0, 1, 2, 3, 4, 5, 6], ten),
  );
  assert.deepEqual(applyPreset(closedWeek, "weekdays"), week([0, 1, 2, 3, 4]));
  assert.deepEqual(
    applyPreset(closedWeek, "everyday"),
    week([0, 1, 2, 3, 4, 5, 6]),
  );
});

test("applyPreset copies, never shares, the blocks", () => {
  const out = applyPreset(week([0]), "everyday");
  out[0]![0]!.end = "12:00";
  assert.equal(out[1]![0]!.end, "17:00");
});

test("copyToOpenDays leaves closed days closed", () => {
  const w = week([0, 2, 4]);
  w[0] = [
    { start: "08:00", end: "12:00" },
    { start: "13:00", end: "17:00" },
  ];
  const out = copyToOpenDays(w, 0);
  assert.deepEqual(out[2], w[0]);
  assert.deepEqual(out[4], w[0]);
  assert.deepEqual(out[1], []);
  assert.deepEqual(out[6], []);
  assert.notEqual(out[2], out[4]);
});

test("dayError names the first problem", () => {
  assert.equal(dayError([{ start: "17:00", end: "09:00" }]), "order");
  assert.equal(dayError([{ start: "09:00", end: "09:00" }]), "order");
  assert.equal(
    dayError([
      { start: "09:00", end: "13:00" },
      { start: "12:00", end: "17:00" },
    ]),
    "overlap",
  );
  assert.equal(
    dayError([
      { start: "13:00", end: "17:00" },
      { start: "09:00", end: "12:00" },
    ]),
    "overlap",
  );
  const five = [0, 1, 2, 3, 4].map((i) => ({
    start: `${String(8 + i * 2).padStart(2, "0")}:00`,
    end: `${String(9 + i * 2).padStart(2, "0")}:00`,
  }));
  assert.equal(dayError(five), "tooMany");
  assert.equal(
    dayError([
      { start: "09:00", end: "12:00" },
      { start: "12:00", end: "17:00" },
    ]),
    null,
  );
  assert.equal(dayError([]), null);
});

test("closedWeek is seven empty days", () => {
  assert.equal(closedWeek.length, 7);
  assert.ok(closedWeek.every((d) => d.length === 0));
});

test("normalizeTime reads what a phone number pad can type", () => {
  assert.equal(normalizeTime("9"), "09:00");
  assert.equal(normalizeTime("17"), "17:00");
  assert.equal(normalizeTime("900"), "09:00");
  assert.equal(normalizeTime("0900"), "09:00");
  assert.equal(normalizeTime("1730"), "17:30");
  assert.equal(normalizeTime("2400"), "2400");
  for (const bad of ["2460", "99", "1a", "123456", "2530", "960"])
    assert.equal(normalizeTime(bad), bad);
});

test("normalizeTime pads a single digit hour and keeps the rest", () => {
  assert.equal(normalizeTime("9:00"), "09:00");
  assert.equal(normalizeTime(" 17:30 "), "17:30");
  assert.equal(normalizeTime("24:00"), "24:00");
  assert.equal(normalizeTime("abc"), "abc");
});

test("dayProblem adds a format problem before any other", () => {
  assert.equal(dayProblem([{ start: "9am", end: "17:00" }]), "format");
  assert.equal(dayProblem([{ start: "24:00", end: "24:00" }]), "format");
  assert.equal(dayProblem([{ start: "17:00", end: "09:00" }]), "order");
  assert.equal(dayProblem([{ start: "09:00", end: "24:00" }]), null);
});

test("nextBlock starts where the last one ends", () => {
  assert.deepEqual(nextBlock([]), { start: "09:00", end: "17:00" });
  assert.deepEqual(nextBlock([{ start: "09:00", end: "12:00" }]), {
    start: "12:00",
    end: "16:00",
  });
  assert.deepEqual(nextBlock([{ start: "09:00", end: "22:30" }]), {
    start: "22:30",
    end: "24:00",
  });
  assert.equal(nextBlock([{ start: "09:00", end: "24:00" }]), null);
  assert.equal(nextBlock([{ start: "09:00", end: "bad" }]), null);
});

test("todayKL is the date in Kuala Lumpur", () => {
  assert.equal(todayKL(new Date("2026-11-16T17:00:00Z")), "2026-11-17");
  assert.equal(todayKL(new Date("2026-11-16T15:59:00Z")), "2026-11-16");
});

test("closureProblem refuses past, repeated, bad and too many dates", () => {
  const today = "2026-11-17";
  const none: { date: string; reason: string }[] = [];
  assert.equal(closureProblem("2026-11-17", none, today), null);
  assert.equal(closureProblem("2026-11-16", none, today), "past");
  assert.equal(closureProblem("", none, today), "invalid");
  assert.equal(closureProblem("2026-02-30", none, today), "invalid");
  assert.equal(
    closureProblem("2026-12-25", [{ date: "2026-12-25", reason: "" }], today),
    "duplicate",
  );
  const many = Array.from({ length: 366 }, (_, i) => ({
    date: `2027-${String(1 + (i % 12)).padStart(2, "0")}-${i}`,
    reason: "",
  }));
  assert.equal(closureProblem("2026-12-25", many, today), "full");
});

test("weekToSend keeps the saved day when a typed day cannot be sent", () => {
  const saved = week([0, 1]);
  const draft = week([0, 1]);
  draft[1] = [{ start: "17:00", end: "09:00" }];
  draft[2] = [{ start: "10:00", end: "14:00" }];
  const out = weekToSend(draft, saved);
  assert.deepEqual(out.send[1], saved[1]);
  assert.deepEqual(out.send[2], draft[2]);
  assert.deepEqual(out.invalid, [1]);
});

test("mergeWeek: untouched rows take the server, typed rows stay", () => {
  const before = week([0, 1, 2]);
  const draft = week([0, 1, 2]);
  draft[1] = [{ start: "10:00", end: "12:00" }];
  const server = week([0, 1, 2]);
  server[0] = [{ start: "08:00", end: "16:00" }];
  server[1] = [{ start: "07:00", end: "15:00" }];
  server[2] = [{ start: "09:00", end: "12:00" }];
  const out = mergeWeek(before, draft, server);
  assert.deepEqual(out[0], server[0]);
  assert.deepEqual(out[1], draft[1]);
  assert.deepEqual(out[2], server[2]);
});

import {
  changeLine,
  groupChanges,
  groupTotal,
  missingDisclosure,
  trySuggestion,
  isChangesMoved,
  publishBlock,
} from "../../web/components/core/agent/rules.ts";
import type { AgentChange } from "../../packages/contracts/src/core.ts";

const fact = (label: string, op: AgentChange["op"] = "added"): AgentChange => ({
  kind: "fact",
  op,
  label,
});

test("changeLine names a setting field and never its text", () => {
  assert.deepEqual(
    changeLine({ kind: "setting", op: "changed", label: "greeting" }),
    { en: "Greeting changed", ms: "Ucapan diubah" },
  );
  assert.deepEqual(
    changeLine({ kind: "setting", op: "changed", label: "somethingNew" }),
    { en: "Setting changed", ms: "Tetapan diubah" },
  );
});

test("changeLine for facts, prices, hours, packs and collapsed lines", () => {
  assert.deepEqual(changeLine(fact("Parking")), {
    en: "Fact added: Parking",
    ms: "Fakta ditambah: Parking",
  });
  assert.deepEqual(
    changeLine({ kind: "price", op: "removed", label: "Haircut" }),
    { en: "Price removed: Haircut", ms: "Harga dibuang: Haircut" },
  );
  assert.deepEqual(
    changeLine({ kind: "hours", op: "changed", label: "Main" }),
    {
      en: "Opening hours changed: Main",
      ms: "Waktu operasi diubah: Main",
    },
  );
  assert.deepEqual(
    changeLine({ kind: "price", op: "changed", label: "", count: 3 }),
    { en: "Price list changed, 3 rows", ms: "Senarai harga diubah, 3 baris" },
  );
  assert.deepEqual(
    changeLine({ kind: "pack", op: "added", label: "salon" }, (id) =>
      id === "salon" ? "Salon" : undefined,
    ),
    {
      en: "Call type switched on: Salon",
      ms: "Jenis panggilan dihidupkan: Salon",
    },
  );
  assert.deepEqual(changeLine({ kind: "pack", op: "removed", label: "x1" }), {
    en: "Call type switched off: x1",
    ms: "Jenis panggilan dimatikan: x1",
  });
});

test("groupChanges collapses 13 lines of one kind and not 12", () => {
  const n = (k: number) => Array.from({ length: k }, (_, i) => fact("f" + i));
  const g12 = groupChanges(n(12));
  assert.equal(g12.length, 1);
  assert.equal(g12[0]!.collapsed, false);
  const g13 = groupChanges([
    ...n(13),
    { kind: "setting", op: "changed", label: "name" },
  ]);
  assert.deepEqual(
    g13.map((g) => [g.kind, g.collapsed, g.lines.length]),
    [
      ["setting", false, 1],
      ["fact", true, 13],
    ],
  );
  assert.equal(groupTotal(g13[1]!.lines), 13);
  assert.equal(
    groupTotal([
      { kind: "price", op: "changed", label: "", count: 5 },
      fact("a"),
    ]),
    6,
  );
});

test("missingDisclosure", () => {
  assert.deepEqual(
    missingDisclosure({ ...base, greeting: "Hi", aiDisclosure: "AI" }),
    [],
  );
  assert.deepEqual(
    missingDisclosure({
      ...base,
      greeting: "Hi",
      aiDisclosure: "AI",
      recordingEnabled: true,
      recordingDisclosure: "  ",
    }),
    ["recordingDisclosure"],
  );
  assert.deepEqual(
    missingDisclosure({
      ...base,
      greeting: "",
      aiDisclosure: " ",
      recordingEnabled: false,
      recordingDisclosure: "",
    }),
    ["greeting", "aiDisclosure"],
  );
});

test("trySuggestion", () => {
  assert.deepEqual(
    trySuggestion([{ kind: "hours", op: "changed", label: "Main" }]),
    {
      en: "What time do you open on Saturday?",
      ms: "Pukul berapa anda buka pada hari Sabtu?",
    },
  );
  assert.deepEqual(trySuggestion([fact("Parking")]), {
    en: "Ask the question you just answered.",
    ms: "Tanya soalan yang baru anda jawab.",
  });
  assert.equal(
    trySuggestion([{ kind: "setting", op: "changed", label: "greeting" }]),
    null,
  );
  assert.equal(trySuggestion([fact("Parking", "removed")]), null);
});

test("isChangesMoved is a plain refusal, not a revision conflict", () => {
  assert.equal(isChangesMoved({ status: 409, code: "CHANGES_MOVED" }), true);
  assert.equal(isChangesMoved({ status: 409, code: "CONFLICT" }), false);
  assert.equal(isChangesMoved({ status: 422, code: "CHANGES_MOVED" }), false);
  assert.equal(isChangesMoved(new TypeError("x")), false);
  assert.equal(isChangesMoved(null), false);
});

test("publishBlock says why Publish is not offered", () => {
  const ok = {
    settingsUnsaved: false,
    hoursUnsaved: false,
    published: true,
    count: 2,
  };
  assert.equal(publishBlock(ok), null);
  assert.equal(publishBlock({ ...ok, settingsUnsaved: true }), "unsaved");
  assert.equal(publishBlock({ ...ok, hoursUnsaved: true }), "unsaved");
  assert.equal(publishBlock({ ...ok, count: 0 }), "nothing");
  assert.equal(publishBlock({ ...ok, published: false, count: 0 }), null);
});

import { runPublish } from "../../web/components/core/agent/rules.ts";

test("runPublish returns the revision publish moved, with no later read", async () => {
  const sent: string[] = [];
  const r = await runPublish(5, "tok1", async (t) => {
    sent.push(t);
  });
  assert.deepEqual(r, { revision: 6, refused: false });
  assert.deepEqual(sent, ["tok1"]);
});

test("runPublish: CHANGES_MOVED keeps the revision; a second press sends the new token", async () => {
  const sent: string[] = [];
  const send = async (t: string) => {
    sent.push(t);
    if (t === "old") throw { status: 409, code: "CHANGES_MOVED" };
  };
  assert.deepEqual(await runPublish(5, "old", send), {
    revision: 5,
    refused: true,
  });
  assert.deepEqual(await runPublish(5, "new", send), {
    revision: 6,
    refused: false,
  });
  assert.deepEqual(sent, ["old", "new"]);
});

test("runPublish rethrows any other error, a revision CONFLICT included", async () => {
  const conflict = { status: 409, code: "CONFLICT" };
  await assert.rejects(
    runPublish(5, "t", async () => {
      throw conflict;
    }),
    (e) => e === conflict,
  );
});

test("sameDay ignores the key order of a block and sees real differences", () => {
  const a = [{ end: "17:00", start: "09:00" }];
  const b = [{ start: "09:00", end: "17:00" }];
  assert.equal(sameDay(a, b), true);
  assert.equal(sameDay([], []), true);
  assert.equal(sameDay(a, [{ start: "09:00", end: "18:00" }]), false);
  assert.equal(sameDay(a, [{ start: "10:00", end: "17:00" }]), false);
  assert.equal(sameDay(a, [...b, { start: "18:00", end: "20:00" }]), false);
  assert.equal(sameDay(a, []), false);
});

test("draftsAfter: saved, skipped and handled drop the draft; failed keeps it", () => {
  const d = setDraft(setDraft({}, "g1", { answer: "a" }), "g2", {
    answer: "b",
  });
  for (const outcome of ["saved", "skipped", "handled"] as const) {
    const after = draftsAfter(d, "g1", outcome);
    assert.equal("g1" in after, false);
    assert.equal(after.g2!.answer, "b");
  }
  const kept = draftsAfter(d, "g1", "failed");
  assert.equal(kept.g1!.answer, "a");
  assert.equal(kept.g2!.answer, "b");
});

test("normalizeTime reads 24:00 for a closing time only", () => {
  for (const t of ["2400", "24", "24:00", " 2400 "])
    assert.equal(normalizeTime(t, "end"), "24:00");
  // An opening time never takes it.
  assert.equal(normalizeTime("2400", "start"), "2400");
  assert.equal(normalizeTime("24"), "24");
  // Past midnight stays refused for an end too.
  for (const bad of ["2401", "2430", "25", "2460"])
    assert.equal(normalizeTime(bad, "end"), bad);
  // Other end times read as before.
  assert.equal(normalizeTime("1730", "end"), "17:30");
  assert.equal(normalizeTime("9", "end"), "09:00");
});

test("a day that runs to 24:00 is valid and reads sensibly", () => {
  const day = [{ start: "09:00", end: "24:00" }];
  assert.equal(dayError(day), null);
  assert.equal(dayError([{ start: "00:00", end: "24:00" }]), null);
  assert.equal(weekSummary([day, day, day, day, day, [], []]).en, "Mon to Fri 9:00 to 24:00");
});
