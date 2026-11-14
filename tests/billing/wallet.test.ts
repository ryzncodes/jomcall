import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { recordUsage, walletState } from "../../packages/billing/src/usage.ts";
import { fakeCallback } from "../../packages/billing/src/fake.ts";

type H = Awaited<ReturnType<typeof createHarness>>;
const form = "application/x-www-form-urlencoded";
async function setup() {
  process.env.JOMCALL_PAYMENT_PROVIDER = "fake";
  const h = await createHarness(),
    api = await createApiHarness(h);
  const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 2 });
  const close = async () => {
    await worker.end();
    await api.close();
    await h.close();
    delete process.env.JOMCALL_PAYMENT_PROVIDER;
  };
  const adjust = (h: H, org: string, sen: number, reason = "Test credit") =>
    h.cleanup.query("select app_private.admin_adjust($1,$2,$3,'Test operator',$4)", [org, sen, reason, "test-" + randomUUID()]);
  return { h, api, worker, close, adjust };
}
const sum = async (h: H, org: string) =>
  Number((await h.cleanup.query("select coalesce(sum(amount_sen),0) s from app.wallet_ledger where org_id=$1", [org])).rows[0].s);

test("ledger is append-only for the app role and for the database owner", async () => {
  const { h, close, adjust } = await setup();
  try {
    await adjust(h, h.orgA.id, 1000);
    for (const sql of [
      "update app.wallet_ledger set amount_sen=999999",
      "delete from app.wallet_ledger",
      "insert into app.wallet_ledger(org_id,kind,amount_sen,idempotency_key)values($1,'adjustment',100,'forged-entry')",
      "update app.usage_event set amount_sen=0",
      "update app.billing_topup set state='paid'",
    ])
      await assert.rejects(
        h.sqlAsApp(h.alice, h.orgA.id, (tx) => tx.query(sql, sql.includes("$1") ? [h.orgA.id] : [])),
        /permission denied/,
      );
    await assert.rejects(h.cleanup.query("update app.wallet_ledger set amount_sen=1 where org_id=$1", [h.orgA.id]), /APPEND_ONLY/);
    await assert.rejects(h.cleanup.query("delete from app.wallet_ledger where org_id=$1", [h.orgA.id]), /APPEND_ONLY/);
    await assert.rejects(h.cleanup.query("truncate app.wallet_ledger"), /APPEND_ONLY|permission denied/);
    // Database constraints: integer sen, MYR only, signs per kind.
    await assert.rejects(h.cleanup.query("insert into app.wallet_ledger(org_id,kind,amount_sen,currency,idempotency_key)values($1,'trial_credit',100,'USD','x-currency-1')", [h.orgA.id]), /check constraint/);
    await assert.rejects(h.cleanup.query("insert into app.wallet_ledger(org_id,kind,amount_sen,idempotency_key)values($1,'trial_credit',$2,'x-fraction-1')", [h.orgA.id, "1.5"]), /invalid input syntax/);
    await assert.rejects(h.cleanup.query("insert into app.wallet_ledger(org_id,kind,amount_sen,idempotency_key)values($1,'topup',-100,'x-sign-0001')", [h.orgA.id]), /check constraint/);
    // Deleting an organization still removes its records.
    const org = (await h.db.bootstrap(h.alice, { name: "Padam Contoh", businessType: "other", primaryLocationName: "Utama" }, { idempotencyKey: randomUUID() })).orgId;
    await adjust(h, org, 500);
    await h.cleanup.query("delete from app.organization where id=$1", [org]);
    assert.equal(Number((await h.cleanup.query("select count(*) from app.wallet_ledger where org_id=$1", [org])).rows[0].count), 0);
  } finally {
    await close();
  }
});

test("metering bills once per key, balance equals the ledger sum, thresholds", async () => {
  const { h, worker, close, adjust } = await setup();
  try {
    const org = h.orgA.id;
    assert.equal((await walletState(worker, org)).state, "unfunded");
    assert.equal((await walletState(worker, org)).serviceAllowed, false);
    await adjust(h, org, 1500);
    assert.equal((await walletState(worker, org)).state, "ok");
    const key = "call:" + randomUUID();
    const first = await recordUsage(worker, { orgId: org, kind: "voice_second", quantity: 180, idempotencyKey: key });
    assert.equal(first.amountSen, 96); // 3 minutes at 32 sen
    assert.equal(first.duplicate, false);
    const again = await recordUsage(worker, { orgId: org, kind: "voice_second", quantity: 180, idempotencyKey: key });
    assert.equal(again.duplicate, true);
    assert.equal(again.usageEventId, first.usageEventId);
    assert.equal(again.balanceSen, 1500 - 96);
    await assert.rejects(recordUsage(worker, { orgId: org, kind: "voice_second", quantity: 181, idempotencyKey: key }), /CONFLICT/);
    await assert.rejects(recordUsage(worker, { orgId: org, kind: "fax_page" as never, quantity: 1, idempotencyKey: "fax:" + randomUUID() }), /UNKNOWN_USAGE_KIND/);
    // 61 seconds rounds up to the next sen: ceil(61*32/60)=33.
    assert.equal((await recordUsage(worker, { orgId: org, kind: "voice_second", quantity: 61, idempotencyKey: "call:" + randomUUID() })).amountSen, 33);
    assert.equal((await walletState(worker, org)).state, "ok"); // 1371
    await recordUsage(worker, { orgId: org, kind: "whatsapp_conversation", quantity: 4, idempotencyKey: "wa:" + randomUUID() }); // 60
    await recordUsage(worker, { orgId: org, kind: "voice_second", quantity: 60 * 10, idempotencyKey: "call:" + randomUUID() }); // 320
    let s = await walletState(worker, org);
    assert.equal(s.balanceSen, 1500 - 96 - 33 - 60 - 320);
    assert.equal(s.state, "low");
    assert.equal(s.serviceAllowed, true);
    await recordUsage(worker, { orgId: org, kind: "voice_second", quantity: 60 * 33, idempotencyKey: "call:" + randomUUID() }); // 1056 -> -65
    s = await walletState(worker, org);
    assert.equal(s.state, "grace");
    assert.equal(s.serviceAllowed, true);
    // Usage that happened is recorded even past the floor; new service stops.
    await recordUsage(worker, { orgId: org, kind: "typed_turn", quantity: 300, idempotencyKey: "turn:" + randomUUID() }); // 600
    s = await walletState(worker, org);
    assert.equal(s.state, "exhausted");
    assert.equal(s.serviceAllowed, false);
    assert.equal(s.balanceSen, await sum(h, org));
    assert.equal(s.balanceSen, 1500 - 96 - 33 - 60 - 320 - 1056 - 600);
    // The other organization is untouched.
    assert.equal((await walletState(worker, h.orgB.id)).balanceSen, 0);
  } finally {
    await close();
  }
});

test("roles and tenants: staff cannot pay or read; other tenants see nothing", async () => {
  const { h, api, close, adjust } = await setup();
  try {
    await adjust(h, h.orgA.id, 2000);
    for (const [m, p, b] of [
      ["GET", "/api/v1/billing/wallet", undefined],
      ["GET", "/api/v1/billing/ledger", undefined],
      ["POST", "/api/v1/billing/topups", { amountSen: 2000 }],
      ["POST", "/api/v1/billing/trial", {}],
    ] as const)
      assert.equal((await api.request(h.staff, h.orgA.id, m, p, b)).status, 403, p);
    await h.sqlAsApp(h.staff, h.orgA.id, async (tx) =>
      assert.equal((await tx.query("select * from app.wallet_ledger")).rowCount, 0),
    );
    for (const [sql, error] of [
      ["select app_private.wallet_summary($1)", /FORBIDDEN/],
      ["select app_private.create_topup($1,2000,'fake')", /FORBIDDEN/],
      ["select app_private.claim_trial($1)", /FORBIDDEN/],
      ["select app_private.record_usage($1,'typed_turn',1,'forged-usage')", /permission denied/],
      ["select app_private.admin_adjust($1,100,'self credit','me','forged-credit')", /permission denied/],
    ] as const)
      await assert.rejects(h.sqlAsApp(h.staff, h.orgA.id, (tx) => tx.query(sql, [h.orgA.id])), error);
    await h.sqlAsApp(h.bob, h.orgB.id, async (tx) =>
      assert.equal((await tx.query("select * from app.wallet_ledger")).rowCount, 0),
    );
    await assert.rejects(
      h.sqlAsApp(h.bob, h.orgB.id, (tx) => tx.query("select app_private.wallet_summary($1)", [h.orgA.id])),
      /NOT_FOUND/,
    );
    assert.equal((await api.request(h.bob, h.orgA.id, "GET", "/api/v1/billing/wallet")).status, 404);
    const own = await api.request(h.alice, h.orgA.id, "GET", "/api/v1/billing/wallet");
    assert.equal(own.status, 200);
    assert.equal(own.body.data.balanceSen, 2000);
    assert.equal(own.body.data.provider.name, "fake");
    assert.equal((await api.request(h.alice, h.orgA.id, "GET", "/api/v1/billing/ledger")).body.data.items.length, 1);
  } finally {
    await close();
  }
});

test("trial credit once per organization and per user", async () => {
  const { h, api, close } = await setup();
  try {
    const a = await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/trial", {});
    assert.equal(a.status, 200);
    assert.equal(a.body.data.balanceSen, 2000);
    assert.equal((await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/trial", {})).body.error.code, "TRIAL_USED");
    const second = (await h.db.bootstrap(h.alice, { name: "Kedai Dua", businessType: "other", primaryLocationName: "Utama" }, { idempotencyKey: randomUUID() })).orgId;
    try {
      assert.equal((await api.request(h.alice, second, "POST", "/api/v1/billing/trial", {})).status, 409);
    } finally {
      await h.cleanup.query("delete from app.organization where id=$1", [second]);
    }
  } finally {
    await close();
  }
});

test("top-up through the fake provider: duplicate, replayed, wrong signature and wrong amount", async () => {
  const { h, api, close } = await setup();
  try {
    const started = await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/topups", { amountSen: 5000 });
    assert.equal(started.status, 200);
    const topup = started.body.data;
    assert.equal(topup.state, "pending");
    assert.match(topup.provider_ref, /^fake_[0-9a-f]{16}$/);
    const ref = topup.provider_ref;
    const hook = "/api/billing/webhook/fake";
    // Wrong signature and wrong provider path are refused, nothing credited.
    assert.equal((await api.post(hook, fakeCallback({ id: ref, amountSen: 5000, paid: true, key: "wrong" }), form)).status, 401);
    assert.equal((await api.post("/api/billing/webhook/billplz", fakeCallback({ id: ref, amountSen: 5000, paid: true }), form)).status, 404);
    assert.equal((await api.post(hook, "x".repeat(17 * 1024), form)).status, 413);
    assert.equal(await sum(h, h.orgA.id), 0);
    // A failed attempt first; the bill stays payable.
    assert.equal((await api.post(hook, fakeCallback({ id: ref, amountSen: 5000, paid: false, transactionId: "t-fail" }), form)).status, 200);
    // Paid, then the same callback replayed, then a second paid event.
    const paid = fakeCallback({ id: ref, amountSen: 5000, paid: true, transactionId: "t-ok" });
    for (let i = 0; i < 3; i++) assert.equal((await api.post(hook, paid, form)).status, 200);
    assert.equal((await api.post(hook, fakeCallback({ id: ref, amountSen: 5000, paid: true, transactionId: "t-other" }), form)).status, 200);
    // A late failure after payment changes nothing.
    await api.post(hook, fakeCallback({ id: ref, amountSen: 5000, paid: false, transactionId: "t-late" }), form);
    assert.equal(await sum(h, h.orgA.id), 5000);
    const list = (await api.request(h.alice, h.orgA.id, "GET", "/api/v1/billing/topups")).body.data.items;
    assert.equal(list[0].state, "paid");
    const receipts = (await api.request(h.alice, h.orgA.id, "GET", "/api/v1/billing/receipts")).body.data.items;
    assert.equal(receipts.length, 1);
    assert.match(receipts[0].number, /^JC-\d{4}-\d{6}$/);
    assert.equal(receipts[0].amount_sen, 5000);
    // Wrong amount: held for review, not credited, even if later corrected.
    const second = (await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/topups", { amountSen: 2000 })).body.data;
    assert.equal((await api.post(hook, fakeCallback({ id: second.provider_ref, amountSen: 2000, paid: true, paidAmountSen: 200, transactionId: "t-m" }), form)).status, 200);
    await api.post(hook, fakeCallback({ id: second.provider_ref, amountSen: 2000, paid: true, transactionId: "t-m2" }), form);
    assert.equal(await sum(h, h.orgA.id), 5000);
    const reviewed = (await h.cleanup.query("select state,failure_code from app.billing_topup where id=$1", [second.id])).rows[0];
    assert.deepEqual(reviewed, { state: "review", failure_code: "AMOUNT_MISMATCH" });
    // Wrong currency through the database entry point is refused the same way.
    const third = (await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/topups", { amountSen: 2000 })).body.data;
    const r = (await h.cleanup.query("select app_private.settle_topup('fake',$1,'cur-1',true,2000,'USD',now(),'callback') v", [third.provider_ref])).rows[0].v;
    assert.equal(r.outcome, "mismatch");
    assert.equal(await sum(h, h.orgA.id), 5000);
    // Retrying the start command with the same key returns the same top-up.
    const key = randomUUID();
    const once = await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/topups", { amountSen: 10000 }, { "idempotency-key": key });
    const twice = await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/topups", { amountSen: 10000 }, { "idempotency-key": key });
    assert.equal(once.body.data.id, twice.body.data.id);
    assert.equal((await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/topups", { amountSen: 999 })).status, 422);
  } finally {
    await close();
  }
});

test("a callback before the top-up is attached still settles on retry", async () => {
  const { h, close } = await setup();
  try {
    const t = (await h.sqlAsApp(h.alice, h.orgA.id, (tx) => tx.query("select app_private.create_topup($1,2000,'fake') v", [h.orgA.id]))).rows[0].v;
    const early = (await h.cleanup.query("select app_private.settle_topup('fake','fake_early01','cb:fake_early01:paid:t1',true,2000,'MYR',now(),'callback') v")).rows[0].v;
    assert.equal(early.outcome, "unmatched");
    await h.sqlAsApp(h.alice, h.orgA.id, (tx) => tx.query("select app_private.attach_topup($1,$2,'fake_early01','http://127.0.0.1:4182/app/billing')", [h.orgA.id, t.id]));
    const retry = (await h.cleanup.query("select app_private.settle_topup('fake','fake_early01','cb:fake_early01:paid:t1',true,2000,'MYR',now(),'callback') v")).rows[0].v;
    assert.equal(retry.outcome, "credited");
    assert.equal(await sum(h, h.orgA.id), 2000);
  } finally {
    await close();
  }
});

test("refunds and adjustments need a reason and cannot exceed what is left", async () => {
  const { h, api, close } = await setup();
  try {
    const t = (await api.request(h.alice, h.orgA.id, "POST", "/api/v1/billing/topups", { amountSen: 5000 })).body.data;
    await api.post("/api/billing/webhook/fake", fakeCallback({ id: t.provider_ref, amountSen: 5000, paid: true }), form);
    const refund = (amount: number, key: string, reason = "Customer request") =>
      h.cleanup.query("select app_private.admin_refund($1,$2,$3,$4,'Test operator',$5) v", [h.orgA.id, t.id, amount, reason, key]);
    await assert.rejects(refund(1000, "refund-no-reason", ""), /INVALID_REFUND/);
    const r1 = (await refund(1500, "refund-key-1")).rows[0].v;
    assert.equal(r1.balanceSen, 3500);
    assert.equal((await refund(1500, "refund-key-1")).rows[0].v.duplicate, true);
    await assert.rejects(refund(4000, "refund-key-2"), /REFUND_EXCEEDS/);
    const entries = (await h.cleanup.query("select kind,amount_sen,reason from app.wallet_ledger where org_id=$1 order by created_at", [h.orgA.id])).rows;
    assert.deepEqual(entries.map((e) => [e.kind, e.amount_sen]), [["topup", 5000], ["refund", -1500]]);
    assert.equal(entries[1].reason, "Customer request");
    await assert.rejects(h.cleanup.query("select app_private.admin_adjust($1,100,'','op','adjust-key-1')", [h.orgA.id]), /INVALID_ADJUSTMENT/);
    const audit = (await h.cleanup.query("select action,metadata from app.audit_log where org_id=$1 and action like 'billing.%' order by created_at", [h.orgA.id])).rows;
    assert.deepEqual(audit.map((a) => a.action), ["billing.topup_created", "billing.topup_paid", "billing.refunded"]);
    assert.equal(audit[2].metadata.operator, "Test operator");
    assert.equal(await sum(h, h.orgA.id), 3500);
  } finally {
    await close();
  }
});
