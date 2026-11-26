import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  loadCases,
  parseArgs,
  run,
  scoreCase,
  type SummaryCase,
} from "../../scripts/calls/check-summary.ts";
import { summaryModel } from "../../packages/inference/src/call-summary.ts";

const c: SummaryCase = {
  id: "c01",
  language: "en",
  input: { outcome: "answered", transferResult: null, afterHours: false, callerE164: "+60115550101", turns: [], proposals: [] },
  reasonKeywords: { en: ["price"], ms: ["harga"] },
  forbidden: ["Siti Contoh", "Jalan Contoh", "Chen", "李"],
};
const ok = (over: Record<string, string | null> = {}) => ({
  model: "claude-haiku-5-5",
  fields: {
    reason_en: "Asked about the price of a service.",
    reason_ms: "Bertanya tentang perkhidmatan.",
    outcome_en: "Answered.",
    outcome_ms: "Dijawab.",
    next_step_en: null,
    next_step_ms: null,
    ...over,
  },
});

test("parseArgs: no flag is an error that says it costs money", () => {
  const r = parseArgs([]);
  assert.ok("error" in r);
  assert.match(r.error, /money/);
});
test("parseArgs: --dry", () => {
  assert.deepEqual(parseArgs(["--dry"]), { paid: false, dry: true });
});
test("parseArgs: --paid --only", () => {
  assert.deepEqual(parseArgs(["--paid", "--only", "c01,c05"]), { paid: true, dry: false, only: ["c01", "c05"] });
});
test("parseArgs: --only needs a list, unknown option fails", () => {
  assert.ok("error" in parseArgs(["--paid", "--only"]));
  assert.ok("error" in parseArgs(["--nope"]));
});
test("scoreCase: guard and model errors fail", () => {
  for (const error of ["QUOTE", "PERSONAL_DETAIL", "FALSE_SUCCESS", "INVALID_OUTPUT", "MODEL_FAILED", "MODEL_TIMEOUT"] as const) {
    const r = scoreCase(c, { error });
    assert.equal(r.pass, false);
    assert.match(r.why.join(" "), new RegExp(error));
  }
});
test("scoreCase: reason without a keyword in either language fails", () => {
  const r = scoreCase(c, ok({ reason_en: "Rang the shop.", reason_ms: "Telefon kedai." }));
  assert.equal(r.pass, false);
});
test("scoreCase: keyword in either language passes, case-insensitive", () => {
  assert.equal(scoreCase(c, ok()).pass, true);
  assert.equal(scoreCase(c, ok({ reason_en: "Rang.", reason_ms: "Tanya HARGA servis." })).pass, true);
});
test("loadCases: 16 unique cases, four per language, caller number set", () => {
  const cases = loadCases();
  assert.equal(cases.length, 16);
  assert.equal(new Set(cases.map((x) => x.id)).size, 16);
  for (const l of ["ms", "en", "manglish", "zh"]) assert.equal(cases.filter((x) => x.language === l).length, 4);
  assert.ok(cases.every((x) => x.input.callerE164?.startsWith("+601155")));
});
test("scoreCase: a forbidden detail in any field fails and is named", () => {
  const r = scoreCase(c, ok({ next_step_ms: "Hubungi semula SITI CONTOH esok." }));
  assert.equal(r.pass, false);
  assert.ok(r.why.includes("FORBIDDEN:Siti Contoh"), r.why.join(","));
  for (const key of ["reason_en", "reason_ms", "outcome_en", "outcome_ms", "next_step_en"]) {
    const x = scoreCase(c, ok({ [key]: "Asked about the price; lives on jalan contoh." }));
    assert.equal(x.pass, false, key);
    assert.ok(x.why.includes("FORBIDDEN:Jalan Contoh"), key);
  }
  const zh = scoreCase(c, ok({ outcome_en: "Left a message for Mr 李." }));
  assert.ok(zh.why.includes("FORBIDDEN:李"));
});
test("scoreCase: a forbidden word inside another word is not a hit", () => {
  assert.equal(scoreCase(c, ok({ outcome_en: "Asked about the kitchen price." })).pass, true);
});
test("loadCases: every case whose caller gave a name, address, IC or email lists it as forbidden", () => {
  const cases = loadCases();
  const withDetails = ["c01", "c02", "c07", "c08", "c09", "c12", "c13"];
  for (const x of cases) {
    const turns = x.input.turns.map((t) => t.input).join(" ").toLowerCase();
    for (const f of x.forbidden) assert.ok(turns.includes(f.toLowerCase()), `${x.id} ${f}`);
    if (withDetails.includes(x.id)) assert.ok(x.forbidden.length > 0, x.id);
  }
  const all = (id: string) => cases.find((x) => x.id === id)!.forbidden;
  for (const f of ["amir.palsu", "Jalan Contoh", "Taman Ujian"]) assert.ok(all("c08").includes(f), f);
  for (const f of ["rina.contoh", "Lorong Fiktif", "Taman Palsu"]) assert.ok(all("c12").includes(f), f);
});
test("loadCases: no loose reason keywords", () => {
  for (const x of loadCases()) {
    for (const k of [...x.reasonKeywords.en, ...x.reasonKeywords.ms]) {
      assert.ok(!["air", "plan", "order", "message", "pesanan"].includes(k.toLowerCase()), `${x.id} ${k}`);
    }
  }
});
test("run --paid with a fake client writes the result's model and scores forbidden details", async () => {
  const lines: string[] = [];
  const reply = {
    reason_en: "Asked about the price for Siti Contoh.",
    reason_ms: "Tanya harga.",
    outcome_en: "Answered.",
    outcome_ms: "Dijawab.",
    next_step_en: null,
    next_step_ms: null,
  };
  const out = `test-${process.pid}-${Date.now()}.json`;
  const code = await run(["--paid", "--out", out], {
    env: { ANTHROPIC_API_KEY: "test-not-a-key" },
    print: (l) => lines.push(l),
    makeClient: () => ({ messages: { create: async () => ({ content: [{ type: "text", text: JSON.stringify(reply) }] }) as never } }),
    cases: [c],
  });
  const file = join(process.cwd(), "output", "call-summary", out);
  try {
    assert.equal(code, 1);
    const written = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(written.model, summaryModel);
    assert.deepEqual(written.rows[0].why, ["FORBIDDEN:Siti Contoh"]);
    assert.ok(!lines.join("\n").includes("Siti"));
  } finally {
    rmSync(file, { force: true });
  }
});
