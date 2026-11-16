// Pure rules behind the plan card on the wallet screen.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonth,
  cardState,
  dayText,
  firstFeePending,
  keepPlanKey,
  klDate,
  lastGraceDay,
  minutesUsed,
  nextFee,
  orderedPlans,
  planStopped,
  topUpNeeded,
  type PlanOffer,
} from "../../web/lib/core/plan-rules.ts";
import { CoreError, ProxyError, failureOf } from "../../web/lib/core/client.ts";

const plans: PlanOffer[] = [
  { code: "growth", feeSen: 12900, includedVoiceSeconds: 24000, phoneNumbers: 1, whatsappAgent: true, graceDays: 7 },
  { code: "starter", feeSen: 4900, includedVoiceSeconds: 6000, phoneNumbers: 1, whatsappAgent: false, graceDays: 7 },
  { code: "payg", feeSen: 0, includedVoiceSeconds: 0, phoneNumbers: 0, whatsappAgent: false, graceDays: 0 },
];

test("plans read starter, growth, pay as you go", () => {
  assert.deepEqual(orderedPlans(plans).map((p) => p.code), ["starter", "growth", "payg"]);
  assert.deepEqual(plans.map((p) => p.code), ["growth", "starter", "payg"], "input left as it was");
});

test("card state for each case", () => {
  assert.equal(cardState({ plan: "payg", periodState: "none" }), "choose");
  assert.equal(cardState({ plan: "payg", periodState: "free" }), "choose");
  assert.equal(cardState({ plan: "payg", periodState: "downgraded" }), "choose");
  // A fallen-back period keeps the paid plan's code; the organization is on payg.
  assert.equal(cardState({ plan: "starter", periodState: "downgraded" }), "choose");
  assert.equal(cardState({ plan: "starter", periodState: "charged" }), "current");
  assert.equal(cardState({ plan: "growth", periodState: "unpaid" }), "unpaid");
  assert.equal(cardState({ plan: "starter", periodState: "none" }), "current");
  assert.equal(planStopped({ periodState: "downgraded" }), true);
  assert.equal(planStopped({ periodState: "free" }), false);
  assert.equal(planStopped({ periodState: "none" }), false);
});

test("top-up needed is the fee less the balance, more when below zero", () => {
  assert.equal(topUpNeeded(4900, 0), 4900);
  assert.equal(topUpNeeded(4900, 1100), 3800);
  assert.equal(topUpNeeded(4900, -500), 5400);
  assert.equal(topUpNeeded(4900, 4900), 0);
  assert.equal(topUpNeeded(4900, 9000), 0);
});

test("minutes used round up and never pass the allowance", () => {
  assert.deepEqual(minutesUsed(0, 6000), { used: 0, included: 100 });
  assert.deepEqual(minutesUsed(1, 6000), { used: 1, included: 100 });
  assert.deepEqual(minutesUsed(3700, 6000), { used: 62, included: 100 });
  assert.deepEqual(minutesUsed(6000, 6000), { used: 100, included: 100 });
  assert.deepEqual(minutesUsed(7000, 6000), { used: 100, included: 100 });
  assert.deepEqual(minutesUsed(10, 0), { used: 0, included: 0 });
});

test("next fee: this plan, a pending paid plan, or a stop for pending payg", () => {
  const base = { plan: "starter" as const, periodEnd: "2026-12-16", feeSen: 4900, pendingPlan: null, plans };
  assert.deepEqual(nextFee(base), { kind: "fee", date: "2026-12-16", feeSen: 4900, plan: "starter" });
  assert.deepEqual(nextFee({ ...base, pendingPlan: "growth" }), { kind: "fee", date: "2026-12-16", feeSen: 12900, plan: "growth" });
  assert.deepEqual(nextFee({ ...base, plan: "growth", feeSen: 12900, pendingPlan: "starter" }), {
    kind: "fee",
    date: "2026-12-16",
    feeSen: 4900,
    plan: "starter",
  });
  assert.deepEqual(nextFee({ ...base, pendingPlan: "payg" }), { kind: "stop", date: "2026-12-16" });
  assert.equal(nextFee({ ...base, periodEnd: null }), null);
  // A period without its fee yet reads the plan's fee.
  assert.deepEqual(nextFee({ ...base, feeSen: 0 }), { kind: "fee", date: "2026-12-16", feeSen: 4900, plan: "starter" });
});

test("dates: today in Kuala Lumpur, one month on, last day of grace", () => {
  // 16:30 UTC on 27 Feb is already 28 Feb in Kuala Lumpur.
  assert.equal(klDate(new Date("2027-02-27T16:30:00Z")), "2027-02-28");
  assert.equal(klDate(new Date("2027-02-27T15:59:00Z")), "2027-02-27");
  assert.equal(addMonth("2026-11-16"), "2026-12-16");
  assert.equal(addMonth("2027-01-31"), "2027-02-28");
  assert.equal(addMonth("2028-01-31"), "2028-02-29");
  assert.equal(addMonth("2028-02-29"), "2028-03-29");
  assert.equal(addMonth("2026-12-31"), "2027-01-31");
  assert.equal(addMonth("2027-03-31"), "2027-04-30");
  // Grace stored as 00:00 Kuala Lumpur on 7 Feb: the last full day is 6 Feb.
  assert.equal(lastGraceDay("2027-02-06T16:00:00+00:00"), "2027-02-06");
  assert.equal(lastGraceDay("2027-02-07T00:00:00+08:00"), "2027-02-06");
  assert.equal(dayText("2026-12-16", false), "16 Dec 2026");
  assert.match(dayText("2026-12-16", true), /16 Dis 2026/);
});

test("a paid plan whose first period has not started: fee within the hour, the plan's grace days", () => {
  assert.deepEqual(firstFeePending({ plan: "starter", periodState: "none", plans }), { graceDays: 7 });
  assert.deepEqual(firstFeePending({ plan: "growth", periodState: "none", plans }), { graceDays: 7 });
  assert.equal(firstFeePending({ plan: "payg", periodState: "none", plans }), null);
  assert.equal(firstFeePending({ plan: "starter", periodState: "charged", plans }), null);
  assert.equal(firstFeePending({ plan: "starter", periodState: "unpaid", plans }), null);
});

test("a plan choice keeps its key only when no answer came from JomCall", () => {
  assert.equal(keepPlanKey(failureOf(Error("offline"))), true);
  assert.equal(keepPlanKey(failureOf(new ProxyError(504))), true);
  assert.equal(keepPlanKey(failureOf(new CoreError("PLAN_START_FAILED", 500))), false);
  assert.equal(keepPlanKey(failureOf(new CoreError("FORBIDDEN", 403))), false);
});
