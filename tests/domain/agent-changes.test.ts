import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changeToken,
  diffSnapshot,
  type DraftFreeze,
} from "../../packages/domain/src/agent-changes.ts";

const settings = {
  name: "Kedai",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "Hai",
  instructions: "",
  aiDisclosure: "AI",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "",
} as DraftFreeze["settings"];
const hq = {
  locationId: "loc-1",
  name: "Seri Mawar HQ",
  main: true,
  weekdays: Array.from({ length: 7 }, () => [{ start: "09:00", end: "18:00" }]),
  closures: [] as { date: string; reason: string }[],
};
const draft: DraftFreeze = {
  settings,
  knowledge: [],
  packs: [],
  facts: [],
  rules: [],
  catalogue: null,
  hours: [hq],
};
const base = {
  settings,
  knowledge: [],
  packs: [],
  facts: [],
  rules: [],
  catalogue: null,
  hours: [hq],
} as any;
const today = "2026-11-16";
const d = (pub: any, dr: Partial<DraftFreeze> = {}) =>
  diffSnapshot(pub, { ...draft, ...dr }, today);

test("nothing differs: no lines", () => {
  assert.deepEqual(d(base), []);
});
test("settings: one line per differing key, all keys added with no version", () => {
  assert.deepEqual(d(base, { settings: { ...settings, greeting: "Selamat" } }), [
    { kind: "setting", op: "changed", label: "greeting" },
  ]);
  const all = d(null, { hours: [] });
  assert.equal(all.length, Object.keys(settings).length);
  assert.ok(all.every((c) => c.kind === "setting" && c.op === "added"));
});
test("packs: added and removed", () => {
  assert.deepEqual(d({ ...base, packs: ["a", "b"] }, { packs: ["b", "c"] }), [
    { kind: "pack", op: "added", label: "c" },
    { kind: "pack", op: "removed", label: "a" },
  ]);
});
test("knowledge by name; repeated names collapse to a count", () => {
  const k = (name: string, content: string) => ({ kind: "faq", name, content });
  assert.deepEqual(
    d({ ...base, knowledge: [k("A", "1"), k("B", "1")] }, { knowledge: [k("A", "2"), k("C", "1")] }),
    [
      { kind: "knowledge", op: "changed", label: "A" },
      { kind: "knowledge", op: "added", label: "C" },
      { kind: "knowledge", op: "removed", label: "B" },
    ],
  );
  assert.deepEqual(
    d({ ...base, knowledge: [k("A", "1"), k("A", "2")] }, { knowledge: [k("A", "1"), k("A", "3")] }),
    [{ kind: "knowledge", op: "changed", label: "", count: 2 }],
  );
  assert.deepEqual(d({ ...base, knowledge: [k("A", "1"), k("A", "2")] }, { knowledge: [k("A", "2"), k("A", "1")] }), []);
});
const fact = { packId: null, fieldKey: null, title: "Parking", value: "Free", language: "en" };
test("identical content with new ids is unchanged (after a restore)", () => {
  assert.deepEqual(d({ ...base, facts: [{ id: "old", ...fact }] }, { facts: [{ id: "new", ...fact }] }), []);
});
test("facts: same id is changed; others added or removed", () => {
  assert.deepEqual(
    d(
      { ...base, facts: [{ id: "1", ...fact }, { id: "2", ...fact, title: "Wifi" }] },
      { facts: [{ id: "1", ...fact, value: "Paid" }, { id: "3", ...fact, title: "Pets" }] },
    ),
    [
      { kind: "fact", op: "changed", label: "Parking" },
      { kind: "fact", op: "added", label: "Pets" },
      { kind: "fact", op: "removed", label: "Wifi" },
    ],
  );
});
test("rules: pack rules by id; owner rules by text", () => {
  const pr = (text: string) => ({ kind: "must", text, packId: "p", ruleId: "r1" });
  const own = (text: string) => ({ kind: "must", text, packId: null, ruleId: null });
  assert.deepEqual(d({ ...base, rules: [pr("a")] }, { rules: [pr("b")] as any }), [
    { kind: "rule", op: "changed", label: "b" },
  ]);
  assert.deepEqual(d({ ...base, rules: [own("old")] }, { rules: [own("new")] as any }), [
    { kind: "rule", op: "removed", label: "old" },
    { kind: "rule", op: "added", label: "new" },
  ]);
  const long = "x".repeat(300);
  assert.equal(d(base, { rules: [own(long)] as any })[0].label.length, 120);
});
test("an owner rule whose kind changes but not its text is a change", () => {
  const own = (kind: string) => ({ kind, text: "Same text", packId: null, ruleId: null });
  assert.deepEqual(d({ ...base, rules: [own("must")] }, { rules: [own("never")] as any }), [
    { kind: "rule", op: "removed", label: "Same text" },
    { kind: "rule", op: "added", label: "Same text" },
  ]);
});
test("a published closed date now in the past is not a change", () => {
  const pub = { ...base, hours: [{ ...hq, closures: [{ date: "2026-01-01", reason: "" }] }] };
  assert.deepEqual(d(pub, { hours: [{ ...hq, closures: [] }] }), []);
});
test("Saturday hours changed names the branch", () => {
  const sat = hq.weekdays!.map((x, i) => (i === 5 ? [{ start: "09:00", end: "13:00" }] : x));
  assert.deepEqual(d({ ...base, hours: [hq] }, { hours: [{ ...hq, weekdays: sat }] }), [
    { kind: "hours", op: "changed", label: "Seri Mawar HQ" },
  ]);
});
test("hours: a new branch is added, a gone branch removed", () => {
  const two = { ...hq, locationId: "loc-2", name: "Cawangan", main: false };
  assert.deepEqual(d(base, { hours: [hq, two] }), [{ kind: "hours", op: "added", label: "Cawangan" }]);
  assert.deepEqual(d({ ...base, hours: [hq, two] }), [{ kind: "hours", op: "removed", label: "Cawangan" }]);
});
test("a version from before hours shows every branch as added", () => {
  const { hours: _h, ...old } = base;
  assert.deepEqual(d(old), [{ kind: "hours", op: "added", label: "Seri Mawar HQ" }]);
});
test("the token changes when hours change and not when nothing does", () => {
  assert.equal(changeToken(draft), changeToken({ ...draft }));
  assert.match(changeToken(draft), /^[a-f0-9]{64}$/);
  assert.notEqual(changeToken(draft), changeToken({ ...draft, hours: [{ ...hq, name: "Other" }] }));
});
test("moving the main branch lists both branches as changed", () => {
  const two = { ...hq, locationId: "loc-2", name: "Cawangan", main: false };
  const pub = { ...base, hours: [hq, two] };
  const moved = [
    { ...hq, main: false },
    { ...two, main: true },
  ];
  assert.deepEqual(d(pub, { hours: moved }), [
    { kind: "hours", op: "changed", label: "Seri Mawar HQ" },
    { kind: "hours", op: "changed", label: "Cawangan" },
  ]);
});
