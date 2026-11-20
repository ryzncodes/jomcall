import type { PoolClient } from "pg";
import type { TenantContext } from "../../contracts/src/index.ts";
import type { FirstRun } from "../../contracts/src/first-run.ts";
import { manager } from "./authorization.ts";
import { telephonyReadiness } from "./phone/telephony.ts";

// GET /first-run: what the getting-started list needs, read in one go so
// the sidebar and setup's live page do not repeat five reads each.
export async function firstRunRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
): Promise<FirstRun | undefined> {
  if (path !== "/first-run" || method !== "GET") return;
  manager(ctx);
  const org = ctx.orgId;
  const one = async (sql: string) => (await tx.query(sql, [org])).rows[0];
  const agent = (await one("select app_private.agent_summary($1) as v")).v;
  const plan = (await one("select app_private.plan_summary($1) as v")).v as {
    plan: string;
    periodState: string;
  };
  const flags = await one(
    `select
       exists(select 1 from app.setup_session where org_id=$1 and state='applied') as setup_applied,
       exists(select 1 from app.test_session where org_id=$1) as tested,
       (select e164 from app.phone_number where org_id=$1 and active order by created_at,id limit 1) as active_e164,
       coalesce((select state='open' from app.phone_number_request where org_id=$1 order by created_at desc,id limit 1),false) as request_open,
       app_private.plan_has_phone_number($1) as plan_number`,
  );
  // Only a call the agent took: answered_at is set once the caller is
  // answered, and stays set when a worker crash later ends the call as
  // abandoned. Refused calls and calls dropped before the answer never count.
  const call = await one(
    `select id,started_at from app.call
     where org_id=$1 and state='ended' and answered_at is not null and outcome is distinct from 'refused'
     order by started_at,id limit 1`,
  );
  const active = !!flags.active_e164;
  return {
    setupApplied: flags.setup_applied === true,
    tested: flags.tested === true,
    published: !!agent?.published_version_id,
    plan: {
      chosen:
        plan.plan !== "payg" &&
        (plan.periodState === "free" || plan.periodState === "charged"),
      unpaid: plan.periodState === "unpaid",
    },
    phone: {
      offered: telephonyReadiness().configured || active,
      active,
      activeE164: flags.active_e164 ?? null,
      requestOpen: flags.request_open === true,
      planIncludesNumber: flags.plan_number === true,
    },
    firstCall: call
      ? { id: call.id, startedAt: new Date(call.started_at).toISOString() }
      : null,
  };
}
