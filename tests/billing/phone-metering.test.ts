// Usage metering and admission on real phone calls (billing design §13),
// against the local database, the fake telephony and a scripted model.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { phoneFixture } from "../helpers/phone.ts";
import { end, sentence } from "../helpers/voice-turn.ts";
import { balanceSen, entitle, setBalance, usageEvents } from "../helpers/billing.ts";
import { recordUsage } from "../../packages/billing/src/usage.ts";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
type F = Awaited<ReturnType<typeof phoneFixture>>;
type Live = { callId: string; token: string };

// A call that was answered `seconds` ago.
async function answeredCall(f: F, dialled: string, seconds: number): Promise<Live> {
  const { result } = await f.ring(dialled);
  assert.equal(result.refusal, null, "call admitted");
  const call = result as Live;
  await f.calls.answered(call.callId, sha(call.token));
  await f.h.cleanup.query(
    "update app.call set answered_at=now()-$2*interval '1 second' where id=$1",
    [call.callId, seconds],
  );
  return call;
}
// No allowance left this period, so seconds are billed from the wallet.
const noAllowance = (f: F, org: string) =>
  f.h.cleanup.query("update app.plan_period set included_voice_seconds=0 where org_id=$1", [org]);
const voiceEvents = (f: F, org = f.h.orgA.id) => usageEvents(f.h.cleanup, org, "voice_second");

test("a call is billed once when it ends; the seconds are the call row's", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    await noAllowance(f, f.h.orgA.id);
    const before = await balanceSen(f.h.cleanup, f.h.orgA.id);
    const call = await answeredCall(f, await f.addNumber(), 95);
    await f.calls.end(call.callId, sha(call.token), { reason: "hangup" });
    const row = await f.row(call.callId);
    assert.equal(row.usage_state, "billed");
    assert.ok(row.duration_seconds >= 95 && row.duration_seconds <= 97, String(row.duration_seconds));
    assert.equal(row.billed_seconds, row.duration_seconds);
    const events = await voiceEvents(f);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, row.usage_event_id);
    assert.equal(events[0].quantity, row.duration_seconds);
    assert.equal(events[0].idempotency_key, "call:" + call.callId);
    // RM0.32 a minute, billed per second, rounded up to the sen.
    const amount = Math.ceil((row.duration_seconds * 32) / 60);
    assert.equal(events[0].amount_sen, amount);
    assert.equal(await balanceSen(f.h.cleanup, f.h.orgA.id), before - amount);

    // A duplicate end event: the token is gone, nothing more is billed.
    await assert.rejects(
      f.calls.end(call.callId, sha(call.token), { reason: "hangup" }),
      /VOICE_UNAUTHORIZED/,
    );
    // A replay of the same key through recordUsage returns the first bill.
    const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 1 });
    try {
      const again = await recordUsage(worker, {
        orgId: f.h.orgA.id,
        kind: "voice_second",
        quantity: row.duration_seconds,
        idempotencyKey: "call:" + call.callId,
      });
      assert.equal(again.duplicate, true);
      assert.equal(again.usageEventId, row.usage_event_id);
    } finally {
      await worker.end();
    }
    assert.equal((await voiceEvents(f)).length, 1);
    assert.equal(await balanceSen(f.h.cleanup, f.h.orgA.id), before - amount);
  } finally {
    await f.close();
  }
});

test("a transferred call is billed; the plan allowance is used first", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const before = await balanceSen(f.h.cleanup, f.h.orgA.id);
    const call = await answeredCall(f, await f.addNumber({ transfer: "+60312345678" }), 40);
    await f.calls.end(call.callId, sha(call.token), { reason: "transferred" });
    const [event] = await voiceEvents(f);
    assert.equal(event.quantity, (await f.row(call.callId)).duration_seconds);
    assert.equal(event.included_seconds, event.quantity, "drawn from Growth's 400 minutes");
    assert.equal(event.amount_sen, 0);
    assert.equal(await balanceSen(f.h.cleanup, f.h.orgA.id), before);
  } finally {
    await f.close();
  }
});

test("unanswered and refused calls are not billed", async () => {
  const f = await phoneFixture();
  try {
    const dialled = await f.addNumber();
    // Refused: no published agent.
    const refused = (await f.ring(dialled)).result;
    assert.equal(refused.refusal, "AGENT_UNPUBLISHED");
    await f.publish();
    // Ended before the worker answered.
    const { result } = await f.ring(dialled);
    const call = result as Live;
    await f.calls.end(call.callId, sha(call.token), { reason: "hangup" });
    assert.equal((await f.row(call.callId)).usage_state, "free");
    assert.equal((await f.row(refused.callId!)).usage_state, null);
    assert.equal((await voiceEvents(f)).length, 0);
  } finally {
    await f.close();
  }
});

test("a crashed worker: maintenance ends the call and bills it once, up to the last turn", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const call = await answeredCall(f, await f.addNumber(), 600);
    await f.turn(call, "Hello", f.scripted([sentence("Hello."), end("Hello.")]).model);
    // The caller's last words were 60 s after the answer; then nothing.
    await f.h.cleanup.query(
      "update app.call_turn set created_at=now()-interval '540 seconds' where call_id=$1",
      [call.callId],
    );
    await f.h.cleanup.query("update app.call set token_expires_at=now()-interval '1 second' where id=$1", [call.callId]);
    await f.calls.maintain();
    await f.calls.maintain();
    const row = await f.row(call.callId);
    assert.equal(row.state, "ended");
    assert.equal(row.end_reason, "expired");
    assert.equal(row.usage_state, "billed");
    assert.ok(Math.abs(row.duration_seconds - 60) <= 2, String(row.duration_seconds));
    const events = await voiceEvents(f);
    assert.equal(events.length, 1);
    assert.equal(events[0].quantity, row.duration_seconds);
    // The worker's late end after recovery is refused and bills nothing.
    await assert.rejects(f.calls.end(call.callId, sha(call.token), { reason: "hangup" }), /VOICE_/);
    assert.equal((await voiceEvents(f)).length, 1);
  } finally {
    await f.close();
  }
});

test("a call ended but not yet billed is billed by maintenance, once", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    // 1. Billing fails at the end (here: the key is already taken with
    //    another quantity). The call still ends, and stays owed.
    const failing = await answeredCall(f, dialled, 30);
    const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 1 });
    try {
      await recordUsage(worker, {
        orgId: f.h.orgA.id,
        kind: "voice_second",
        quantity: 1,
        idempotencyKey: "call:" + failing.callId,
      });
    } finally {
      await worker.end();
    }
    await f.calls.end(failing.callId, sha(failing.token), { reason: "hangup" });
    let row = await f.row(failing.callId);
    assert.equal(row.state, "ended", "billing never blocks the end of a call");
    assert.equal(row.usage_state, "pending");
    assert.equal(row.usage_attempts, 1);
    await f.calls.maintain();
    row = await f.row(failing.callId);
    assert.equal(row.usage_state, "pending", "retried, still owed");
    assert.equal(row.usage_attempts, 2, "each failed attempt is counted; maintenance stops after 20");

    // 2. A crash between the end and the bill (the end committed, the bill
    //    did not): maintenance bills it, and a second pass adds nothing.
    const crashed = await answeredCall(f, dialled, 42);
    await f.h.cleanup.query(
      `update app.call set state='ended',end_reason='hangup',outcome='answered',ended_at=now(),token_hash=null,
        duration_seconds=42,usage_state='pending' where id=$1`,
      [crashed.callId],
    );
    await f.calls.maintain();
    await f.calls.maintain();
    row = await f.row(crashed.callId);
    assert.equal(row.usage_state, "billed");
    assert.equal(row.billed_seconds, 42);
    const events = (await voiceEvents(f)).filter((e) => e.idempotency_key === "call:" + crashed.callId);
    assert.equal(events.length, 1);
    assert.equal(events[0].quantity, 42);
  } finally {
    await f.close();
  }
});

test("a call in progress is never cut off when the wallet runs out", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    await noAllowance(f, f.h.orgA.id);
    const dialled = await f.addNumber();
    const call = await answeredCall(f, dialled, 120);
    await setBalance(f.h.cleanup, f.h.orgA.id, -600);
    const events = await f.turn(call, "Masih ada?", f.scripted([sentence("Ya, masih."), end("Ya, masih.")]).model);
    assert.ok(events.some((e) => e.type === "sentence"), JSON.stringify(events));
    await f.calls.end(call.callId, sha(call.token), { reason: "hangup" });
    assert.equal((await f.row(call.callId)).usage_state, "billed");
    assert.ok((await balanceSen(f.h.cleanup, f.h.orgA.id)) < -600, "billed below zero");
    // The next call is refused.
    const next = (await f.ring(dialled)).result;
    assert.deepEqual([next.refusal, "busyLine" in next && next.busyLine], ["WALLET_EXHAUSTED", false]);
  } finally {
    await f.close();
  }
});

test("admission: plan without a number, unfunded, grace and exhausted wallets", async () => {
  const f = await phoneFixture({ entitled: false });
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const org = f.h.orgA.id;
    // No plan chosen: pay as you go has no phone number. Silent refusal.
    const payg = (await f.ring(dialled)).result;
    assert.deepEqual(payg, { callId: payg.callId, refusal: "NO_PHONE_ENTITLEMENT", busyLine: false });
    const row = await f.row(payg.callId!);
    assert.deepEqual([row.state, row.refusal, row.outcome], ["refused", "NO_PHONE_ENTITLEMENT", "refused"]);
    // A Starter plan whose fee is not paid yet keeps its number in grace,
    // but the wallet has never been funded.
    const period = await entitle(f.h.cleanup, org, { plan: "starter", creditSen: 0 });
    assert.equal(period.periodState, "unpaid");
    assert.equal((await f.ring(dialled)).result.refusal, "WALLET_UNFUNDED");
    // Grace (down to -RM4.99) is still answered.
    await setBalance(f.h.cleanup, org, -499);
    assert.equal((await f.ring(dialled)).result.refusal, null);
    // RM5 below zero is exhausted.
    await setBalance(f.h.cleanup, org, -500);
    assert.equal((await f.ring(dialled)).result.refusal, "WALLET_EXHAUSTED");
    // A top-up lets admission charge the fee: the period is paid and calls resume.
    await setBalance(f.h.cleanup, org, 10_000);
    assert.equal((await f.ring(dialled)).result.refusal, null);
    const state = (await f.h.cleanup.query("select state from app.plan_period where org_id=$1", [org])).rows[0].state;
    assert.equal(state, "charged");
    // Refused calls are never billed.
    assert.equal((await voiceEvents(f)).length, 0);
  } finally {
    await f.close();
  }
});

test("the agent role cannot bill an organization or read its wallet directly", async () => {
  const f = await phoneFixture();
  const agent = new pg.Pool({ connectionString: process.env.AGENT_DATABASE_URL, max: 1 });
  try {
    for (const sql of [
      "select app_private.record_usage($1,'voice_second',60,'forged-call-usage')",
      "select app_private.wallet_state($1)",
      "select app_private.plan_entitlements($1)",
      "select app_private.charge_plan_period($1)",
      "select app_private.channel_admission($1,'phone',now())",
      "select app_private.call_bill($1)",
      "select app_private.conversation_bill($1)",
    ])
      await assert.rejects(agent.query(sql, [f.h.orgA.id]), /permission denied/, sql);
  } finally {
    await agent.end();
    await f.close();
  }
});

test("the agent's clock never chooses the plan period that is charged or checked", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const periods = () =>
      f.h.cleanup.query("select count(*)::int n from app.plan_period where org_id=$1", [f.h.orgA.id]).then((r) => r.rows[0].n);
    assert.equal(await periods(), 1);
    // Two years ahead: a period that would need a new fee, and past any grace.
    f.setClock(Date.now() + 2 * 365 * 86_400_000);
    assert.equal((await f.ring(dialled)).result.refusal, null);
    assert.equal(await periods(), 1, "no period was created for the agent's date");
  } finally {
    await f.close();
  }
});

test("maintenance: an unanswered expired call and an answered call with no turns are free", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const unanswered = (await f.ring(dialled)).result as Live;
    const silent = await answeredCall(f, dialled, 300);
    await f.h.cleanup.query("update app.call set token_expires_at=now()-interval '1 second' where id=any($1)", [
      [unanswered.callId, silent.callId],
    ]);
    await f.calls.maintain();
    for (const id of [unanswered.callId, silent.callId]) {
      const row = await f.row(id);
      assert.deepEqual([row.state, row.usage_state], ["ended", "free"]);
    }
    assert.equal((await f.row(silent.callId)).duration_seconds, 0);
    assert.equal((await voiceEvents(f)).length, 0);
  } finally {
    await f.close();
  }
});
