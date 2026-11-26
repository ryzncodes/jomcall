import test from "node:test";
import assert from "node:assert/strict";
import {
  loadCases,
  parseArgs,
  scoreCase,
  type SummaryCase,
} from "../../scripts/calls/check-summary.ts";

const c: SummaryCase = {
  id: "c01",
  language: "en",
  input: { outcome: "answered", transferResult: null, afterHours: false, callerE164: "+60115550101", turns: [], proposals: [] },
  reasonKeywords: { en: ["price"], ms: ["harga"] },
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
