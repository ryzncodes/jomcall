import type pg from "pg";

// Monthly plans (price table version 2). Design spec section 13.
// Every figure lives in app.billing_plan and app.billing_price and is an
// owner placeholder until the owner marks a version final.
export type PlanCode = "starter" | "growth" | "payg";
export type PeriodState = "none" | "free" | "charged" | "unpaid" | "downgraded";

// What the current period allows. phoneNumbers and whatsappAgent stay on
// while an unpaid fee is in grace; includedVoiceSeconds only once paid.
export type PlanEntitlements = {
  plan: PlanCode;
  periodState: PeriodState;
  phoneNumbers: number;
  whatsappAgent: boolean;
  includedVoiceSeconds: number;
  usedIncludedSeconds: number;
  periodStart?: string;
  periodEnd?: string;
  feeSen?: number;
  graceUntil?: string | null;
};

type Db = Pick<pg.Pool | pg.PoolClient, "query">;

// For other services (phone line, WhatsApp worker). Not yet wired into the
// phone line: that is a listed follow-up.
export async function planEntitlements(
  db: Db,
  orgId: string,
  at: Date = new Date(),
): Promise<PlanEntitlements> {
  return (
    await db.query("select app_private.plan_entitlements($1,$2) as value", [
      orgId,
      at,
    ])
  ).rows[0].value;
}

// Starts or retries the period containing `at`. Safe to repeat: the fee is
// debited at most once per organization and period, never below zero.
export async function chargePlanPeriod(db: Db, orgId: string, at = new Date()) {
  return (
    await db.query("select app_private.charge_plan_period($1,$2) as value", [
      orgId,
      at,
    ])
  ).rows[0].value as {
    plan: PlanCode;
    // The period's state; `state` is the wallet's.
    periodState: PeriodState;
    duplicate: boolean;
    balanceSen: number;
    feeSen?: number;
    graceUntil?: string | null;
  };
}
