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
  callerE164: "+60115550199",
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
  assert.ok(!all.includes("5550199"));
  for (const p of ["never quote", "Do not repeat names, numbers, addresses", "asked to book", "left a message", "Reason unclear", "Write dates and times in words"]) {
    assert.ok(r.system.includes(p), p);
  }
  assert.equal(r.max_tokens, 1000);
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
  for (const t of ["IC 991332-99-9999", "011-555 0199", "ali@example.test"]) {
    assert.equal(guardSummary(fields({ outcome_en: t }), i), "PERSONAL_DETAIL", t);
  }
  assert.equal(guardSummary(fields({ outcome_en: "gave their address for the delivery" }), i), null);
  assert.equal(guardSummary(fields({ outcome_ms: "nombor 60-11-5550199" }), i), "PERSONAL_DETAIL");
});

test("detail guard with no caller number", () => {
  assert.equal(guardSummary(fields(), base({ callerE164: null })), null);
});

// Every claim (FALSE_SUCCESS) and paraphrase (null) from the brief and the
// reviews of the false-success guard. A change that flips one fails here.
const FALSE_SUCCESS_TABLE: [string, "FALSE_SUCCESS" | null][] = [
  ["booking confirmed", "FALSE_SUCCESS"],
  ["Booking  CONFIRMED", "FALSE_SUCCESS"],
  ["The appointment for Saturday is confirmed.", "FALSE_SUCCESS"],
  ["The slot has been confirmed by staff.", "FALSE_SUCCESS"],
  ["Staff confirmed the booking.", "FALSE_SUCCESS"],
  ["Asked to book; booking confirmed.", "FALSE_SUCCESS"],
  ["has been booked", "FALSE_SUCCESS"],
  ["The caller was booked in.", "FALSE_SUCCESS"],
  ["They have been booked.", "FALSE_SUCCESS"],
  ["Booked for Saturday", "FALSE_SUCCESS"],
  ["Booked a slot for Friday.", "FALSE_SUCCESS"],
  ["booked the 10 am slot", "FALSE_SUCCESS"],
  ["tempahan disahkan", "FALSE_SUCCESS"],
  ["Tempahan untuk Sabtu telah disahkan.", "FALSE_SUCCESS"],
  ["Temu janji sudah disahkan.", "FALSE_SUCCESS"],
  ["telah ditempah", "FALSE_SUCCESS"],
  ["Slot sudah ditempah.", "FALSE_SUCCESS"],
  ["Berjaya ditempah untuk Jumaat.", "FALSE_SUCCESS"],
  ["Slot dah ditempah.", "FALSE_SUCCESS"],
  ["Pemanggil telah menempah slot.", "FALSE_SUCCESS"],
  ["message sent", "FALSE_SUCCESS"],
  ["The message has been sent to staff.", "FALSE_SUCCESS"],
  ["A message was sent to the manager.", "FALSE_SUCCESS"],
  ["pesanan dihantar", "FALSE_SUCCESS"],
  ["Pesanan telah dihantar kepada staf.", "FALSE_SUCCESS"],
  ["Mesej sudah dihantar.", "FALSE_SUCCESS"],
  ["Sent the message to staff.", "FALSE_SUCCESS"],
  ["预约成功", "FALSE_SUCCESS"],
  ["Asked whether it was confirmed; the booking has been confirmed.", "FALSE_SUCCESS"],
  ["Booking made for Saturday.", "FALSE_SUCCESS"],
  ["Appointment scheduled for Friday afternoon.", "FALSE_SUCCESS"],
  ["The caller booked Saturday morning.", "FALSE_SUCCESS"],
  ["Tempahan berjaya.", "FALSE_SUCCESS"],
  ["Tempahan dibuat untuk pagi Sabtu.", "FALSE_SUCCESS"],
  ["Message passed to staff.", "FALSE_SUCCESS"],
  ["Message forwarded to staff.", "FALSE_SUCCESS"],
  ["Mesej telah disampaikan kepada staf.", "FALSE_SUCCESS"],
  ["Forwarded the message to staff.", "FALSE_SUCCESS"],
  ["The booking is confirmed, and staff will call.", "FALSE_SUCCESS"],
  ["Staff confirmed the booking for Saturday.", "FALSE_SUCCESS"],
  ["Appointment for Saturday confirmed.", "FALSE_SUCCESS"],
  ["Booking for two confirmed.", "FALSE_SUCCESS"],
  ["Reservation for four confirmed for Friday night.", "FALSE_SUCCESS"],
  ["Booking on Friday confirmed for 3 pm.", "FALSE_SUCCESS"],
  ["Tempahan Sabtu disahkan.", "FALSE_SUCCESS"],
  ["Tempahan untuk Sabtu disahkan.", "FALSE_SUCCESS"],
  ["Temu janji pagi Sabtu disahkan.", "FALSE_SUCCESS"],
  ["It was booked for Saturday.", "FALSE_SUCCESS"],
  ["It has been booked for Saturday.", "FALSE_SUCCESS"],
  ["Saturday was booked for the caller.", "FALSE_SUCCESS"],
  ["Saturday has been booked for the caller.", "FALSE_SUCCESS"],
  ["Sabtu sudah ditempah untuk pemanggil.", "FALSE_SUCCESS"],
  ["It is booked on Saturday.", "FALSE_SUCCESS"],
  ["Appointment set for Saturday at 10 am.", "FALSE_SUCCESS"],
  ["The agent made a booking for Saturday.", "FALSE_SUCCESS"],
  ["The agent scheduled the appointment for Friday.", "FALSE_SUCCESS"],
  ["The agent passed the message on to staff.", "FALSE_SUCCESS"],
  ["The booking was successfully made.", "FALSE_SUCCESS"],
  ["Booking successful for Saturday.", "FALSE_SUCCESS"],
  ["The appointment for Saturday morning is now confirmed.", "FALSE_SUCCESS"],
  ["confirmed their address", null],
  ["asked to book a slot", null],
  ["Asked to be booked for Saturday.", null],
  ["Wanted to be booked in on Friday.", null],
  ["left a message", null],
  ["meninggalkan pesanan", null],
  ["Asked to book a slot, to be confirmed by staff.", null],
  ["The booking is not yet confirmed.", null],
  ["Booking pending confirmation.", null],
  ["Saturday is fully booked.", null],
  ["The slot has not been booked yet.", null],
  ["Minta untuk ditempah pada hari Sabtu.", null],
  ["Mahu slot itu untuk ditempah.", null],
  ["Tempahan akan disahkan oleh staf.", null],
  ["Tempahan belum disahkan.", null],
  ["Temu janji perlu disahkan.", null],
  ["Meminta tempahan slot.", null],
  ["Telefon untuk mengesahkan tempahan.", null],
  ["Menerima barang salah bagi pesanan minggu lepas.", null],
  ["Pesanan yang dihantar minggu lepas salah.", null],
  ["Left a message for staff to call back.", null],
  ["Asked whether their booking was confirmed.", null],
  ["Bertanya sama ada tempahan Sabtu telah disahkan.", null],
  ["Asked if the message had been sent.", null],
  ["Wanted to check if the appointment is confirmed.", null],
  ["If the booking is confirmed, call back.", null],
  ["Saturday is booked up.", null],
  ["Asked to have a message sent to staff.", null],
  ["Asked for an appointment and confirmed their contact number.", null],
  ["Asked for a booking on Saturday, and confirmed their name.", null],
  ["The caller confirmed the booking request details.", null],
  ["The caller confirmed the appointment time they wanted.", null],
  ["Saturday was booked, so the caller asked for Sunday.", null],
  ["The 10 am slot was booked, so the caller asked for 11 am.", null],
  ["Minta temu janji dan mengesahkan nombor telefon.", null],
  ["Mengesahkan butiran permintaan tempahan.", null],
  ["Minta tempahan Sabtu, kemudian disahkan nama pemanggil.", null],
  ["Sabtu sudah ditempah, jadi pemanggil minta hari Ahad.", null],
  ["Asked to book Saturday morning.", null],
  ["Wanted to make a booking.", null],
  ["Minta dibuat tempahan untuk Sabtu.", null],
  ["Left a message for staff to pass on.", null],
  ["Asked for an appointment to be scheduled on Friday.", null],
  ["Wanted a message passed to the manager.", null],
  ["Asked for a message to be forwarded to staff.", null],
  ["Tempahan akan dibuat oleh staf.", null],
  ["Staff to call back and confirm the appointment.", null],
  ["Asked about an appointment made last week that was cancelled.", null],
  ["A booking request was made for Saturday.", null],
  ["Wanted an appointment for Saturday set up.", null],
  ["Saturday was booked.", null],
  ["Sabtu sudah ditempah.", null],
  ["The caller made a booking last week and wants to move it.", null],
  ["Booked last week, now wants to change the time.", null],
  ["Tempahan dibuat minggu lepas, mahu tukar masa.", null],
  ["Booked an earlier slot on Saturday.", "FALSE_SUCCESS"],
  ["Saturday is booked.", null],
  // Round 3 (frozen corpus, 2026-11-26).
  ["The booking request was confirmed.", "FALSE_SUCCESS"],
  ["The caller's appointment request was confirmed.", "FALSE_SUCCESS"],
  ["The booking request for two was confirmed by the agent.", "FALSE_SUCCESS"],
  ["Permintaan tempahan telah disahkan.", "FALSE_SUCCESS"],
  ["Tempahan dibuat untuk Sabtu seperti yang diminta semalam.", "FALSE_SUCCESS"],
  ["The agent booked the slot the caller had asked about previously.", "FALSE_SUCCESS"],
  ["Booking made for Saturday as requested yesterday.", "FALSE_SUCCESS"],
  ["Tempahan pemanggil untuk hari Sabtu jam 10 pagi telah disahkan.", "FALSE_SUCCESS"],
  ["Reserved a table for Friday.", "FALSE_SUCCESS"],
  ["Scheduled the caller for Saturday morning.", "FALSE_SUCCESS"],
  ["Booked them in for tomorrow.", "FALSE_SUCCESS"],
  ["The booking went through.", "FALSE_SUCCESS"],
  ["Confirmed for Saturday at 10 am.", "FALSE_SUCCESS"],
  ["Asked for a booking and it was confirmed.", "FALSE_SUCCESS"],
  ["Pemanggil mahu temu janji pagi Sabtu disahkan.", null],
  ["Pemanggil mahu tempahan untuk hari Sabtu dibuat.", null],
  ["Pemanggil minta tempahan Sabtu disahkan oleh staf.", null],
  ["Pemanggil ingin tempahan hari Sabtu dibuat untuk dua orang.", null],
  ["Pemanggil berharap tempahan hari Sabtu disahkan secepat mungkin.", null],
  ["Staf perlu pastikan tempahan Sabtu disahkan.", null],
  ["The caller asked that the booking for Saturday be confirmed.", null],
  ["Staff to make sure the booking for Saturday gets confirmed.", null],
  ["The caller expects their booking for Saturday confirmed by tonight.", null],
  ["Caller needs a slot set aside for Saturday.", null],
  ["The caller's slot preference is set out below.", null],
  ["Saturday is booked by another customer.", null],
  ["Sabtu sudah ditempah oleh pelanggan lain.", null],
  ["The caller said Saturday was booked elsewhere and asked about Sunday.", null],
  ["A booking request was taken for staff to confirm.", null],
];

test("false-success guard table", () => {
  const i = base();
  const wrong = FALSE_SUCCESS_TABLE.filter(
    ([t, want]) => guardSummary(fields({ outcome_en: t }), i) !== want,
  ).map(([t, want]) => `${want ?? "pass"}: ${t}`);
  assert.deepEqual(wrong, []);
});

test("false-success guard is fast on long adversarial text", () => {
  const i = base();
  const inputs = [
    "booking ".repeat(70),
    "booking was is has been ".repeat(25),
    "asked whether to have to be ".repeat(20),
    "message telah sudah ".repeat(30) + "x",
    "tempahan ".repeat(50) + "dan disahkan",
  ];
  for (const t of inputs) {
    const start = performance.now();
    guardSummary(fields({ outcome_en: t }), i);
    assert.ok(performance.now() - start < 50, `slow on ${t.slice(0, 30)}`);
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
