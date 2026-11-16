import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";
import { recordUsage } from "../../packages/billing/src/usage.ts";
import { chargePlanPeriod, planEntitlements } from "../../packages/billing/src/plans.ts";
import { settlePayment } from "../../packages/billing/src/settle.ts";
import { setBalance } from "../helpers/billing.ts";
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
  // Puts an organization on a plan as an operator would, with periods
  // anchored on 31 January 2027 unless another anchor is given. choose_plan
  // is never called on such an organization: it charges the period that
  // contains the real clock first.
  const subscribe = async (org: string, code = "starter", anchor = "2027-01-31") => {
    await h.cleanup.query(
      `insert into app.org_plan(org_id,plan_code,anchor_date)values($1,$2,$3)
       on conflict(org_id)do update set plan_code=excluded.plan_code,pending_plan_code=null,anchor_date=excluded.anchor_date`,
      [org, code, anchor],
    );
  };
  // Today's date in Kuala Lumpur, from the database clock.
  const today = async (plusDays = 0) =>
    (await h.cleanup.query("select ((now() at time zone 'Asia/Kuala_Lumpur')::date+$1::integer)::text d", [plusDays])).rows[0].d as string;
  const voice = (org: string, seconds: number, at: Date, key = "call:" + randomUUID()) =>
    recordUsage(worker, { orgId: org, kind: "voice_second", quantity: seconds, idempotencyKey: key, occurredAt: at });
  const close = async () => {
    await worker.end();
    await h.close();
  };
  return { h, worker, adjust, balance, choose, subscribe, today, voice, close };
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
    await subscribe(org);
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
    await subscribe(org);
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
    await subscribe(org);
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
    await subscribe(org);
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
    await subscribe(b);
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
  const { h, worker, adjust, balance, choose, subscribe, today, close } = await setup();
  try {
    // Real-clock anchors: choose_plan charges the period containing now first.
    const [org, b] = [h.orgA.id, h.orgB.id];
    const anchor = await today();
    const next = kl((await h.cleanup.query("select ($1::date+interval '1 month')::date::text d", [anchor])).rows[0].d);
    await subscribe(org, "starter", anchor);
    await adjust(org, 30000);
    assert.equal((await chargePlanPeriod(worker, org)).periodState, "charged");
    const asked = await choose(h.alice, org, "growth");
    assert.deepEqual([asked.outcome, asked.plan, asked.pendingPlan], ["scheduled", "starter", "growth"]);
    // Asking for the current plan cancels a pending change.
    const cancelled = await choose(h.alice, org, "starter");
    assert.deepEqual([cancelled.outcome, cancelled.pendingPlan], ["cancelled", null]);
    assert.equal((await choose(h.alice, org, "starter")).outcome, "unchanged");
    assert.equal((await choose(h.alice, org, "growth")).outcome, "scheduled");
    let ent = await planEntitlements(worker, org);
    assert.deepEqual([ent.plan, ent.includedVoiceSeconds, ent.whatsappAgent], ["starter", 6000, false]);
    assert.equal((await chargePlanPeriod(worker, org)).duplicate, true);
    assert.equal(await balance(org), 30000 - 4900);
    await chargePlanPeriod(worker, org, next);
    ent = await planEntitlements(worker, org, next);
    assert.deepEqual([ent.plan, ent.feeSen, ent.includedVoiceSeconds, ent.whatsappAgent], ["growth", 12900, 24000, true]);
    assert.equal(await balance(org), 30000 - 4900 - 12900);

    // Down to pay as you go also waits for the next period; no fee then.
    await subscribe(b, "starter", anchor);
    await adjust(b, 10000);
    await chargePlanPeriod(worker, b);
    const down = await choose(h.bob, b, "payg");
    assert.deepEqual([down.outcome, down.plan, down.pendingPlan], ["scheduled", "starter", "payg"]);
    assert.equal((await planEntitlements(worker, b)).phoneNumbers, 1);
    const later = await chargePlanPeriod(worker, b, next);
    assert.deepEqual([later.plan, later.periodState], ["payg", "free"]);
    assert.equal((await planEntitlements(worker, b, next)).phoneNumbers, 0);
    assert.equal(await balance(b), 10000 - 4900);
  } finally {
    await close();
  }
});

test("plans are isolated per organization and role", async () => {
  const { h, worker, adjust, subscribe, voice, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    await subscribe(a);
    await subscribe(b);
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

// Plan picker (owner decisions 2026-11-16), on the real clock: a first paid
// plan starts today in Kuala Lumpur and debits the full fee at once.
const count = async (h: H, sql: string, args: unknown[]) => Number((await h.cleanup.query(sql, args)).rows[0].n);
const fees = (h: H, org: string) => h.cleanup.query("select amount_sen from app.wallet_ledger where org_id=$1 and kind='plan_fee' order by created_at", [org]).then((r) => r.rows.map((x) => x.amount_sen));
// Periods that contain the database clock.
const current = (h: H, org: string) =>
  h.cleanup.query("select id,plan_code,state,period_start::text s,period_end::text e from app.plan_period where org_id=$1 and starts_at<=now() and ends_at>now()", [org]).then((r) => r.rows);

test("first paid plan: starts now, anchor today, full fee once", async () => {
  const { h, worker, adjust, balance, choose, today, close } = await setup();
  try {
    const org = h.orgA.id;
    await adjust(org, 6000);
    const started = await choose(h.alice, org, "starter");
    assert.deepEqual(started, { outcome: "started", plan: "starter", pendingPlan: null, anchorDate: await today() });
    const row = (await h.cleanup.query("select plan_code,pending_plan_code,anchor_date::text a from app.org_plan where org_id=$1", [org])).rows[0];
    assert.deepEqual(row, { plan_code: "starter", pending_plan_code: null, a: await today() });
    assert.deepEqual(await fees(h, org), [-4900]);
    assert.equal(await balance(org), 1100);
    const periods = await current(h, org);
    assert.equal(periods.length, 1);
    assert.deepEqual([periods[0].plan_code, periods[0].state, periods[0].s], ["starter", "charged", await today()]);
    const ent = await planEntitlements(worker, org);
    assert.deepEqual([ent.plan, ent.periodState, ent.phoneNumbers, ent.includedVoiceSeconds], ["starter", "charged", 1, 6000]);
    // The same plan again: nothing to do, no second fee.
    assert.equal((await choose(h.alice, org, "starter")).outcome, "unchanged");
    assert.deepEqual(await fees(h, org), [-4900]);
    assert.equal(await count(h, "select count(*)::int n from app.audit_log where org_id=$1 and action='billing.plan_started'", [org]), 1);
  } finally {
    await close();
  }
});

test("first paid plan: a short wallet starts nothing; exactly the fee starts", async () => {
  const { h, balance, choose, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    assert.deepEqual(await choose(h.bob, b, "growth"), {
      outcome: "wallet_short", plan: "payg", pendingPlan: null, anchorDate: null, neededSen: 12900, balanceSen: 0,
    });
    await setBalance(h.cleanup, a, 4899);
    const short = await choose(h.alice, a, "starter");
    assert.deepEqual(short, { outcome: "wallet_short", plan: "payg", pendingPlan: null, anchorDate: null, neededSen: 4900, balanceSen: 4899 });
    for (const org of [a, b]) {
      assert.equal(await count(h, "select count(*)::int n from app.org_plan where org_id=$1", [org]), 0);
      assert.equal(await count(h, "select count(*)::int n from app.plan_period where org_id=$1", [org]), 0);
      assert.deepEqual(await fees(h, org), []);
    }
    assert.equal(await balance(a), 4899);
    await setBalance(h.cleanup, a, 4900);
    assert.equal((await choose(h.alice, a, "starter")).outcome, "started");
    assert.equal(await balance(a), 0);
    assert.deepEqual(await fees(h, a), [-4900]);
  } finally {
    await close();
  }
});

test("first paid plan after a fall-back to payg starts now with a new anchor", async () => {
  const { h, worker, adjust, balance, choose, subscribe, today, close } = await setup();
  try {
    const org = h.orgA.id;
    // Starter anchored ten days ago, never paid: grace is over, so payg.
    await subscribe(org, "starter", await today(-10));
    assert.equal((await chargePlanPeriod(worker, org)).periodState, "downgraded");
    assert.equal((await h.cleanup.query("select plan_code from app.org_plan where org_id=$1", [org])).rows[0].plan_code, "payg");
    await adjust(org, 5000);
    const started = await choose(h.alice, org, "starter");
    assert.deepEqual([started.outcome, started.anchorDate], ["started", await today()]);
    // The downgraded period now ends today; only the new one covers now.
    const old = (await h.cleanup.query("select state,period_end::text e from app.plan_period where org_id=$1 and period_start=$2::date", [org, await today(-10)])).rows[0];
    assert.deepEqual(old, { state: "downgraded", e: await today() });
    const periods = await current(h, org);
    assert.equal(periods.length, 1);
    assert.deepEqual([periods[0].state, periods[0].s], ["charged", await today()]);
    const ent = await planEntitlements(worker, org);
    assert.deepEqual([ent.periodState, ent.periodStart, ent.phoneNumbers], ["charged", await today(), 1]);
    assert.equal(await balance(org), 100);
  } finally {
    await close();
  }
});

test("first paid plan reuses a free period that began today", async () => {
  const { h, worker, adjust, choose, subscribe, today, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    await subscribe(a, "payg", await today());
    const free = await chargePlanPeriod(worker, a);
    assert.equal(free.periodState, "free");
    const before = await current(h, a);
    // Short first: the free period and the payg row stay as they were.
    assert.equal((await choose(h.alice, a, "starter")).outcome, "wallet_short");
    assert.deepEqual(await current(h, a), before);
    await adjust(a, 4900);
    assert.equal((await choose(h.alice, a, "starter")).outcome, "started");
    const after = await current(h, a);
    assert.equal(after.length, 1);
    assert.equal(after[0].id, before[0].id, "the same period row, charged in place");
    assert.deepEqual([after[0].plan_code, after[0].state], ["starter", "charged"]);
    assert.equal(await count(h, "select count(*)::int n from app.plan_period where org_id=$1", [a]), 1);

    // A row the old choose_plan left (payg with starter pending) beside a
    // free period: picking starter starts now.
    await subscribe(b, "payg", await today());
    await chargePlanPeriod(worker, b);
    await h.cleanup.query("update app.org_plan set pending_plan_code='starter' where org_id=$1", [b]);
    await adjust(b, 4900);
    const legacy = await choose(h.bob, b, "starter");
    assert.deepEqual([legacy.outcome, legacy.plan, legacy.pendingPlan], ["started", "starter", null]);
    assert.deepEqual(await fees(h, b), [-4900]);
    assert.equal((await current(h, b))[0].state, "charged");
  } finally {
    await close();
  }
});

test("choosing a plan: owners and admins of the organization only", async () => {
  const { h, adjust, close } = await setup();
  try {
    const a = h.orgA.id;
    await adjust(a, 20000);
    await assert.rejects(h.sqlAsApp(h.staff, a, (tx) => tx.query("select app_private.choose_plan($1,'starter')", [a])), /FORBIDDEN/);
    await assert.rejects(h.sqlAsApp(h.staff, a, (tx) => tx.query("select app_private.plan_summary($1)", [a])), /FORBIDDEN/);
    await assert.rejects(h.sqlAsApp(h.bob, h.orgB.id, (tx) => tx.query("select app_private.choose_plan($1,'starter')", [a])), /NOT_FOUND/);
    assert.equal(await count(h, "select count(*)::int n from app.org_plan where org_id=$1", [a]), 0);
    assert.deepEqual(await fees(h, a), []);
  } finally {
    await close();
  }
});

test("a credited top-up retries an unpaid plan fee once", async () => {
  const { h, worker, balance, subscribe, today, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    const topup = async (who: H["alice"], org: string, sen: number, ref: string) => {
      const t = (await h.sqlAsApp(who, org, (tx) => tx.query("select app_private.create_topup($1,$2,'fake') v", [org, sen]))).rows[0].v;
      await h.sqlAsApp(who, org, (tx) => tx.query("select app_private.attach_topup($1,$2,$3,null)", [org, t.id, ref]));
      return (event = "captured") =>
        settlePayment(h.cleanup, "fake", { kind: "payment", orderRef: ref, paymentRef: "pay_" + ref, eventKey: `pay:pay_${ref}:${event}`, paid: true, amountSen: sen, currency: "MYR", paidAt: new Date() }, "callback");
    };
    for (const org of [a, b]) {
      await subscribe(org, "starter", await today());
      assert.equal((await chargePlanPeriod(worker, org)).periodState, "unpaid");
    }
    // More than the fee: credited, then the fee lands in the same transaction.
    const ref = "order_fakeplan" + randomUUID().slice(0, 8);
    const settle = await topup(h.alice, a, 10000, ref);
    assert.equal((await settle()).outcome, "credited");
    assert.equal((await current(h, a))[0].state, "charged");
    assert.equal(await balance(a), 10000 - 4900);
    // The same event again, and order.paid for the same payment: no second fee.
    assert.equal((await settle()).outcome, "duplicate");
    assert.equal((await settle("order_paid")).outcome, "already_paid");
    assert.deepEqual(await fees(h, a), [-4900]);
    assert.equal(await balance(a), 5100);
    assert.equal(await count(h, "select count(*)::int n from app.audit_log where org_id=$1 and action='billing.plan_retry_failed'", [a]), 0);
    // Less than the fee: the whole top-up is credited, the fee stays unpaid.
    const small = await topup(h.bob, b, 2000, "order_fakeplan" + randomUUID().slice(0, 8));
    assert.equal((await small()).outcome, "credited");
    assert.equal((await current(h, b))[0].state, "unpaid");
    assert.equal(await balance(b), 2000);
    assert.deepEqual(await fees(h, b), []);
  } finally {
    await close();
  }
});

test("charge_due_plans: one organization failing does not stop the others", async () => {
  const { h, worker, adjust, subscribe, today, close } = await setup();
  const blocker = await h.cleanup.connect();
  const run = await worker.connect();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    for (const org of [a, b]) await subscribe(org, "starter", await today());
    await chargePlanPeriod(worker, a);
    await adjust(a, 10000);
    await adjust(b, 10000);
    // Another transaction holds A's wallet lock (as a call starting would);
    // with a short lock timeout A's charge fails and is rolled back alone.
    await blocker.query("begin");
    await blocker.query("select pg_advisory_xact_lock(hashtextextended('wallet:'||$1::text,0))", [a]);
    const plans = await count(h, "select count(*)::int n from app.org_plan", []);
    await run.query("begin");
    await run.query("set local lock_timeout='300ms'");
    const n = (await run.query("select app_private.charge_due_plans() n")).rows[0].n;
    await run.query("commit");
    assert.equal(n, plans - 1);
    assert.equal((await current(h, b))[0].state, "charged");
    assert.equal((await current(h, a))[0].state, "unpaid");
    assert.deepEqual(await fees(h, a), []);
    await blocker.query("rollback");
    await worker.query("select app_private.charge_due_plans()");
    assert.equal((await current(h, a))[0].state, "charged");
    assert.deepEqual(await fees(h, b), [-4900]);
  } finally {
    await blocker.query("rollback").catch(() => {});
    blocker.release();
    run.release();
    await close();
  }
});

test("plan_summary: plans on offer, balance and a pending change", async () => {
  const { h, adjust, choose, close } = await setup();
  try {
    const a = h.orgA.id;
    const summary = () => h.sqlAsApp(h.alice, a, async (tx) => (await tx.query("select app_private.plan_summary($1) v", [a])).rows[0].v);
    const empty = await summary();
    assert.deepEqual([empty.plan, empty.periodState, empty.pendingPlan, empty.anchorDate, empty.balanceSen], ["payg", "none", null, null, 0]);
    assert.deepEqual(
      empty.plans.map((p: { code: string; feeSen: number }) => [p.code, p.feeSen]),
      [["growth", 12900], ["starter", 4900], ["payg", 0]],
    );
    await adjust(a, 20000);
    await choose(h.alice, a, "starter");
    await choose(h.alice, a, "growth");
    const s = await summary();
    assert.deepEqual([s.plan, s.periodState, s.pendingPlan, s.balanceSen, s.feeSen, s.includedVoiceSeconds], ["starter", "charged", "growth", 15100, 4900, 6000]);
  } finally {
    await close();
  }
});
