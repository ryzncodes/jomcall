// Pure rules behind the plan card on the wallet screen. Amounts in integer
// sen; dates are Kuala Lumpur calendar dates ("YYYY-MM-DD").
import type { PlanSummary } from "../../../packages/contracts/src/billing";

export type PlanOffer = PlanSummary["plans"][number];
export type PlanCode = PlanOffer["code"];

// The order the owner reads them in; the server sends them by fee.
const order: PlanCode[] = ["starter", "growth", "payg"];
export function orderedPlans(plans: PlanOffer[]) {
  return [...plans].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
}

// choose: no paid plan, so the owner picks one (a first paid plan starts
// now). A period that fell back after an unpaid fee keeps the paid plan's
// code in the summary while the organization is on pay as you go, so it is
// a first pick too. current: on a paid plan. unpaid: the fee is due.
export type CardState = "choose" | "current" | "unpaid";
export function cardState(s: Pick<PlanSummary, "plan" | "periodState">): CardState {
  if (s.plan === "payg" || s.periodState === "downgraded") return "choose";
  return s.periodState === "unpaid" ? "unpaid" : "current";
}
export function planStopped(s: Pick<PlanSummary, "periodState">) {
  return s.periodState === "downgraded";
}

// What a top-up must add so the wallet holds the fee. A negative balance
// adds to it. Zero when the wallet already holds the fee.
export function topUpNeeded(feeSen: number, balanceSen: number) {
  return Math.max(0, feeSen - balanceSen);
}

// Minutes of the included allowance used, rounded up and never more than
// what is included.
export function minutesUsed(usedSeconds: number, includedSeconds: number) {
  return {
    used: Math.ceil(Math.min(Math.max(0, usedSeconds), includedSeconds) / 60),
    included: Math.floor(includedSeconds / 60),
  };
}

// The next fee once this period ends: the pending plan's fee if a change is
// waiting, nothing (the plan stops) if pay as you go is waiting.
export type NextFee =
  | { kind: "fee"; date: string; feeSen: number; plan: PlanCode }
  | { kind: "stop"; date: string }
  | null;
export function nextFee(s: Pick<PlanSummary, "plan" | "periodEnd" | "feeSen" | "pendingPlan" | "plans">): NextFee {
  if (!s.periodEnd) return null;
  const date = s.periodEnd.slice(0, 10);
  const next = s.pendingPlan ?? s.plan;
  if (next === "payg") return { kind: "stop", date };
  const offer = s.plans.find((p) => p.code === next);
  const feeSen = s.pendingPlan ? (offer?.feeSen ?? 0) : s.feeSen || (offer?.feeSen ?? 0);
  return { kind: "fee", date, feeSen, plan: next };
}

// Today's date in Kuala Lumpur, whatever the browser's zone.
export function klDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
// One month after a date, clamped to the month's last day as the database
// does (31 Jan gives 28 or 29 Feb).
export function addMonth(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const year = m === 12 ? y + 1 : y,
    month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
// The last full day of grace: grace ends at 00:00 Kuala Lumpur on the
// stored day, so the owner has until the end of the day before.
export function lastGraceDay(graceUntil: string) {
  return klDate(new Date(new Date(graceUntil).getTime() - 1));
}
// A calendar date as "16 Dec 2026" (or the BM form), read in Kuala Lumpur.
export function dayText(date: string, ms: boolean) {
  return new Date(`${date.slice(0, 10)}T00:00:00+08:00`).toLocaleDateString(ms ? "ms-MY" : "en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
  });
}

// A paid plan set but its first period not started yet (an operator set it,
// or the hourly run has not reached it): the first fee is taken within the
// hour, and a short wallet gets the plan's grace days. Null otherwise.
export function firstFeePending(s: Pick<PlanSummary, "plan" | "periodState" | "plans">): { graceDays: number } | null {
  if (s.plan === "payg" || s.periodState !== "none") return null;
  return { graceDays: s.plans.find((p) => p.code === s.plan)?.graceDays ?? 0 };
}

// Whether a plan choice that failed may be sent again with the same
// idempotency key. Only when no answer came from JomCall (offline, timed
// out, or a proxy's page, which does not say whether the request arrived):
// the plan may have started, and the same key returns that answer instead
// of a second fee. Any answer from JomCall, an outcome or an error, makes
// the next attempt a new request with a new key.
export function keepPlanKey(failure: { status: number | null; code: string | null }) {
  return failure.code === null || failure.code === "PROXY";
}
