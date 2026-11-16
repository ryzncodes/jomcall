import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { adjustWallet, balanceSen } from "../helpers/billing.ts";

// The plan and choosePlan commands (plan picker, owner decisions 2026-11-16).
const path = "/api/v1/billing/plan";

test("plan and choosePlan: owner starts a plan, staff refused, repeats are stored", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    const today = (await h.cleanup.query("select (now() at time zone 'Asia/Kuala_Lumpur')::date::text d")).rows[0].d;
    const fees = async (org: string) =>
      Number((await h.cleanup.query("select count(*) from app.wallet_ledger where org_id=$1 and kind='plan_fee'", [org])).rows[0].count);

    const first = await api.request(h.alice, a, "GET", path);
    assert.equal(first.status, 200);
    const s = first.body.data;
    assert.deepEqual(
      [s.plan, s.periodState, s.periodStart, s.periodEnd, s.feeSen, s.graceUntil, s.pendingPlan, s.anchorDate, s.balanceSen, s.phoneNumbers],
      ["payg", "none", null, null, 0, null, null, null, 0, 0],
    );
    assert.deepEqual(
      s.plans.map((p: { code: string; feeSen: number; graceDays: number }) => [p.code, p.feeSen, p.graceDays]),
      [["growth", 12900, 7], ["starter", 4900, 7], ["payg", 0, 0]],
    );
    assert.equal("periodId" in s, false);

    // Staff may neither read nor choose.
    for (const [method, body] of [["GET", undefined], ["POST", { code: "starter" }]] as const) {
      const r = await api.request(h.staff, a, method, path, body);
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, "FORBIDDEN");
    }
    assert.equal((await api.request(h.alice, a, "POST", path, { code: "gold" })).status, 422);

    // A short wallet is an answer, not an error.
    const shortKey = randomUUID();
    const short = await api.request(h.bob, b, "POST", path, { code: "growth" }, { "idempotency-key": shortKey });
    assert.equal(short.status, 200);
    assert.deepEqual(short.body.data, {
      outcome: "wallet_short", plan: "payg", pendingPlan: null, anchorDate: null, neededSen: 12900, balanceSen: 0,
    });
    // The same key after a top-up replays the stored answer; a new key starts.
    await adjustWallet(h.cleanup, b, 12900);
    assert.deepEqual((await api.request(h.bob, b, "POST", path, { code: "growth" }, { "idempotency-key": shortKey })).body.data, short.body.data);
    assert.equal(await fees(b), 0);
    assert.equal((await api.request(h.bob, b, "POST", path, { code: "growth" })).body.data.outcome, "started");
    assert.equal(await balanceSen(h.cleanup, b), 0);

    // Owner starts starter; the same key again returns the stored result, no second fee.
    await adjustWallet(h.cleanup, a, 6000);
    const key = randomUUID();
    const started = await api.request(h.alice, a, "POST", path, { code: "starter" }, { "idempotency-key": key });
    assert.equal(started.status, 200);
    assert.deepEqual(started.body.data, { outcome: "started", plan: "starter", pendingPlan: null, anchorDate: today });
    const again = await api.request(h.alice, a, "POST", path, { code: "starter" }, { "idempotency-key": key });
    assert.deepEqual(again.body.data, started.body.data);
    assert.equal(await fees(a), 1);
    assert.equal(await balanceSen(h.cleanup, a), 1100);
    // The same key with another plan is a conflict.
    assert.equal((await api.request(h.alice, a, "POST", path, { code: "growth" }, { "idempotency-key": key })).status, 409);

    const now = (await api.request(h.alice, a, "GET", path)).body.data;
    assert.deepEqual(
      [now.plan, now.periodState, now.periodStart, now.feeSen, now.includedVoiceSeconds, now.usedIncludedSeconds, now.phoneNumbers, now.anchorDate, now.balanceSen],
      ["starter", "charged", today, 4900, 6000, 0, 1, today, 1100],
    );
    // A change on a paid plan waits for the next period.
    const scheduled = (await api.request(h.alice, a, "POST", path, { code: "growth" })).body.data;
    assert.deepEqual([scheduled.outcome, scheduled.plan, scheduled.pendingPlan], ["scheduled", "starter", "growth"]);
    assert.equal((await api.request(h.alice, a, "GET", path)).body.data.pendingPlan, "growth");
  } finally {
    await api.close();
    await h.close();
  }
});
