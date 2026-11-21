import { monthlyEstimateSen, publicPlans, type PublicPlan } from "../../lib/pricing.ts";

// The estimator's arithmetic, kept apart from the page so a test can run it.
export const MIN_MINUTES = 0;
export const MAX_MINUTES = 3000;
export const STEP_MINUTES = 10;

// Any input to a whole number of minutes from 0 to 3000 on the step. Text that
// is not a number counts as 0.
export function clampMinutes(value: unknown, step = STEP_MINUTES): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return MIN_MINUTES;
  const stepped = Math.round(n / step) * step;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, stepped));
}

export type EstimateRow = {
  code: PublicPlan["code"];
  sen: number;
  /** Whether the plan includes a phone number, so it can take real calls. */
  phone: boolean;
  includedMinutes: number;
};

// Every plan's month at `minutes` of voice, and the cheapest plan among those
// that take phone calls. A plan with no phone number cannot spend those
// minutes, so its row shows only its fee (RM 0.00 for pay as you go) and it
// never wins; a tie goes to the lower monthly fee.
export function estimates(minutes: number): { rows: EstimateRow[]; cheapest: PublicPlan["code"] } {
  const rows = publicPlans.map((plan) => ({
    code: plan.code,
    sen: plan.phoneNumbers > 0 ? monthlyEstimateSen(plan, minutes) : plan.monthlyFeeSen,
    phone: plan.phoneNumbers > 0,
    includedMinutes: plan.includedVoiceSeconds / 60,
    fee: plan.monthlyFeeSen,
  }));
  const winner = rows
    .filter((r) => r.phone)
    .reduce((best, r) => (r.sen < best.sen || (r.sen === best.sen && r.fee < best.fee) ? r : best));
  return {
    rows: rows.map(({ fee: _fee, ...row }) => row),
    cheapest: winner.code,
  };
}
