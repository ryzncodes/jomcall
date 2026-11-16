import { test } from "node:test";
import assert from "node:assert/strict";
import { billingNoticeMail, noticeDay, parseBillingNotice } from "../../engine/src/billing-notice.ts";

// The plan fee emails' text (billing design §13). Pure: no database.
const base = "https://app.example.invalid/";
const plan = (over: Record<string, unknown>) =>
  parseBillingNotice({ channel: "plan", plan: "growth", amountSen: 12900, balanceSen: 0, dueDate: "2026-12-16", payBy: null, ...over });

test("dates read as 16 Dec 2026 and 16 Dis 2026, with fixed month names", () => {
  const en = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ms = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
  for (let m = 1; m <= 12; m++) {
    const d = `2027-${String(m).padStart(2, "0")}-01`;
    assert.equal(noticeDay(d, "en"), `1 ${en[m - 1]} 2027`);
    assert.equal(noticeDay(d, "ms"), `1 ${ms[m - 1]} 2027`);
  }
  assert.equal(noticeDay("2026-12-16", "en"), "16 Dec 2026");
  assert.equal(noticeDay("2026-12-16", "ms"), "16 Dis 2026");
  assert.throws(() => noticeDay("16/12/2026", "en"));
});

test("fee due: amounts in RM, the top-up needed never below zero, at least the fee on a negative balance", () => {
  const due = billingNoticeMail(plan({ reason: "PLAN_FEE_DUE", balanceSen: 2500 }), base);
  assert.equal(due.subject, "Your JomCall plan fee is due on 16 Dec 2026 / Yuran pelan JomCall anda perlu dibayar pada 16 Dis 2026");
  assert.match(due.text, /^Your Growth plan fee of RM 129\.00 is due on 16 Dec 2026\. Your wallet has RM 25\.00\. Top up at least RM 104\.00 before then so the plan carries on\. If the fee stays unpaid, the plan stops/);
  assert.match(due.text, /Yuran pelan Growth anda sebanyak RM 129\.00 perlu dibayar pada 16 Dis 2026\. Baki dompet anda RM 25\.00\. Tambah nilai sekurang-kurangnya RM 104\.00 sebelum tarikh itu/);
  assert.match(due.text, /^Billing: https:\/\/app\.example\.invalid\/app\/billing$/m);
  assert.match(due.text, /^Bil & penggunaan: https:\/\/app\.example\.invalid\/app\/billing$/m);
  assert.doesNotMatch(due.text, /Wallet page|Halaman dompet/);
  assert.match(due.text, /If the fee stays unpaid, the plan stops and the agent no longer answers phone calls\.\n/);
  assert.match(due.text, /pelan akan dihentikan dan ejen tidak lagi menjawab panggilan telefon\.\n/);
  assert.doesNotMatch(due.text, /7 days|7 hari/);
  const negative = billingNoticeMail(plan({ reason: "PLAN_FEE_DUE", balanceSen: -500 }), base);
  assert.match(negative.text, /Your wallet has −RM 5\.00\. Top up at least RM 134\.00/);
  const covered = billingNoticeMail(plan({ reason: "PLAN_FEE_UNPAID", balanceSen: 20000 }), base);
  assert.match(covered.text, /Top up at least RM 0\.00/);
});

test("fee unpaid: with the last day to pay, or without it", () => {
  const dated = billingNoticeMail(plan({ reason: "PLAN_FEE_UNPAID", payBy: "2026-12-22", balanceSen: 900, plan: "starter", amountSen: 4900 }), base);
  assert.equal(dated.subject, "Your JomCall plan fee is unpaid / Yuran pelan JomCall anda belum dibayar");
  assert.match(dated.text, /Your Starter plan fee of RM 49\.00 was due on 16 Dec 2026 and your wallet did not hold it\. Top up at least RM 40\.00 by 22 Dec 2026 and the fee is taken by itself\. After that date the plan stops/);
  assert.match(dated.text, /selewat-lewatnya 22 Dis 2026/);
  const undated = billingNoticeMail(plan({ reason: "PLAN_FEE_UNPAID" }), base);
  assert.match(undated.text, /Top up at least RM 129\.00 soon and the fee is taken by itself\. If the fee stays unpaid/);
  assert.doesNotMatch(undated.text, /After that date|Selepas tarikh itu/);
});

test("plan stopped, and the refusal emails unchanged", () => {
  const stopped = billingNoticeMail(plan({ reason: "PLAN_STOPPED", whatsappAgent: true }), base);
  assert.equal(stopped.subject, "Your JomCall plan has stopped / Pelan JomCall anda telah dihentikan");
  assert.match(stopped.text, /^Your Growth plan stopped because the fee of RM 129\.00 was not paid\. The agent no longer answers phone calls or WhatsApp\. To start again, top up and choose a plan in Billing; it starts the same day\./);
  assert.match(
    stopped.text,
    /Pelan Growth anda telah dihentikan kerana yuran sebanyak RM 129\.00 tidak dibayar\. Ejen tidak lagi menjawab panggilan telefon atau WhatsApp\. Untuk mulakan semula, tambah nilai dan pilih pelan di Bil & penggunaan; pelan bermula pada hari yang sama\./,
  );
  // A plan without the WhatsApp agent: WhatsApp is not named; absent reads as false.
  for (const whatsappAgent of [false, undefined]) {
    const phoneOnly = billingNoticeMail(plan({ reason: "PLAN_STOPPED", plan: "starter", amountSen: 4900, whatsappAgent }), base);
    assert.match(phoneOnly.text, /The agent no longer answers phone calls\. To start again/);
    assert.match(phoneOnly.text, /Ejen tidak lagi menjawab panggilan telefon\. Untuk mulakan semula/);
    assert.doesNotMatch(phoneOnly.text, /WhatsApp/);
  }
  assert.throws(() => plan({ reason: "PLAN_STOPPED", whatsappAgent: "yes" }));
  const refusal = billingNoticeMail(parseBillingNotice({ channel: "whatsapp", reason: "WALLET_EXHAUSTED", day: "2026-12-16", emails: ["x@example.invalid"] }), base);
  assert.equal(refusal.subject, "JomCall: action needed / tindakan diperlukan");
  assert.equal(refusal.text.split("\n")[0], "Your JomCall agent is not replying on WhatsApp because your wallet balance has run out.");
  // A payload this engine does not know is refused, not sent half-filled.
  assert.throws(() => parseBillingNotice({ channel: "plan", reason: "PLAN_FEE_DUE", plan: "payg", amountSen: 0, balanceSen: 0, dueDate: "2026-12-16" }));
  assert.throws(() => parseBillingNotice({ channel: "phone", reason: "PLAN_STOPPED", day: "2026-12-16" }));
});
