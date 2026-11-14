import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";
import { recordUsage } from "../../packages/billing/src/usage.ts";
import { chargePlanPeriod, planEntitlements } from "../../packages/billing/src/plans.ts";
import { priceVersion, publicPlans, publicPrices } from "../../web/lib/pricing.ts";

// Monthly plans on the wallet (design section 13). Dates are in the future
// so price and plan version 2 apply; an anchor on the 31st checks February.
type H = Awaited<ReturnType<typeof createHarness>>;
const kl = (day: string, time = "10:00:00") => new Date(`${day}T${time}+08:00`);
async function setup() {
  const h = await createHarness();
  const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 3 });
  const adjust = (org: string, sen: number) =>
    h.cleanup.query("select app_private.admin_adjust($1,$2,'Test credit','Test operator',$3)", [org, sen, "test-" + randomUUID()]);
  const balance = async (org: string) =>
    Number((await h.cleanup.query("select coalesce(sum(amount_sen),0) s from app.wallet_ledger where org_id=$1", [org])).rows[0].s);
  const choose = (who: H["alice"], org: string, code: string) =>
    h.sqlAsApp(who, org, async (tx) => (await tx.query("select app_private.choose_plan($1,$2) v", [org, code])).rows[0].v);
  // Starts a plan whose periods are anchored on 31 January 2027.
  const subscribe = async (who: H["alice"], org: string, code = "starter") => {
    await choose(who, org, code);
    await h.cleanup.query("update app.org_plan set anchor_date='2027-01-31' where org_id=$1", [org]);
  };
  const voice = (org: string, seconds: number, at: Date, key = "call:" + randomUUID()) =>
    recordUsage(worker, { orgId: org, kind: "voice_second", quantity: seconds, idempotencyKey: key, occurredAt: at });
  const close = async () => {
    await worker.end();
    await h.close();
  };
  return { h, worker, adjust, balance, choose, subscribe, voice, close };
}

test("plan rows: version 2 figures are data, in sen, marked owner placeholder", async () => {
  const { h, close } = await setup();
  try {
    const plans = (await h.cleanup.query("select code,monthly_fee_sen,included_voice_seconds,phone_numbers,whatsapp_agent,status from app.billing_plan where version=2 order by monthly_fee_sen")).rows;
    assert.deepEqual(plans, [
      { code: "payg", monthly_fee_sen: 0, included_voice_seconds: 0, phone_numbers: 0, whatsapp_agent: false, status: "owner_placeholder" },
      { code: "starter", monthly_fee_sen: 4900, included_voice_seconds: 6000, phone_numbers: 1, whatsapp_agent: false, status: "owner_placeholder" },
      { code: "growth", monthly_fee_sen: 12900, included_voice_seconds: 24000, phone_numbers: 1, whatsapp_agent: true, status: "owner_placeholder" },
    ]);
    // The public pricing page's copy matches the database.
    assert.equal(priceVersion, 2);
    for (const p of publicPlans) {
      type Row = { code: string; monthly_fee_sen: number; included_voice_seconds: number; phone_numbers: number; whatsapp_agent: boolean };
      const row: Row = (plans as Row[]).find((r) => r.code === p.code)!;
      assert.deepEqual([p.monthlyFeeSen, p.includedVoiceSeconds, p.phoneNumbers, p.whatsappAgent], [row.monthly_fee_sen, row.included_voice_seconds, row.phone_numbers, row.whatsapp_agent]);
    }
    const prices = Object.fromEntries((await h.cleanup.query("select kind,unit_sen,per_quantity from app.billing_price where version=2")).rows.map((r) => [r.kind, r.unit_sen * (r.kind === "voice_second" ? 60 / r.per_quantity : 1 / r.per_quantity)]));
    assert.deepEqual(prices, { voice_second: publicPrices.voiceSenPerMinute, whatsapp_conversation: publicPrices.whatsappAgentSenPerConversation, typed_turn: publicPrices.typedTurnSen });
    const v1 = Number((await h.cleanup.query("select count(*) from app.billing_price where version=1")).rows[0].count);
    assert.equal(v1, 3, "version 1 stays in history");
    const voice2 = (await h.cleanup.query("select unit_sen,per_quantity,status from app.billing_price where version=2 and kind='voice_second'")).rows[0];
    assert.deepEqual(voice2, { unit_sen: 32, per_quantity: 60, status: "owner_placeholder" });
    // Period bounds: anchor + k months, Kuala Lumpur dates, no drift.
    const bounds = async (anchor: string, at: Date) =>
      (await h.cleanup.query("select period_start::text s,period_end::text e from app_private.plan_period_bounds($1,$2)", [anchor, at])).rows[0];
    assert.deepEqual(await bounds("2027-01-31", kl("2027-02-27")), { s: "2027-01-31", e: "2027-02-28" });
    assert.deepEqual(await bounds("2027-01-31", kl("2027-02-28")), { s: "2027-02-28", e: "2027-03-31" });
    assert.deepEqual(await bounds("2027-01-31", kl("2027-03-31")), { s: "2027-03-31", e: "2027-04-30" });
    // 23:30 UTC on 27 Feb is already 28 Feb in Kuala Lumpur.
    assert.deepEqual(await bounds("2027-01-31", new Date("2027-02-27T16:30:00Z")), { s: "2027-02-28", e: "2027-03-31" });
  } finally {
    await close();
  }
});

test("allowance is consumed before the wallet", async () => {
  const { h, worker, adjust, balance, subscribe, voice, close } = await setup();
  try {
    const org = h.orgA.id;
    await subscribe(h.alice, org);
    await adjust(org, 10000);
    const charged = await chargePlanPeriod(worker, org, kl("2027-02-01"));
    assert.equal(charged.plan, "starter");
    assert.equal(charged.periodState, "charged");
    assert.equal(await balance(org), 5100);
    const a = await voice(org, 5400, kl("2027-02-10"));
    assert.equal(a.includedSeconds, 5400);
    assert.equal(a.amountSen, 0);
    assert.equal(await balance(org), 5100);
    // 600 seconds left in the allowance; the other 600 are billed at 32 sen a minute.
    const key = "call:" + randomUUID();
    const b = await voice(org, 1200, kl("2027-02-11"), key);
    assert.equal(b.includedSeconds, 600);
    assert.equal(b.amountSen, 320);
    const again = await voice(org, 1200, kl("2027-02-11"), key);
    assert.equal(again.duplicate, true);
    assert.equal(again.includedSeconds, 600);
    assert.equal(await balance(org), 4780);
    // The allowance covers voice only.
    const wa = await recordUsage(worker, { orgId: org, kind: "whatsapp_conversation", quantity: 1, idempotencyKey: "wa:" + randomUUID(), occurredAt: kl("2027-02-11") });
    assert.equal(wa.amountSen, 15);
    const ent = await planEntitlements(worker, org, kl("2027-02-12"));
    assert.equal(ent.phoneNumbers, 1);
    assert.equal(ent.whatsappAgent, false);
    assert.equal(ent.usedIncludedSeconds, 6000);
  } finally {
    await close();
  }
});

test("allowance expires at period end and does not roll over", async () => {
  const { h, worker, adjust, balance, subscribe, voice, close } = await setup();
  try {
    const org = h.orgA.id;
    await subscribe(h.alice, org);
    await adjust(org, 20000);
    await chargePlanPeriod(worker, org, kl("2027-02-01"));
    assert.equal((await voice(org, 600, kl("2027-02-27", "23:59:00"))).includedSeconds, 600);
    // 28 Feb 00:00 Kuala Lumpur starts the next period; its fee is not paid yet.
    const late = await voice(org, 600, kl("2027-02-28", "00:00:30"));
    assert.equal(late.includedSeconds, 0);
    assert.equal(late.amountSen, 320);
    const before = await balance(org);
    const march = await chargePlanPeriod(worker, org, kl("2027-02-28", "08:00:00"));
    assert.equal(march.periodState, "charged");
    assert.equal(await balance(org), before - 4900);
    const ent = await planEntitlements(worker, org, kl("2027-03-01"));
    // A fresh 100 minutes: the 90 unused minutes of February are gone.
    assert.equal(ent.includedVoiceSeconds, 6000);
    assert.equal(ent.usedIncludedSeconds, 0);
    assert.equal((await voice(org, 6600, kl("2027-03-05"))).includedSeconds, 6000);
  } finally {
    await close();
  }
});

test("the monthly fee is debited once per period under retries", async () => {
  const { h, worker, adjust, balance, subscribe, close } = await setup();
  try {
    const org = h.orgA.id;
    await subscribe(h.alice, org);
    await adjust(org, 10000);
    const runs = await Promise.all(Array.from({ length: 6 }, (_, i) => chargePlanPeriod(worker, org, kl("2027-02-01", `1${i}:00:00`))));
    assert.equal(runs.filter((r) => !r.duplicate).length, 1);
    await worker.query("select app_private.charge_due_plans($1)", [kl("2027-02-20")]);
    await worker.query("select app_private.charge_due_plans($1)", [kl("2027-02-20")]);
    const fees = (await h.cleanup.query("select amount_sen from app.wallet_ledger where org_id=$1 and kind='plan_fee'", [org])).rows;
    assert.deepEqual(fees, [{ amount_sen: -4900 }]);
    assert.equal(await balance(org), 5100);
    assert.equal(Number((await h.cleanup.query("select count(*) from app.plan_period where org_id=$1", [org])).rows[0].count), 1);
    assert.equal(Number((await h.cleanup.query("select count(*) from app.audit_log where org_id=$1 and action='billing.plan_charged'", [org])).rows[0].count), 1);
  } finally {
    await close();
  }
});

test("insufficient balance: grace keeps the plan, then payg; fee never goes below zero", async () => {
  const { h, worker, adjust, balance, subscribe, voice, close } = await setup();
  try {
    const org = h.orgA.id;
    await subscribe(h.alice, org);
    await adjust(org, 1000);
    const unpaid = await chargePlanPeriod(worker, org, kl("2027-02-01"));
    assert.equal(unpaid.periodState, "unpaid");
    assert.equal(new Date(unpaid.graceUntil!).toISOString(), kl("2027-02-07", "00:00:00").toISOString());
    assert.equal(await balance(org), 1000);
    let ent = await planEntitlements(worker, org, kl("2027-02-02"));
    assert.equal(ent.phoneNumbers, 1, "the number stays during grace");
    assert.equal(ent.includedVoiceSeconds, 0, "no allowance before the fee lands");
    // A call during grace bills from the wallet.
    assert.equal((await voice(org, 600, kl("2027-02-02"))).amountSen, 320);
    assert.equal((await chargePlanPeriod(worker, org, kl("2027-02-03"))).periodState, "unpaid");
    assert.equal(await balance(org), 680);
    await adjust(org, 5000);
    const paid = await chargePlanPeriod(worker, org, kl("2027-02-04"));
    assert.equal(paid.periodState, "charged");
    assert.equal(await balance(org), 780);
    assert.equal((await voice(org, 600, kl("2027-02-05"))).includedSeconds, 600);

    // Organization B never tops up: after grace it falls back to payg.
    const b = h.orgB.id;
    await subscribe(h.bob, b);
    assert.equal((await chargePlanPeriod(worker, b, kl("2027-02-01"))).periodState, "unpaid");
    const down = await chargePlanPeriod(worker, b, kl("2027-02-08"));
    assert.equal(down.periodState, "downgraded");
    assert.equal((await h.cleanup.query("select plan_code from app.org_plan where org_id=$1", [b])).rows[0].plan_code, "payg");
    ent = await planEntitlements(worker, b, kl("2027-02-09"));
    assert.equal(ent.phoneNumbers, 0);
    // A call is never refused for credit: it is recorded and billed into grace.
    const call = await voice(b, 120, kl("2027-02-09"));
    assert.equal(call.amountSen, 64);
    assert.equal(call.balanceSen, -64);
    const next = await chargePlanPeriod(worker, b, kl("2027-03-01"));
    assert.equal(next.plan, "payg");
    assert.equal(next.periodState, "free");
    assert.equal(Number((await h.cleanup.query("select count(*) from app.wallet_ledger where org_id=$1 and kind='plan_fee'", [b])).rows[0].count), 0);
    assert.equal(Number((await h.cleanup.query("select count(*) from app.audit_log where org_id=$1 and action='billing.plan_downgraded'", [b])).rows[0].count), 1);
  } finally {
    await close();
  }
});

test("a plan change takes effect when the next period starts", async () => {
  const { h, worker, adjust, balance, choose, subscribe, close } = await setup();
  try {
    const org = h.orgA.id;
    // Choosing a paid plan from payg also waits for the next period.
    await choose(h.alice, org, "starter");
    assert.equal((await planEntitlements(worker, org)).plan, "payg");
    await subscribe(h.alice, org);
    await adjust(org, 30000);
    await chargePlanPeriod(worker, org, kl("2027-02-01"));
    const asked = await choose(h.alice, org, "growth");
    assert.deepEqual([asked.plan, asked.pendingPlan], ["starter", "growth"]);
    let ent = await planEntitlements(worker, org, kl("2027-02-10"));
    assert.deepEqual([ent.plan, ent.includedVoiceSeconds, ent.whatsappAgent], ["starter", 6000, false]);
    assert.equal((await chargePlanPeriod(worker, org, kl("2027-02-10"))).duplicate, true);
    assert.equal(await balance(org), 30000 - 4900);
    await chargePlanPeriod(worker, org, kl("2027-02-28"));
    ent = await planEntitlements(worker, org, kl("2027-03-01"));
    assert.deepEqual([ent.plan, ent.feeSen, ent.includedVoiceSeconds, ent.whatsappAgent], ["growth", 12900, 24000, true]);
    assert.equal(await balance(org), 30000 - 4900 - 12900);
    // Asking for the current plan cancels a pending change.
    await choose(h.alice, org, "starter");
    assert.equal((await choose(h.alice, org, "growth")).pendingPlan, null);
  } finally {
    await close();
  }
});

test("plans are isolated per organization and role", async () => {
  const { h, worker, adjust, subscribe, voice, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    await subscribe(h.alice, a);
    await subscribe(h.bob, b);
    await adjust(a, 10000);
    await adjust(b, 10000);
    await chargePlanPeriod(worker, a, kl("2027-02-01"));
    await chargePlanPeriod(worker, b, kl("2027-02-01"));
    // B uses its whole allowance; A's is untouched.
    assert.equal((await voice(b, 6000, kl("2027-02-02"))).includedSeconds, 6000);
    assert.equal((await voice(a, 60, kl("2027-02-02"))).includedSeconds, 60);
    await h.sqlAsApp(h.bob, b, async (tx) => {
      const rows = (await tx.query("select org_id from app.plan_period union all select org_id from app.org_plan")).rows;
      assert.ok(rows.length > 0 && rows.every((r) => r.org_id === b));
    });
    for (const [sql, error] of [
      ["select app_private.choose_plan($1,'growth')", /NOT_FOUND/],
      ["select app_private.plan_summary($1)", /NOT_FOUND/],
    ] as const)
      await assert.rejects(h.sqlAsApp(h.bob, b, (tx) => tx.query(sql, [a])), error);
    await assert.rejects(h.sqlAsApp(h.staff, a, (tx) => tx.query("select app_private.choose_plan($1,'growth')", [a])), /FORBIDDEN/);
    for (const sql of [
      "select app_private.charge_plan_period($1)",
      "update app.org_plan set plan_code='growth' where org_id=$1",
      "insert into app.plan_period(org_id,plan_id,plan_code,period_start,period_end,starts_at,ends_at,fee_sen,included_voice_seconds,phone_numbers,whatsapp_agent,state)select $1,id,code,'2027-01-01','2027-02-01',now(),now()+interval '1 day',0,999999,1,true,'free' from app.billing_plan limit 1",
    ])
      await assert.rejects(h.sqlAsApp(h.alice, a, (tx) => tx.query(sql, [a])), /permission denied/);
    const own = await h.sqlAsApp(h.alice, a, async (tx) => (await tx.query("select app_private.plan_summary($1) v", [a])).rows[0].v);
    assert.equal(own.plan, "starter");
  } finally {
    await close();
  }
});
