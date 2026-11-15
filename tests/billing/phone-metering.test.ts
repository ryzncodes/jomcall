// Usage metering and admission on real phone calls (billing design §13),
// against the local database, the fake telephony and a scripted model.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { phoneFixture } from "../helpers/phone.ts";
import { end, sentence } from "../helpers/voice-turn.ts";
import { adjustWallet, balanceSen, entitle, setBalance, usageEvents } from "../helpers/billing.ts";
import { recordUsage } from "../../packages/billing/src/usage.ts";
import { CallRepository } from "../../engine/src/agent/call-repository.ts";
import { listPendingUsage, retryUsage } from "../../scripts/billing/usage-admin.ts";
import { Engine } from "../../engine/src/engine.ts";
import { workerMode } from "../../packages/contracts/src/hosting.ts";

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
    // The caller's last turn started 60 s after the answer and finished
    // 70 s after it; then nothing. The bill stops at the end of that turn.
    await f.h.cleanup.query(
      "update app.call_turn set created_at=now()-interval '540 seconds',completed_at=now()-interval '530 seconds' where call_id=$1",
      [call.callId],
    );
    await f.h.cleanup.query("update app.call set token_expires_at=now()-interval '1 second' where id=$1", [call.callId]);
    await f.calls.maintain();
    await f.calls.maintain();
    const row = await f.row(call.callId);
    assert.equal(row.state, "ended");
    assert.equal(row.end_reason, "expired");
    assert.equal(row.usage_state, "billed");
    assert.ok(Math.abs(row.duration_seconds - 70) <= 2, String(row.duration_seconds));
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
      "select app_private.channel_admission($1,'phone',now(),'local')",
      "select app_private.call_bill($1)",
      "select app_private.whatsapp_window_bill($1)",
      "select app_private.queue_billing_notice($1,'local','phone','WALLET_EXHAUSTED')",
      "select app_private.billing_notice_payload($1,'local')",
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

// A plan with wallet credit but no period started yet: admission starts it.
async function planWithoutPeriod(f: F, org: string, plan = "growth") {
  await f.h.cleanup.query(
    "insert into app.org_plan(org_id,plan_code,anchor_date)values($1,$2,(now() at time zone 'Asia/Kuala_Lumpur')::date)",
    [org, plan],
  );
  await adjustWallet(f.h.cleanup, org, 100_000);
}
const notices = (f: F, org: string) =>
  f.h.cleanup.query("select count(*)::int n from app.billing_notice where org_id=$1", [org]).then((r) => r.rows[0].n);
const periodCount = (f: F, org: string) =>
  f.h.cleanup.query("select count(*)::int n from app.plan_period where org_id=$1", [org]).then((r) => r.rows[0].n);
// Marks an answered call as ended and owed with chosen times, as a call_end
// whose bill did not land would leave it, then bills it the way maintenance does.
async function billCall(f: F, callId: string, answeredAt: string, seconds: number) {
  await f.h.cleanup.query(
    `update app.call set state='ended',end_reason='hangup',outcome='answered',token_hash=null,usage_state='pending',
      answered_at=$2::timestamptz,duration_seconds=$3::int,ended_at=$2::timestamptz+$3::int*interval '1 second' where id=$1`,
    [callId, answeredAt, seconds],
  );
  return (await f.h.cleanup.query("select app_private.call_bill($1) s", [callId])).rows[0].s;
}

test("a lost answer report: the caller's first turn counts as the answer, and the call is billed", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    await noAllowance(f, f.h.orgA.id);
    const { result } = await f.ring(await f.addNumber());
    const call = result as Live;
    // The worker's /answered request never arrived; the caller speaks.
    await f.turn(call, "Hello", f.scripted([sentence("Hello."), end("Hello.")]).model);
    let row = await f.row(call.callId);
    assert.ok(row.answered_at, "set by the first turn");
    assert.equal(row.disclosure_played_at, null, "the disclosure record is left alone");
    const turn = (await f.h.cleanup.query("select created_at from app.call_turn where call_id=$1", [call.callId])).rows[0];
    assert.ok(Math.abs(row.answered_at - turn.created_at) < 1000);
    // 50 s of conversation later the caller hangs up.
    await f.h.cleanup.query("update app.call set answered_at=answered_at-interval '50 seconds' where id=$1", [call.callId]);
    await f.calls.end(call.callId, sha(call.token), { reason: "hangup" });
    row = await f.row(call.callId);
    assert.deepEqual([row.outcome, row.usage_state], ["answered", "billed"]);
    assert.ok(row.billed_seconds >= 50 && row.billed_seconds <= 52, String(row.billed_seconds));
    assert.equal((await voiceEvents(f))[0].amount_sen, Math.ceil((row.billed_seconds * 32) / 60));

    // An older row with turns but no answer time is still billed.
    const legacy = (await f.ring(await f.addNumber())).result as Live;
    await f.turn(legacy, "Hai", f.scripted([sentence("Hai."), end("Hai.")]).model);
    await f.h.cleanup.query(
      `update app.call set state='ended',token_hash=null,usage_state='pending',answered_at=null,duration_seconds=30,ended_at=now() where id=$1`,
      [legacy.callId],
    );
    assert.equal((await f.h.cleanup.query("select app_private.call_bill($1) s", [legacy.callId])).rows[0].s, "billed");
  } finally {
    await f.close();
  }
});

test("a call refused for its configuration starts no plan period and debits nothing", async () => {
  const f = await phoneFixture({ entitled: false });
  try {
    const org = f.h.orgA.id;
    await planWithoutPeriod(f, org);
    const before = await balanceSen(f.h.cleanup, org);
    const dialled = await f.addNumber();
    assert.equal((await f.ring(dialled)).result.refusal, "AGENT_UNPUBLISHED");
    assert.equal(await periodCount(f, org), 0, "no period started");
    assert.equal(await balanceSen(f.h.cleanup, org), before, "no fee debited");
    // Configured: the first admitted call starts the period and pays the fee.
    await f.publish();
    assert.equal((await f.ring(dialled)).result.refusal, null);
    assert.equal(await periodCount(f, org), 1);
    assert.equal(await balanceSen(f.h.cleanup, org), before - 12_900);
  } finally {
    await f.close();
  }
});

test("a billing fault: the call is answered anyway and marked BILLING_CHECK_FAILED (owner decision A)", async () => {
  const f = await phoneFixture({ entitled: false });
  const trigger = "test_fail_period_" + randomUUID().replaceAll("-", "");
  try {
    const org = f.h.orgA.id;
    await f.publish();
    await planWithoutPeriod(f, org);
    // Starting this organization's plan period fails (as a database fault would).
    await f.h.cleanup.query(
      `create function public.${trigger}()returns trigger language plpgsql as $$begin
        if new.org_id='${org}'::uuid then raise exception 'INJECTED_FAULT';end if;return new;end$$`,
    );
    await f.h.cleanup.query(`create trigger ${trigger} before insert on app.plan_period for each row execute function public.${trigger}()`);
    const dialled = await f.addNumber();
    const call = (await f.ring(dialled)).result as Live;
    assert.equal((call as any).refusal, null, "answered, not refused");
    const row = await f.row(call.callId);
    assert.deepEqual([row.state, row.refusal, row.billing_check], ["active", null, "BILLING_CHECK_FAILED"]);
    // It is still metered at the end.
    await f.calls.answered(call.callId, sha(call.token));
    await f.h.cleanup.query("update app.call set answered_at=now()-interval '20 seconds' where id=$1", [call.callId]);
    await f.calls.end(call.callId, sha(call.token), { reason: "hangup" });
    assert.equal((await f.row(call.callId)).usage_state, "billed");
    // No owner email for a failed check; operators find it in usage-pending.
    assert.equal(await notices(f, org), 0);
    const db = await f.h.cleanup.connect();
    try {
      assert.ok((await listPendingUsage(db, 10_000)).some((r) => r.id === call.callId && r.kind === "call_check_failed"));
    } finally {
      db.release();
    }
    await f.h.cleanup.query(`drop trigger ${trigger} on app.plan_period`);
    const next = await f.ring(dialled);
    assert.equal(next.result.refusal, null);
    assert.equal((await f.row(next.result.callId!)).billing_check, null, "a clean check leaves no mark");
  } finally {
    await f.h.cleanup.query(`drop trigger if exists ${trigger} on app.plan_period`);
    await f.h.cleanup.query(`drop function if exists public.${trigger}()`);
    await f.close();
  }
});

test("a call that runs across a plan period boundary uses the period it was answered in", async () => {
  const f = await phoneFixture();
  try {
    const org = f.h.orgA.id;
    await f.publish();
    const call = await answeredCall(f, await f.addNumber(), 10);
    const current = (await f.h.cleanup.query("select * from app.plan_period where org_id=$1", [org])).rows[0];
    // The previous period was paid; the current one has no allowance left.
    await f.h.cleanup.query("select app_private.charge_plan_period($1,$2::timestamptz-interval '1 day')", [org, current.starts_at]);
    const previous = (
      await f.h.cleanup.query("select * from app.plan_period where org_id=$1 and ends_at=$2", [org, current.starts_at])
    ).rows[0];
    assert.equal(previous.state, "charged");
    await f.h.cleanup.query("update app.plan_period set included_voice_seconds=0 where id=$1", [current.id]);
    // Answered at 23:55, ended at 00:05 Kuala Lumpur time on the anchor day.
    const answered = new Date(current.starts_at.getTime() - 300_000).toISOString();
    assert.equal(await billCall(f, call.callId, answered, 600), "billed");
    const [event] = await voiceEvents(f);
    assert.equal(event.period_id, previous.id);
    assert.deepEqual([event.included_seconds, event.amount_sen], [600, 0]);
    assert.equal(new Date(event.occurred_at).toISOString(), answered);
  } finally {
    await f.close();
  }
});

test("a call answered before a price change is priced at the price in force at the answer", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const call = await answeredCall(f, await f.addNumber(), 10);
    const prices = (
      await f.h.cleanup.query("select id,version,effective_from from app.billing_price where kind='voice_second' order by version")
    ).rows;
    assert.ok(prices.length >= 2, "two price versions");
    const [older, newer] = prices.slice(-2);
    // Answered a minute before the newer price took effect, ended after it.
    const answered = new Date(newer.effective_from.getTime() - 60_000).toISOString();
    assert.equal(await billCall(f, call.callId, answered, 600), "billed");
    const [event] = await voiceEvents(f);
    assert.equal(event.price_id, older.id);
  } finally {
    await f.close();
  }
});

test("races: two ends, or an end and maintenance, bill a call once", async () => {
  const f = await phoneFixture();
  const other = new CallRepository(f.h.namespace);
  try {
    await f.publish();
    await noAllowance(f, f.h.orgA.id);
    const dialled = await f.addNumber();
    // Two end reports at once, on separate connections.
    const a = await answeredCall(f, dialled, 30);
    const ends = await Promise.allSettled([
      f.calls.end(a.callId, sha(a.token), { reason: "hangup" }),
      other.end(a.callId, sha(a.token), { reason: "hangup" }),
    ]);
    assert.deepEqual(ends.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    // An end and a maintenance pass at once.
    const b = await answeredCall(f, dialled, 30);
    await Promise.all([f.calls.end(b.callId, sha(b.token), { reason: "hangup" }), other.maintain()]);
    // An expired call: the late end and maintenance at once.
    const c = await answeredCall(f, dialled, 30);
    await f.turn(c, "Hello", f.scripted([sentence("Hello."), end("Hello.")]).model);
    await f.h.cleanup.query("update app.call set token_expires_at=now()-interval '1 second' where id=$1", [c.callId]);
    await Promise.allSettled([f.calls.end(c.callId, sha(c.token), { reason: "hangup" }), other.maintain()]);
    for (const call of [a, b, c]) {
      const row = await f.row(call.callId);
      assert.deepEqual([row.state, row.usage_state], ["ended", "billed"], call.callId);
      const events = (await voiceEvents(f)).filter((e) => e.idempotency_key === "call:" + call.callId);
      assert.equal(events.length, 1, call.callId);
    }
  } finally {
    await other.close();
    await f.close();
  }
});

test("operators list stuck bills and retry one past the 20-attempt cap", async () => {
  const f = await phoneFixture();
  const db = await f.h.cleanup.connect();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    // A bill that cannot land: its key is taken with another quantity.
    const stuck = await answeredCall(f, dialled, 30);
    const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 1 });
    try {
      await recordUsage(worker, { orgId: f.h.orgA.id, kind: "voice_second", quantity: 1, idempotencyKey: "call:" + stuck.callId });
    } finally {
      await worker.end();
    }
    await f.calls.end(stuck.callId, sha(stuck.token), { reason: "hangup" });
    await f.h.cleanup.query("update app.call set usage_attempts=20 where id=$1", [stuck.callId]);
    await f.calls.maintain();
    assert.equal((await f.row(stuck.callId)).usage_attempts, 20, "maintenance has stopped retrying it");
    const listed = (await listPendingUsage(db, 10_000)).find((r) => r.id === stuck.callId);
    assert.deepEqual(
      listed && { kind: listed.kind, orgId: listed.orgId, attempts: listed.attempts, stuck: listed.stuck },
      { kind: "call", orgId: f.h.orgA.id, attempts: 20, stuck: true },
    );
    assert.deepEqual(Object.keys(listed!).sort(), ["attempts", "id", "kind", "namespace", "orgId", "since", "stuck"]);
    assert.deepEqual(await retryUsage(db, stuck.callId), { kind: "call", state: "pending", error: "CONFLICT" });
    assert.equal((await f.row(stuck.callId)).usage_attempts, 21, "the failed retry is counted");

    // A stuck bill whose cause is gone lands on retry.
    const owed = await answeredCall(f, dialled, 30);
    await f.h.cleanup.query(
      `update app.call set state='ended',end_reason='hangup',outcome='answered',ended_at=now(),token_hash=null,
        duration_seconds=30,usage_state='pending',usage_attempts=20 where id=$1`,
      [owed.callId],
    );
    assert.deepEqual(await retryUsage(db, owed.callId), { kind: "call", state: "billed" });
    assert.equal((await f.row(owed.callId)).billed_seconds, 30);
    await assert.rejects(retryUsage(db, owed.callId), /NOT_PENDING/);
  } finally {
    db.release();
    await f.close();
  }
});

test("the web role cannot read the billing columns on calls and conversations", async () => {
  const web = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
  try {
    for (const sql of [
      "select usage_state from app.call",
      "select billed_seconds from app.call",
      "select usage_event_id from app.call",
      "select * from app.call",
      "select billing_check from app.call",
      "select * from app.whatsapp_usage_window",
      "select * from app.billing_notice",
    ])
      await assert.rejects(web.query(sql + " limit 0"), /permission denied/, sql);
    await web.query("select id,state,outcome,duration_seconds,refusal from app.call limit 0");
    await web.query("select * from app.conversation limit 0");
  } finally {
    await web.end();
  }
});

test("an exhausted wallet with paid minutes left: calls are answered and billed from the allowance; once used up, refused (owner decision B)", async () => {
  const f = await phoneFixture();
  try {
    const org = f.h.orgA.id;
    await f.publish();
    const dialled = await f.addNumber();
    // Growth is paid for this period (400 minutes, none used); the wallet is at the exhausted threshold.
    await setBalance(f.h.cleanup, org, -500);
    const call = (await f.ring(dialled)).result as Live;
    assert.equal((call as any).refusal, null, "answered from the paid allowance");
    await f.calls.answered(call.callId, sha(call.token));
    await f.h.cleanup.query("update app.call set answered_at=now()-interval '90 seconds' where id=$1", [call.callId]);
    await f.calls.end(call.callId, sha(call.token), { reason: "hangup" });
    const [event] = await voiceEvents(f);
    assert.equal(event.amount_sen, 0, "billed 0");
    assert.equal(event.included_seconds, event.quantity);
    assert.equal(await balanceSen(f.h.cleanup, org), -500);
    // Allowance used up: the wallet decides again.
    await noAllowance(f, org);
    assert.equal((await f.ring(dialled)).result.refusal, "WALLET_EXHAUSTED");
  } finally {
    await f.close();
  }
});

test("a plan or wallet refusal queues one owner email per reason per day; none for configuration refusals (owner decision C)", async () => {
  const f = await phoneFixture({ entitled: false });
  try {
    const org = f.h.orgA.id;
    const dialled = await f.addNumber();
    // A configuration refusal: no email.
    assert.equal((await f.ring(dialled)).result.refusal, "AGENT_UNPUBLISHED");
    assert.equal(await notices(f, org), 0);
    await f.publish();
    // Many refusals for the same reason in a day: one email.
    for (let i = 0; i < 4; i++) assert.equal((await f.ring(dialled)).result.refusal, "NO_PHONE_ENTITLEMENT");
    const rows = (
      await f.h.cleanup.query("select channel,reason,kl_day::text,delivery_state from app.billing_notice where org_id=$1", [org])
    ).rows;
    const today = (await f.h.cleanup.query("select (now() at time zone 'Asia/Kuala_Lumpur')::date::text d")).rows[0].d;
    assert.deepEqual(rows, [{ channel: "phone", reason: "NO_PHONE_ENTITLEMENT", kl_day: today, delivery_state: "pending" }]);
    const outbox = (
      await f.h.cleanup.query("select kind,namespace from app.outbox where org_id=$1 and kind='billing.refusal_notice'", [org])
    ).rows;
    assert.deepEqual(outbox, [{ kind: "billing.refusal_notice", namespace: f.h.namespace }]);
    // Another reason the same day: a second email.
    await entitle(f.h.cleanup, org);
    await noAllowance(f, org);
    await setBalance(f.h.cleanup, org, -600);
    for (let i = 0; i < 3; i++) assert.equal((await f.ring(dialled)).result.refusal, "WALLET_EXHAUSTED");
    assert.equal(await notices(f, org), 2);
  } finally {
    await f.close();
  }
});

test("the engine sends the refusal email to the owner, in English and Bahasa Melayu, with no caller details; never in mock mode", async () => {
  const f = await phoneFixture({ entitled: false });
  let engine: Engine | undefined;
  try {
    const org = f.h.orgA.id;
    await f.publish();
    const dialled = await f.addNumber();
    const caller = "+60119876543";
    assert.equal((await f.ring(dialled, caller)).result.refusal, "NO_PHONE_ENTITLEMENT");
    // Mock mode has no worker: nothing would ever send the queued email.
    assert.throws(() => workerMode({ JOMCALL_MODE: "mock" }), /LOCAL_ONLY/);
    assert.throws(() => workerMode({}), /LOCAL_ONLY/);
    engine = await Engine.create(f.h.namespace);
    await engine.tick();
    await engine.tick();
    const state = (await f.h.cleanup.query("select delivery_state from app.billing_notice where org_id=$1", [org])).rows[0];
    assert.equal(state.delivery_state, "sent");
    const owner = f.h.alice.confirmedEmail;
    const list = await (await fetch("http://127.0.0.1:54624/api/v1/messages?limit=200")).json();
    const mine = list.messages.filter(
      (m: { To: { Address: string }[]; Subject: string }) =>
        m.To.some((t) => t.Address === owner) && m.Subject === "JomCall: action needed / tindakan diperlukan",
    );
    assert.equal(mine.length, 1);
    const mail = await (await fetch("http://127.0.0.1:54624/api/v1/message/" + mine[0].ID)).json();
    assert.match(mail.Text, /Phone calls to your JomCall number are not being answered because your plan does not include a phone number/);
    assert.match(mail.Text, /Panggilan ke nombor JomCall anda tidak dijawab kerana pelan anda tidak termasuk nombor telefon/);
    assert.match(mail.Text, /\/app\/billing/);
    assert.doesNotMatch(mail.Text, /60119876543|\+6011/);
  } finally {
    await engine?.close();
    await f.close();
  }
});
