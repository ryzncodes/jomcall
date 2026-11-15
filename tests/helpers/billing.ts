import { randomUUID } from "node:crypto";
import type pg from "pg";

// Gives an organization a plan, wallet credit and a charged current period,
// so the phone line and the WhatsApp agent admit it (billing design §13).
// The period is anchored on today's Kuala Lumpur date, so it covers both
// the database clock and the test clocks (today and tomorrow).
export async function entitle(
  admin: Pick<pg.Pool, "query">,
  orgId: string,
  opts: { plan?: "starter" | "growth" | "payg"; creditSen?: number } = {},
) {
  const plan = opts.plan ?? "growth";
  await admin.query(
    `insert into app.org_plan(org_id,plan_code,anchor_date)
     values($1,$2,(now() at time zone 'Asia/Kuala_Lumpur')::date)
     on conflict(org_id)do update set plan_code=excluded.plan_code,pending_plan_code=null`,
    [orgId, plan],
  );
  const credit = opts.creditSen ?? 100_000;
  if (credit !== 0) await adjustWallet(admin, orgId, credit);
  return (
    await admin.query("select app_private.charge_plan_period($1,now()) as v", [orgId])
  ).rows[0].v;
}

export const adjustWallet = (admin: Pick<pg.Pool, "query">, orgId: string, sen: number) =>
  admin.query(
    "select app_private.admin_adjust($1,$2,'Test credit','Test operator',$3)",
    [orgId, sen, "test-" + randomUUID()],
  );

export async function balanceSen(admin: Pick<pg.Pool, "query">, orgId: string) {
  return Number(
    (
      await admin.query(
        "select coalesce(sum(amount_sen),0) s from app.wallet_ledger where org_id=$1",
        [orgId],
      )
    ).rows[0].s,
  );
}

// Moves the balance to exactly `targetSen` with one adjustment.
export async function setBalance(admin: Pick<pg.Pool, "query">, orgId: string, targetSen: number) {
  const diff = targetSen - (await balanceSen(admin, orgId));
  if (diff !== 0) await adjustWallet(admin, orgId, diff);
}

export async function usageEvents(admin: Pick<pg.Pool, "query">, orgId: string, kind?: string) {
  return (
    await admin.query(
      "select * from app.usage_event where org_id=$1 and($2::text is null or kind=$2) order by created_at,id",
      [orgId, kind ?? null],
    )
  ).rows;
}
