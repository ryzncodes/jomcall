// A held wallet lock must not stall call starts (billing design §13):
// channel_admission gives up after its lock_timeout, and the call is
// answered and marked BILLING_CHECK_FAILED (owner decision A), or answered
// normally when the plan and wallet can still be read.
import test from "node:test";
import assert from "node:assert/strict";
import { phoneFixture } from "../helpers/phone.ts";

type F = Awaited<ReturnType<typeof phoneFixture>>;
const HELD_MS = 6000; // far longer than the 500 ms admission timeout
const BOUND_MS = 3000; // the timeout plus generous slack for a loaded machine

// Holds orgA's wallet lock on its own connection, as a long maintenance pass
// or a top-up would, until release() or HELD_MS.
async function holdWallet(f: F, org: string) {
  const c = await f.h.cleanup.connect();
  await c.query("begin");
  await c.query("select pg_advisory_xact_lock(hashtextextended('wallet:'||$1::text,0))", [org]);
  let done = false;
  const release = async () => {
    if (done) return;
    done = true;
    await c.query("rollback").catch(() => {});
    c.release();
  };
  const timer = setTimeout(release, HELD_MS);
  return async () => {
    clearTimeout(timer);
    await release();
  };
}

const timed = async <T>(p: Promise<T>) => {
  const t = Date.now();
  const v = await p;
  return { v, ms: Date.now() - t };
};

test("a held wallet lock: a call whose period is due is answered and marked BILLING_CHECK_FAILED within the timeout; another organization is not held up", async () => {
  const f = await phoneFixture();
  let release = async () => {};
  try {
    await f.publish();
    const org = f.h.orgA.id;
    // A new plan period is due, so admission must charge it (and take the lock).
    await f.h.cleanup.query("delete from app.plan_period where org_id=$1", [org]);
    const dialled = await f.addNumber();
    const other = await f.addNumber({ org: "B" });
    release = await holdWallet(f, org);
    const a = timed(f.ring(dialled));
    await new Promise((r) => setTimeout(r, 50));
    const b = timed(f.ring(other));
    const [ra, rb] = await Promise.all([a, b]);
    assert.ok(ra.ms < BOUND_MS, `call start took ${ra.ms} ms`);
    assert.ok(rb.ms < BOUND_MS, `the other organization's call start took ${rb.ms} ms`);
    const call = ra.v.result as { callId: string; refusal: string | null };
    assert.equal(call.refusal, null, "answered (fail open)");
    const row = await f.row(call.callId);
    assert.deepEqual([row.state, row.billing_check], ["active", "BILLING_CHECK_FAILED"]);
    // The other organization got its own answer (its agent is not published),
    // decided without waiting on orgA's wallet.
    assert.equal((rb.v.result as { refusal: string }).refusal, "AGENT_UNPUBLISHED");
    // No owner email for a failed check.
    const n = await f.h.cleanup.query("select count(*)::int n from app.billing_notice where org_id=$1", [org]);
    assert.equal(n.rows[0].n, 0);
  } finally {
    await release();
    await f.close();
  }
});

test("a held wallet lock with the period already charged: the call is answered normally from the plan and wallet it can still read", async () => {
  const f = await phoneFixture();
  let release = async () => {};
  try {
    await f.publish();
    const dialled = await f.addNumber();
    release = await holdWallet(f, f.h.orgA.id);
    const { v, ms } = await timed(f.ring(dialled));
    assert.ok(ms < BOUND_MS, `call start took ${ms} ms`);
    const call = v.result as { callId: string; refusal: string | null };
    assert.equal(call.refusal, null);
    assert.equal((await f.row(call.callId)).billing_check, null);
  } finally {
    await release();
    await f.close();
  }
});

test("the admission timeout is scoped to channel_admission only", async () => {
  const f = await phoneFixture();
  try {
    const conf = await f.h.cleanup.query(
      `select p.oid::regprocedure::text fn,p.proconfig from pg_proc p join pg_namespace s on s.oid=p.pronamespace
       where s.nspname='app_private' and p.proname in('channel_admission','agent_call','whatsapp_work','charge_plan_period')`,
    );
    for (const r of conf.rows) {
      const has = (r.proconfig ?? []).some((c: string) => c.startsWith("lock_timeout="));
      assert.equal(has, r.fn.startsWith("app_private.channel_admission"), r.fn);
    }
  } finally {
    await f.close();
  }
});
