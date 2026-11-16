// The operator's `plan` command (scripts/billing/admin.ts), local database
// only. Same rules as the plan picker (app_private.choose_plan), which an
// operator cannot call because it needs a signed-in owner or admin: the
// steps below mirror it, in one transaction under the wallet lock.
//   * On pay as you go (or no plan yet), a paid plan starts today with its
//     full fee if the wallet holds it; if not, nothing changes and the
//     answer says how much is missing (credit first with `adjust`).
//   * On a paid plan, any change waits for the next period.
// Audit action billing.plan_set_by_operator, with from, to and outcome.
import type pg from "pg";

export type OperatorPlanResult =
  | { outcome: "started" | "scheduled" | "cancelled" | "unchanged"; plan: string; pendingPlan: string | null; anchorDate: string }
  | { outcome: "wallet_short"; neededSen: number; balanceSen: number; missingSen: number };

export async function operatorPlan(db: pg.ClientBase, org: string, code: "starter" | "growth" | "payg", operator: string): Promise<OperatorPlanResult> {
  const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];
  await db.query("begin");
  try {
    const fee = Number((await one("select (app_private.plan_for($1,now())).monthly_fee_sen f", [code])).f);
    await one("select pg_advisory_xact_lock(hashtextextended('wallet:'||$1::text,0))", [org]);
    if (!(await one("select 1 x from app.organization where id=$1", [org]))) throw Error("NOT_FOUND");
    // As choose_plan: a paid plan waiting on pay as you go is dropped, then the current period is brought up to date.
    await db.query("update app.org_plan set pending_plan_code=null,updated_at=now() where org_id=$1 and plan_code='payg' and pending_plan_code is not null", [org]);
    if (await one("select 1 x from app.org_plan where org_id=$1", [org])) await db.query("select app_private.charge_plan_period($1,now())", [org]);
    const op = await one("select plan_code,pending_plan_code from app.org_plan where org_id=$1 for update", [org]);
    const from: string = op?.plan_code ?? "payg";
    let outcome: "started" | "scheduled" | "cancelled" | "unchanged";
    if (from === "payg" && fee > 0) {
      const balance = Number((await one("select coalesce(sum(amount_sen),0) b from app.wallet_ledger where org_id=$1", [org])).b);
      if (balance < fee) {
        await db.query("rollback");
        return { outcome: "wallet_short", neededSen: fee, balanceSen: balance, missingSen: fee - balance };
      }
      const today = "(now() at time zone 'Asia/Kuala_Lumpur')::date";
      const midnight = `(${today}::timestamp at time zone 'Asia/Kuala_Lumpur')`;
      // The running pay-as-you-go period ends today; one that began today becomes the plan's period.
      await db.query(`update app.plan_period set period_end=${today},ends_at=${midnight},updated_at=now() where org_id=$1 and period_start<${today} and ends_at>${midnight}`, [org]);
      await db.query(
        `update app.plan_period pp set plan_id=pl.id,plan_code=pl.code,period_end=b.period_end,ends_at=b.period_end::timestamp at time zone 'Asia/Kuala_Lumpur',
          fee_sen=pl.monthly_fee_sen,included_voice_seconds=pl.included_voice_seconds,phone_numbers=pl.phone_numbers,whatsapp_agent=pl.whatsapp_agent,
          state='unpaid',grace_until=${midnight}+make_interval(days=>pl.grace_days),updated_at=now()
         from app_private.plan_for($2,now()) pl,app_private.plan_period_bounds(${today},now()) b
         where pp.org_id=$1 and pp.period_start=${today} and pp.state in('free','downgraded')`,
        [org, code],
      );
      await db.query(
        `insert into app.org_plan(org_id,plan_code,pending_plan_code,anchor_date)values($1,$2,null,${today})
         on conflict(org_id)do update set plan_code=excluded.plan_code,pending_plan_code=null,anchor_date=excluded.anchor_date,updated_by=null,updated_at=now()`,
        [org, code],
      );
      // The balance was checked under the wallet lock, so the fee must land.
      if ((await one("select app_private.charge_plan_period($1,now()) v", [org])).v.periodState !== "charged") throw Error("PLAN_START_FAILED");
      outcome = "started";
    } else if (!op) {
      // Pay as you go with no plan row yet: record it, nothing to charge.
      await db.query("insert into app.org_plan(org_id,plan_code,anchor_date)select id,'payg',(created_at at time zone 'Asia/Kuala_Lumpur')::date from app.organization where id=$1", [org]);
      outcome = "unchanged";
    } else {
      outcome = code === op.plan_code ? (op.pending_plan_code === null ? "unchanged" : "cancelled") : "scheduled";
      await db.query("update app.org_plan set pending_plan_code=nullif($2,plan_code),updated_by=null,updated_at=now() where org_id=$1", [org, code]);
    }
    await db.query(
      "insert into app.audit_log(org_id,action,target_type,target_id,metadata)values($1,'billing.plan_set_by_operator','organization',$1,$2)",
      [org, JSON.stringify({ from, to: code, outcome, operator: operator.trim(), ...(outcome === "started" ? { feeSen: fee } : {}) })],
    );
    const now = await one("select plan_code,pending_plan_code,anchor_date::text a from app.org_plan where org_id=$1", [org]);
    await db.query("commit");
    return { outcome, plan: now.plan_code, pendingPlan: now.pending_plan_code, anchorDate: now.a };
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  }
}
