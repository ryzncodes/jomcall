import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { Engine } from "../../engine/src/engine.ts";

// The engine runs app_private.charge_due_plans at most once an hour.
// Test namespaces are legal only in test mode (the API harness sets it too).
process.env.NODE_ENV = "test";
test("the engine charges due plans through the worker role", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const org = h.orgA.id;
    await h.cleanup.query(
      "insert into app.org_plan(org_id,plan_code,anchor_date)values($1,'starter',(now() at time zone 'Asia/Kuala_Lumpur')::date)",
      [org],
    );
    await h.cleanup.query("select app_private.admin_adjust($1,10000,'Test credit','Test operator',$2)", [org, "test-" + randomUUID()]);
    engine = await Engine.create(h.namespace, { plans: { firstAfterMs: 0 } });
    await engine.tick();
    const period = (await h.cleanup.query("select state from app.plan_period where org_id=$1 and starts_at<=now() and ends_at>now()", [org])).rows;
    assert.deepEqual(period, [{ state: "charged" }]);
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("plan charging runs once an hour, retries after five minutes, never stops the tick", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    let t = 1_000_000,
      runs = 0,
      fail = false;
    const minute = 60_000;
    engine = await Engine.create(h.namespace, {
      plans: {
        firstAfterMs: minute,
        everyMs: 60 * minute,
        retryMs: 5 * minute,
        now: () => t,
        run: async () => {
          runs++;
          if (fail) throw Error("DATABASE_DOWN");
        },
      },
    });
    const step = async (minutes: number, expected: number) => {
      t += minutes * minute;
      await engine!.tick();
      assert.equal(runs, expected, `after +${minutes} min`);
    };
    await step(0, 0);
    await step(1, 1);
    await step(10, 1);
    await step(49, 1);
    await step(1, 2);
    fail = true;
    engine.lastTickAt = 0;
    await step(60, 3);
    assert.ok(engine.lastTickAt > 0, "the tick ran to the end after a failed run");
    await step(4, 3);
    fail = false;
    await step(1, 4);
    await step(59, 4);
    await step(1, 5);
  } finally {
    await engine?.close();
    await h.close();
  }
});
