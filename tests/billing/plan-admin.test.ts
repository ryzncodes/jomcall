import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createHarness } from "../helpers/local.ts";
import { operatorPlan } from "../../scripts/billing/plan-admin.ts";

// The operator's `plan` command follows the plan picker's rules. Each case
// runs the operator on organization A and choose_plan (as its owner) on B
// from the same start, and expects the same plan, periods and fees, so the
// two copies of the rules cannot drift apart unnoticed.
type H = Awaited<ReturnType<typeof createHarness>>;
type Code = "starter" | "growth" | "payg";
async function setup() {
  const h = await createHarness();
  const db = await h.cleanup.connect();
  const adjust = (org: string, sen: number) =>
    h.cleanup.query("select app_private.admin_adjust($1,$2,'Test credit','Test operator',$3)", [org, sen, "test-" + randomUUID()]);
  const operator = (code: Code) => operatorPlan(db, h.orgA.id, code, "Test operator");
  const choose = (code: Code) =>
    h.sqlAsApp(h.bob, h.orgB.id, async (tx) => (await tx.query("select app_private.choose_plan($1,$2) v", [h.orgB.id, code])).rows[0].v);
  // Everything a plan choice changes, without ids.
  const state = async (org: string) => {
    const q = async (sql: string) => (await h.cleanup.query(sql, [org])).rows;
    return {
      plan: await q("select plan_code,pending_plan_code,anchor_date::text anchor from app.org_plan where org_id=$1"),
      periods: await q("select plan_code,state,period_start::text s,period_end::text e,fee_sen from app.plan_period where org_id=$1 order by period_start"),
      ledger: await q("select kind,amount_sen from app.wallet_ledger where org_id=$1 order by created_at,id"),
    };
  };
  const operatorAudit = async () =>
    (await h.cleanup.query("select metadata from app.audit_log where org_id=$1 and action='billing.plan_set_by_operator' order by created_at", [h.orgA.id])).rows.map(
      (r) => r.metadata,
    );
  const close = async () => {
    db.release();
    await h.close();
  };
  return { h, adjust, operator, choose, state, operatorAudit, close };
}
const same = async (h: H, state: (org: string) => Promise<unknown>, what: string) =>
  assert.deepEqual(await state(h.orgA.id), await state(h.orgB.id), what);

test("operator plan: a first paid plan starts today with its full fee, as the picker does", async () => {
  const { h, adjust, operator, choose, state, operatorAudit, close } = await setup();
  try {
    for (const org of [h.orgA.id, h.orgB.id]) await adjust(org, 6000);
    const out = await operator("starter");
    const picked = await choose("starter");
    assert.equal(out.outcome, "started");
    assert.deepEqual(out, picked);
    await same(h, state, "operator and picker agree");
    const s = await state(h.orgA.id);
    assert.deepEqual(s.periods.map((p) => [p.plan_code, p.state, p.fee_sen]), [["starter", "charged", 4900]]);
    assert.deepEqual(s.ledger.at(-1), { kind: "plan_fee", amount_sen: -4900 });
    assert.deepEqual(await operatorAudit(), [{ from: "payg", to: "starter", outcome: "started", operator: "Test operator", feeSen: 4900 }]);
  } finally {
    await close();
  }
});

test("operator plan: a short wallet changes nothing and says how much is missing", async () => {
  const { h, adjust, operator, state, operatorAudit, close } = await setup();
  try {
    const a = h.orgA.id;
    await adjust(a, 4000);
    const before = await state(a);
    assert.deepEqual(await operator("growth"), { outcome: "wallet_short", neededSen: 12900, balanceSen: 4000, missingSen: 8900 });
    assert.deepEqual(await state(a), before);
    assert.deepEqual(await operatorAudit(), []);
    // A row the earlier rule left (pay as you go with a paid plan waiting)
    // is left as it was too: the picker's clean-up is rolled back with the rest.
    await h.cleanup.query("insert into app.org_plan(org_id,plan_code,pending_plan_code,anchor_date)values($1,'payg','starter','2026-01-01')", [a]);
    const waiting = await state(a);
    assert.equal((await operator("starter")).outcome, "wallet_short");
    assert.deepEqual(await state(a), waiting);
    // The command line prints the result and exits 1.
    const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/billing/admin.ts", "plan", a, "starter", "Test operator"], {
      env: process.env,
      encoding: "utf8",
    });
    assert.equal(cli.status, 1, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), { outcome: "wallet_short", neededSen: 4900, balanceSen: 4000, missingSen: 900 });
    assert.match(cli.stderr, /WALLET_SHORT: RM 9\.00 missing; nothing changed/);
    assert.deepEqual(await state(a), waiting);
  } finally {
    await close();
  }
});

test("operator plan: on a paid plan, changes wait for the next period, as the picker's do", async () => {
  const { h, adjust, operator, choose, state, operatorAudit, close } = await setup();
  try {
    for (const org of [h.orgA.id, h.orgB.id]) await adjust(org, 20000);
    for (const code of ["starter", "growth", "payg", "starter", "starter"] as const) {
      const out = await operator(code);
      assert.deepEqual(out, await choose(code), code);
      await same(h, state, code);
    }
    assert.deepEqual(
      (await operatorAudit()).map((m) => [m.from, m.to, m.outcome]),
      [
        ["payg", "starter", "started"],
        ["starter", "growth", "scheduled"],
        ["starter", "payg", "scheduled"],
        ["starter", "starter", "cancelled"],
        ["starter", "starter", "unchanged"],
      ],
    );
    assert.deepEqual((await state(h.orgA.id)).ledger.filter((l) => l.kind === "plan_fee"), [{ kind: "plan_fee", amount_sen: -4900 }], "one fee");
  } finally {
    await close();
  }
});

test("operator plan: pay as you go first, then a paid plan reuses the period that began today", async () => {
  const { h, adjust, operator, choose, state, close } = await setup();
  try {
    for (const org of [h.orgA.id, h.orgB.id]) await adjust(org, 20000);
    assert.deepEqual(await operator("payg"), await choose("payg"));
    for (const org of [h.orgA.id, h.orgB.id]) await h.cleanup.query("select app_private.charge_plan_period($1,now())", [org]);
    await same(h, state, "pay as you go");
    assert.deepEqual(await operator("growth"), await choose("growth"));
    await same(h, state, "growth");
    const periods = (await state(h.orgA.id)).periods;
    assert.deepEqual(periods.map((p) => [p.plan_code, p.state]), [["growth", "charged"]]);
  } finally {
    await close();
  }
});

test("operator plan: a running pay-as-you-go period ends today when a paid plan starts, as with the picker", async () => {
  const { h, adjust, operator, choose, state, close } = await setup();
  try {
    // A monthly date well away from today, so the free period began earlier.
    const anchor = (await h.cleanup.query("select ((now() at time zone 'Asia/Kuala_Lumpur')::date-45)::text d")).rows[0].d;
    for (const org of [h.orgA.id, h.orgB.id]) {
      await adjust(org, 20000);
      await h.cleanup.query("insert into app.org_plan(org_id,plan_code,anchor_date)values($1,'payg',$2)", [org, anchor]);
      await h.cleanup.query("select app_private.charge_plan_period($1,now())", [org]);
    }
    assert.deepEqual(await operator("starter"), await choose("starter"));
    await same(h, state, "starter");
    const periods = (await state(h.orgA.id)).periods;
    assert.deepEqual(periods.map((p) => [p.plan_code, p.state]), [["payg", "free"], ["starter", "charged"]]);
    assert.equal(periods[0].e, periods[1].s, "the free period ends where the plan's begins");
  } finally {
    await close();
  }
});
