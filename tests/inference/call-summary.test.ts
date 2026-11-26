import test from "node:test";
import assert from "node:assert/strict";
import {
  guardSummary,
  parseSummary,
  summaryModel,
  summaryRequest,
  writeSummary,
  type SummaryFields,
  type SummaryInput,
} from "../../packages/inference/src/call-summary.ts";
import type { AnthropicLike } from "../../packages/inference/src/setup-reader.ts";

const base = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  outcome: "booking_proposed",
  transferResult: null,
  afterHours: false,
  callerE164: "+60123456789",
  turns: [{ input: "saya nak tanya pasal servis kereta myvi hari sabtu ni boleh", answer: "Boleh." }],
  proposals: ["booking"],
  ...over,
});
const fields = (over: Partial<SummaryFields> = {}): SummaryFields => ({
  reason_en: "Asked about a car service.",
  reason_ms: "Bertanya tentang servis kereta.",
  outcome_en: "Asked to book a slot.",
  outcome_ms: "Meminta tempahan slot.",
  next_step_en: "Call back to confirm.",
  next_step_ms: "Telefon untuk mengesahkan.",
  ...over,
});
const fake = (text: string): AnthropicLike => ({
  messages: { create: async () => ({ content: [{ type: "text", text }] }) as never },
});

test("request leaves out the caller number", () => {
  const r = summaryRequest(base());
  const all = JSON.stringify(r.messages);
  assert.ok(!all.includes("123456789"));
  for (const p of ["never quote", "Do not repeat names, numbers, addresses", "asked to book", "left a message", "Reason unclear"]) {
    assert.ok(r.system.includes(p), p);
  }
});

test("parse accepts strict JSON and trims", () => {
  const ok = parseSummary(JSON.stringify(fields({ reason_en: "  Hi  ", next_step_en: null })));
  assert.ok(!("error" in ok));
  if (!("error" in ok)) {
    assert.equal(ok.reason_en, "Hi");
    assert.equal(ok.next_step_en, null);
  }
  const bad = [
    JSON.stringify({ ...fields(), reason_ms: undefined }),
    JSON.stringify(fields({ outcome_en: "   " })),
    JSON.stringify(fields({ reason_en: "x".repeat(301) })),
    "not json",
  ];
  for (const b of bad) assert.deepEqual(parseSummary(b), { error: "INVALID_OUTPUT" });
});

test("quote guard catches 8 words", () => {
  const i = base();
  assert.equal(guardSummary(fields({ reason_en: "He said: nak tanya pasal servis kereta myvi hari sabtu." }), i), "QUOTE");
  assert.equal(guardSummary(fields({ reason_en: "nak tanya pasal servis kereta myvi hari" }), i), null);
});

test("quote guard catches a CJK run", () => {
  const i = base({ turns: [{ input: "我想问一下星期六可以保养我的车吗", answer: null }] });
  assert.equal(guardSummary(fields({ reason_en: "问：我想问一下星期六可以保养。" }), i), "QUOTE");
  assert.equal(guardSummary(fields({ reason_en: "我想问一下星期六可以" }), i), null);
});

test("detail guard", () => {
  const i = base();
  for (const t of ["IC 900101-14-5678", "012-345 6789", "ali@example.test"]) {
    assert.equal(guardSummary(fields({ outcome_en: t }), i), "PERSONAL_DETAIL", t);
  }
  assert.equal(guardSummary(fields({ outcome_en: "gave their address for the delivery" }), i), null);
  assert.equal(guardSummary(fields({ outcome_ms: "nombor 60-12-3456789" }), i), "PERSONAL_DETAIL");
});

test("detail guard with no caller number", () => {
  assert.equal(guardSummary(fields(), base({ callerE164: null })), null);
});

test("false-success guard", () => {
  const i = base();
  for (const t of ["booking confirmed", "has been booked", "tempahan disahkan", "telah ditempah", "预约成功", "message sent", "pesanan dihantar", "Booked for Saturday"]) {
    assert.equal(guardSummary(fields({ outcome_en: t }), i), "FALSE_SUCCESS", t);
  }
  for (const t of ["confirmed their address", "asked to book a slot"]) {
    assert.equal(guardSummary(fields({ outcome_en: t }), i), null, t);
  }
});

test("writeSummary happy path, guard error, abort and failure", async () => {
  const ok = await writeSummary(fake(JSON.stringify(fields())), base());
  assert.ok("fields" in ok && ok.model === summaryModel);
  assert.deepEqual(await writeSummary(fake("nope"), base()), { error: "INVALID_OUTPUT" });
  assert.deepEqual(await writeSummary(fake(JSON.stringify(fields({ outcome_en: "message sent" }))), base()), { error: "FALSE_SUCCESS" });
  const ac = new AbortController();
  ac.abort();
  const aborting: AnthropicLike = { messages: { create: async () => { throw new Error("aborted"); } } };
  assert.deepEqual(await writeSummary(aborting, base(), { signal: ac.signal }), { error: "MODEL_TIMEOUT" });
  assert.deepEqual(await writeSummary(aborting, base()), { error: "MODEL_FAILED" });
});
