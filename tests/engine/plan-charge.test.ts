import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { Engine } from "../../engine/src/engine.ts";

// The engine lists the organizations due (app_private.plan_orgs_due) at most
// once an hour and charges each in its own transaction, 25 per tick.
// Test namespaces are legal only in test mode (the API harness sets it too).
process.env.NODE_ENV = "test";
type H = Awaited<ReturnType<typeof createHarness>>;
const starter = async (h: H, org: string, creditSen: number) => {
  await h.cleanup.query(
    "insert into app.org_plan(org_id,plan_code,anchor_date)values($1,'starter',(now() at time zone 'Asia/Kuala_Lumpur')::date)",
    [org],
  );
  await h.cleanup.query("select app_private.admin_adjust($1,$2,'Test credit','Test operator',$3)", [org, creditSen, "test-" + randomUUID()]);
};
const period = async (h: H, org: string) =>
  (await h.cleanup.query("select state from app.plan_period where org_id=$1 and starts_at<=now() and ends_at>now()", [org])).rows;
const fees = async (h: H, org: string) =>
  (await h.cleanup.query("select amount_sen from app.wallet_ledger where org_id=$1 and kind='plan_fee'", [org])).rows.map((r) => r.amount_sen);

test("the engine charges due plans through the worker role", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const org = h.orgA.id;
    await starter(h, org, 10000);
    // The fee emails read every organization in the database: stubbed here
    // (tests/billing/plan-notices.test.ts covers them).
    engine = await Engine.create(h.namespace, { plans: { firstAfterMs: 0, notify: async () => {} } });
    // Other organizations in the shared database may be due too: a list
    // longer than one batch carries on at the next ticks.
    for (let i = 0; i < 10 && !(await period(h, org)).length; i++) await engine.tick();
    assert.deepEqual(await period(h, org), [{ state: "charged" }]);
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
      notices = 0,
      fail = false;
    const minute = 60_000;
    engine = await Engine.create(h.namespace, {
      plans: {
        firstAfterMs: minute,
        everyMs: 60 * minute,
        retryMs: 5 * minute,
        now: () => t,
        due: async () => {
          runs++;
          if (fail) throw Error("DATABASE_DOWN");
          return [];
        },
        notify: async () => void notices++,
      },
    });
    // Each run that listed its organizations queues the fee emails once.
    const step = async (minutes: number, expected: number, emails: number) => {
      t += minutes * minute;
      await engine!.tick();
      assert.equal(runs, expected, `after +${minutes} min`);
      assert.equal(notices, emails, `emails after +${minutes} min`);
    };
    await step(0, 0, 0);
    await step(1, 1, 1);
    await step(10, 1, 1);
    await step(49, 1, 1);
    await step(1, 2, 2);
    fail = true;
    engine.lastTickAt = 0;
    await step(60, 3, 2);
    assert.ok(engine.lastTickAt > 0, "the tick ran to the end after a failed run");
    await step(4, 3, 2);
    fail = false;
    await step(1, 4, 3);
    await step(59, 4, 3);
    await step(1, 5, 4);
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("each organization is charged alone: a held wallet lock fails only that one, retried in five minutes", async () => {
  const h = await createHarness();
  const blocker = await h.cleanup.connect();
  const errors: unknown[][] = [];
  const log = console.error;
  let engine: Engine | undefined;
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    for (const org of [a, b]) await starter(h, org, 10000);
    let t = 1_000_000,
      lists = 0;
    const minute = 60_000;
    engine = await Engine.create(h.namespace, {
      plans: {
        firstAfterMs: 0,
        everyMs: 60 * minute,
        retryMs: 5 * minute,
        now: () => t,
        // Only these two, whatever else the shared database holds.
        due: async () => {
          lists++;
          return [a, b];
        },
        notify: async () => {},
      },
    });
    console.error = (...args: unknown[]) => void errors.push(args);
    // Another transaction holds A's wallet lock (as a call starting would).
    await blocker.query("begin");
    await blocker.query("select pg_advisory_xact_lock(hashtextextended('wallet:'||$1::text,0))", [a]);
    await engine.tick();
    assert.deepEqual(await period(h, a), [], "A rolled back alone");
    assert.deepEqual(await period(h, b), [{ state: "charged" }]);
    const failures = () => errors.filter((e) => e[0] === "PLAN_CHARGE_RUN_FAILED");
    assert.deepEqual(failures(), [["PLAN_CHARGE_RUN_FAILED", "ok=1 failed=1"]]);
    const logged = JSON.stringify(errors);
    assert.ok(!logged.includes(a) && !logged.includes(b), "counts only, no organization ids");
    await blocker.query("rollback");
    t += 4 * minute;
    await engine.tick();
    assert.equal(lists, 1, "no retry before five minutes");
    t += minute;
    await engine.tick();
    assert.equal(lists, 2);
    assert.deepEqual(await period(h, a), [{ state: "charged" }]);
    // A later run visits both again: nothing is charged twice.
    t += 60 * minute;
    await engine.tick();
    assert.equal(lists, 3);
    assert.deepEqual(await fees(h, a), [-4900]);
    assert.deepEqual(await fees(h, b), [-4900]);
    assert.equal(failures().length, 1);
  } finally {
    console.error = log;
    await blocker.query("rollback").catch(() => {});
    blocker.release();
    await engine?.close();
    await h.close();
  }
});

test("one tick charges at most 25 organizations; the rest carry over to the next ticks, each once", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const ids = Array.from({ length: 60 }, (_, i) => `org-${i}`);
    const charged: string[] = [];
    const emailsAt: number[] = [];
    let t = 1_000_000,
      lists = 0;
    const hour = 3_600_000;
    engine = await Engine.create(h.namespace, {
      plans: {
        firstAfterMs: 0,
        everyMs: hour,
        now: () => t,
        due: async () => {
          lists++;
          return [...ids];
        },
        charge: async (_pool, id) => void charged.push(id),
        notify: async () => void emailsAt.push(charged.length),
      },
    });
    for (const expected of [25, 50, 60]) {
      await engine.tick();
      assert.equal(charged.length, expected);
      t += 1000;
    }
    assert.deepEqual(charged, ids);
    assert.deepEqual(emailsAt, [60], "fee emails once, after the last batch");
    assert.equal(lists, 1, "one list per run");
    await engine.tick();
    assert.equal(charged.length, 60, "the next run waits for the hour");
    t += hour;
    await engine.tick();
    assert.deepEqual([lists, charged.length], [2, 85]);
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("fee emails are queued after the charges, with the engine's namespace; a failure is logged without ids and stops nothing", async () => {
  const h = await createHarness();
  const errors: unknown[][] = [];
  const log = console.error;
  let engine: Engine | undefined;
  try {
    const events: string[] = [];
    let t = 1_000_000,
      broken = true;
    const hour = 3_600_000;
    engine = await Engine.create(h.namespace, {
      plans: {
        firstAfterMs: 0,
        everyMs: hour,
        now: () => t,
        due: async () => ["org-a", "org-b"],
        charge: async (_pool, id) => {
          events.push("charge " + id);
          if (id === "org-a") throw Error("LOCK_TIMEOUT");
        },
        notify: async (_pool, namespace) => {
          events.push("notify " + (namespace === h.namespace ? "own namespace" : namespace));
          if (broken) throw Error("NOTICE_FAILED org-a");
        },
      },
    });
    console.error = (...args: unknown[]) => void errors.push(args);
    engine.lastTickAt = 0;
    await engine.tick();
    assert.ok(engine.lastTickAt > 0, "the tick ran to the end");
    // One organization failing to charge does not silence the others' emails.
    assert.deepEqual(events, ["charge org-a", "charge org-b", "notify own namespace"]);
    assert.deepEqual(
      errors.map((e) => e[0]),
      ["PLAN_NOTICE_RUN_FAILED", "PLAN_CHARGE_RUN_FAILED"],
    );
    assert.deepEqual(errors[0], ["PLAN_NOTICE_RUN_FAILED"], "a fixed code, no ids");
    assert.ok(!JSON.stringify(errors).includes("org-"), "no organization ids logged");
    broken = false;
    t += hour;
    await engine.tick();
    assert.deepEqual(events.slice(3), ["charge org-a", "charge org-b", "notify own namespace"]);
  } finally {
    console.error = log;
    await engine?.close();
    await h.close();
  }
});
