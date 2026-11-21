import { estimates } from "./estimates.ts";
import type { PublicPlan } from "../../lib/pricing.ts";

// The worksheets' arithmetic, kept apart from the island so a test can run
// it. Nothing here is a statistic: every figure is one the visitor types.

// Upper bounds keep a stray keystroke from producing an absurd figure and
// keep every result a safe whole number of sen.
export const MAX_PER_WEEK = 500;
export const MAX_AVERAGE_SEN = 1_000_000; // RM 10,000.00
export const MAX_COST_SEN = 10_000_000; // RM 100,000.00

const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;

// A number from a field or a value; anything else (blank, text, NaN,
// Infinity) is null.
function num(value: unknown): number | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

const within = (n: number, max: number) => Math.min(max, Math.max(0, n));

// Calls missed in a week: a whole number from 0 to MAX_PER_WEEK.
export function clampPerWeek(value: unknown): number {
  const n = num(value);
  return n === null ? 0 : within(Math.round(n), MAX_PER_WEEK);
}

// The share of those calls that would have booked: 0 to 1.
export function clampShare(value: unknown): number {
  const n = num(value);
  return n === null ? 0 : within(n, 1);
}

// The field shows a percentage; the arithmetic takes a share.
export function shareFromPercent(value: unknown): number {
  const n = num(value);
  return n === null ? 0 : clampShare(n / 100);
}

// A ringgit amount typed by the visitor, to whole sen.
function senFrom(value: unknown, max: number): number {
  const n = num(value);
  return n === null ? 0 : within(Math.round(n * 100), max);
}

export function clampAverageSen(ringgit: unknown): number {
  return senFrom(ringgit, MAX_AVERAGE_SEN);
}

export function clampCostSen(ringgit: unknown): number {
  return senFrom(ringgit, MAX_COST_SEN);
}

// Sen at stake in a month: missed calls a week, times 52 weeks over 12
// months, times the share that would have booked, times the average sale.
// Inputs are clamped first; the product is taken in this order.
export function missedValueSen({
  perWeek,
  share,
  averageSen,
}: {
  perWeek: number;
  share: number;
  averageSen: number;
}): number {
  const calls = num(perWeek) === null ? 0 : within(perWeek, MAX_PER_WEEK);
  const s = clampShare(share);
  const avg = num(averageSen) === null ? 0 : within(averageSen, MAX_AVERAGE_SEN);
  return Math.round(((calls * WEEKS_PER_YEAR) / MONTHS_PER_YEAR) * s * avg);
}

// Calls a month from calls a week, to one decimal, for the working line.
export function monthlyCalls(perWeek: number): number {
  return Math.round(((clampPerWeek(perWeek) * WEEKS_PER_YEAR) / MONTHS_PER_YEAR) * 10) / 10;
}

// The receptionist page: the visitor's own monthly cost for a receptionist
// beside JomCall's month at the same voice minutes, on the cheapest plan with
// a phone number (the pricing estimator's own rule). No difference is stated.
export function costCompare({ costSen, minutes }: { costSen: number; minutes: number }): {
  costSen: number;
  jomcallSen: number;
  plan: PublicPlan["code"];
} {
  const { rows, cheapest } = estimates(minutes);
  const row = rows.find((r) => r.code === cheapest)!;
  const cost = num(costSen) === null ? 0 : within(Math.round(costSen), MAX_COST_SEN);
  return { costSen: cost, jomcallSen: row.sen, plan: cheapest };
}
