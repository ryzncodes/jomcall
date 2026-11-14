import { test } from "node:test";
import assert from "node:assert/strict";
import { packs, packIds, basePack } from "../../packages/domain/src/packs/index.ts";
import { businessTypes } from "../../packages/domain/src/setup/business-types.ts";
import {
  setupQuestions,
  missingFacts,
  factKeyOf,
} from "../../packages/domain/src/setup/questions.ts";

const none = new Set<string>();

test("every pack except every-business has a business type; types are valid", () => {
  const ids = new Set<string>();
  for (const t of businessTypes) {
    assert.match(t.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(t.id), `duplicate ${t.id}`);
    ids.add(t.id);
    assert.ok(t.en.trim() && t.ms.trim());
    assert.ok(packIds.includes(t.pack), `${t.id} names unknown pack`);
  }
  for (const id of packIds.filter((p) => p !== basePack))
    assert.ok(businessTypes.some((t) => t.pack === id), `no type for ${id}`);
  assert.deepEqual(businessTypes[businessTypes.length - 1], {
    id: "other",
    en: "Something else",
    ms: "Lain-lain",
    pack: "every-business",
  });
});

test("the question list starts with hours and ends with first words", () => {
  const qs = setupQuestions({ mainPack: "appointment", extraPacks: [], filled: none });
  assert.equal(qs[0]!.id, "hours");
  assert.equal(qs[0]!.kind, "hours");
  assert.equal(qs[qs.length - 1]!.id, "first_words");
  assert.equal(qs[qs.length - 1]!.kind, "first_words");
  assert.ok(qs.slice(1, -1).every((q) => q.kind === "fact"));
});

test("the list never exceeds 8 questions for any main pack with any single extra", () => {
  for (const main of packIds)
    for (const extra of [undefined, ...packIds]) {
      const qs = setupQuestions({
        mainPack: main,
        extraPacks: extra ? [extra] : [],
        filled: none,
      });
      assert.ok(qs.length <= 8, `${main}+${extra}: ${qs.length}`);
      assert.ok(qs.length >= 4, `${main}+${extra} too short`);
    }
});

test("both the main and the extra pack are represented when the list is cut", () => {
  const qs = setupQuestions({
    mainPack: "appointment",
    extraPacks: ["order"],
    filled: none,
  });
  const from = (p: string) => qs.filter((q) => q.id.startsWith(p + ":")).length;
  assert.ok(from("every-business") > 0 && from("appointment") > 0 && from("order") > 0);
});

test("a filled fact drops its question; a filled schedule drops hours", () => {
  const input = { mainPack: "appointment", extraPacks: [] as string[] };
  const all = setupQuestions({ ...input, filled: none });
  const withKey = all.find((q) => factKeyOf(q) === "business_name")!;
  assert.ok(withKey);
  const less = setupQuestions({ ...input, filled: new Set(["business_name"]) });
  assert.ok(!less.some((q) => q.id === withKey.id));
  assert.ok(less.some((q) => q.id === "hours"));
  const noHours = setupQuestions({ ...input, filled: new Set(["schedule", "settings"]) });
  assert.ok(!noHours.some((q) => q.id === "hours" || q.id === "first_words"));
  assert.ok(noHours.length <= 8);
});

test("missingFacts lists required facts of base and main pack and skips filled ones", () => {
  const input = { mainPack: "appointment", extraPacks: [] as string[] };
  const m = missingFacts({ ...input, filled: none });
  assert.ok(m.some((x) => x.pack === "every-business" && x.key === "business_name"));
  assert.ok(m.some((x) => x.pack === "appointment" && x.key === "services_summary"));
  assert.ok(m.every((x) => x.en && x.ms));
  const after = missingFacts({ ...input, filled: new Set(["business_name"]) });
  assert.ok(!after.some((x) => x.key === "business_name"));
  const required = [basePack, "appointment"].flatMap((id) =>
    packs.find((p) => p.id === id)!.facts.filter((f) => f.required),
  );
  assert.equal(m.length, required.length);
});

test("question ids are unique and stable", () => {
  const input = { mainPack: "order", extraPacks: ["status-check"], filled: none };
  const a = setupQuestions(input).map((q) => q.id);
  const b = setupQuestions(input).map((q) => q.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test("factKeyOf returns the first facts.* target or null", () => {
  const q = { id: "x", kind: "fact" as const, en: "", ms: "", fills: ["catalogue", "facts.a", "facts.b"] };
  assert.equal(factKeyOf(q), "a");
  assert.equal(factKeyOf({ ...q, fills: ["rules.x"] }), null);
});

test("every fact question fills a fact", () => {
  for (const main of packIds)
    for (const extra of [undefined, ...packIds])
      for (const q of setupQuestions({
        mainPack: main,
        extraPacks: extra ? [extra] : [],
        filled: none,
      }).filter((x) => x.kind === "fact"))
        assert.notEqual(factKeyOf(q), null, `${main}+${extra} ${q.id}`);
});

const prefixes = (qs: { id: string }[]) =>
  qs.filter((q) => q.id.includes(":")).map((q) => q.id.split(":")[0]!);

test("order is hours, base, main, extras (contiguous), first words", () => {
  const qs = setupQuestions({
    mainPack: "appointment",
    extraPacks: ["order", "status-check"],
    filled: none,
  });
  assert.equal(qs[0]!.id, "hours");
  assert.equal(qs[qs.length - 1]!.id, "first_words");
  const seq = prefixes(qs);
  const groups = seq.filter((p, i) => i === 0 || seq[i - 1] !== p);
  assert.deepEqual(groups, ["every-business", "appointment", "order", "status-check"]);
});

test("the cap and unique ids hold for repeated, equal and many packs", () => {
  const cases: [string, string[]][] = [
    ["appointment", ["order", "status-check", "quote-visit"]],
    ["appointment", ["order", "order"]],
    ["every-business", []],
    ["every-business", ["every-business", "order"]],
    ["appointment", ["appointment"]],
    ["appointment", ["every-business"]],
  ];
  for (const [mainPack, extraPacks] of cases) {
    const qs = setupQuestions({ mainPack, extraPacks, filled: none });
    assert.ok(qs.length <= 8, `${mainPack}+${extraPacks}: ${qs.length}`);
    assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
  }
});

test("six fact slots split three and three between main and base", () => {
  const qs = setupQuestions({ mainPack: "appointment", extraPacks: [], filled: none });
  const p = prefixes(qs);
  assert.equal(p.filter((x) => x === "appointment").length, 3);
  assert.equal(p.filter((x) => x === "every-business").length, 3);
});

test("unknown packs throw in both functions", () => {
  const bad = { mainPack: "nope", extraPacks: [], filled: none };
  assert.throws(() => setupQuestions(bad), /unknown pack nope/);
  assert.throws(() => missingFacts(bad), /unknown pack nope/);
  assert.throws(
    () => missingFacts({ mainPack: "order", extraPacks: ["nope"], filled: none }),
    /unknown pack nope/,
  );
});

test("filled facts and settings shrink or empty the list, never the cap", () => {
  const input = { mainPack: "appointment", extraPacks: ["order"] };
  const allKeys = new Set<string>();
  for (const p of packs)
    for (const q of p.interview)
      for (const f of q.fills) if (f.startsWith("facts.")) allKeys.add(f.slice(6));
  assert.deepEqual(
    setupQuestions({ ...input, filled: new Set([...allKeys, "schedule", "settings"]) }),
    [],
  );
  assert.deepEqual(
    setupQuestions({ ...input, filled: allKeys }).map((q) => q.id),
    ["hours", "first_words"],
  );
  const one = setupQuestions({ ...input, filled: new Set(["business_name"]) });
  assert.equal(one.length, 8);
});

test("a fact cut from one pack can still be asked by a later pack", () => {
  // lead_time is question 11 of quote-visit (main, cut) and 4 of order (extra).
  const qs = setupQuestions({
    mainPack: "quote-visit",
    extraPacks: ["order"],
    filled: none,
  });
  const keys = qs.filter((q) => q.kind === "fact").map((q) => factKeyOf(q));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(!qs.some((q) => q.id === "quote-visit:11"));
  assert.ok(qs.some((q) => q.id === "order:4"));
});
