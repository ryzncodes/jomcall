// The call summary queue in the database (app.call_summary): the trigger that
// queues one row when an answered call ends, the worker function's claim,
// write, fail and maintain actions, and who may read or edit. Local database
// only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Identity = Harness["alice"];

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const fakePhone = () => "+6011555" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");

// A live phone call for a fake caller.
async function liveCall(h: Harness) {
  const contactId = (
    await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,'Caller Contoh',$2)returning id", [h.orgA.id, fakePhone()])
  ).rows[0].id as string;
  const callId = (
    await h.cleanup.query(
      `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,caller_e164,contact_id,sip_call_id,room,participant_identity,token_hash)
       values($1,$2,$3,$4,'{}','+60115550190','+60115550191',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',$6)returning id`,
      [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, contactId, sha("token-" + randomUUID())],
    )
  ).rows[0].id as string;
  return { callId, contactId };
}

const addTurn = async (h: Harness, callId: string, input: string, state: "completed" | "running", answer: string | null, ageMs = 0) =>
  (
    await h.cleanup.query(
      `insert into app.call_turn(org_id,call_id,client_turn_id,input,answer,state,created_at)
       values($1,$2,$3,$4,$5,$6,now()-($7||' milliseconds')::interval)returning id`,
      [h.orgA.id, callId, randomUUID(), input, answer, state, String(ageMs)],
    )
  ).rows[0].id as string;

const answer = (h: Harness, callId: string) => h.cleanup.query("update app.call set answered_at=now() where id=$1", [callId]);
const endCall = (h: Harness, callId: string, seconds = 40, reason = "hangup") =>
  h.cleanup.query("update app.call set state='ended',ended_at=now(),duration_seconds=$2,end_reason=$3 where id=$1", [callId, seconds, reason]);
const summaries = (h: Harness, callId: string) => h.cleanup.query("select * from app.call_summary where call_id=$1", [callId]).then((r) => r.rows);

// An ended, answered call with two completed turns lasting 40 seconds.
async function summarisedCall(h: Harness, turns = 2, seconds = 40) {
  const c = await liveCall(h);
  await answer(h, c.callId);
  for (let i = 0; i < turns; i++) await addTurn(h, c.callId, `Soalan ${i + 1}`, "completed", `Jawapan ${i + 1}`, (turns - i) * 1000);
  await endCall(h, c.callId, seconds);
  return c;
}

// Run the worker function as the agent process's login role.
async function worker<T = Record<string, unknown> | null>(h: Harness, action: string, id: string | null = null, lease: string | null = null, data: unknown = {}) {
  const pool = new pg.Pool({ connectionString: process.env.AGENT_DATABASE_URL, max: 1 });
  try {
    const r = await pool.query("select app_private.call_summary($1,$2,$3,$4,$5) as v", [action, h.namespace, id, lease, JSON.stringify(data)]);
    return r.rows[0].v as T;
  } finally {
    await pool.end();
  }
}
type Claim = { id: string; lease: string; attempt: number; call: Record<string, unknown>; turns: { input: string; answer: string }[]; proposals: string[] };

const asApp = <T>(h: Harness, who: Identity, org: string, sql: string, args: unknown[] = []) =>
  h.sqlAsApp(who, org, (tx) => tx.query(sql, args)).then((r) => ({ rows: r.rows as T[], count: r.rowCount ?? 0 }));

const fields = {
  reason_en: "Asked about opening hours.", reason_ms: "Tanya waktu operasi.",
  outcome_en: "Told the hours.", outcome_ms: "Diberitahu waktu.",
  next_step_en: "None.", next_step_ms: "Tiada.",
};

test("ending an answered call queues one pending summary", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    const rows = await summaries(h, c.callId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "pending");
    assert.equal(rows[0].org_id, h.orgA.id);
    assert.equal(rows[0].namespace, h.namespace);
    await h.cleanup.query("update app.call set state='ended',end_reason='again' where id=$1", [c.callId]);
    assert.equal((await summaries(h, c.callId)).length, 1);
  } finally {
    await h.close();
  }
});

test("unanswered and refused calls queue nothing", async () => {
  const h = await createHarness();
  try {
    const a = await liveCall(h);
    await endCall(h, a.callId, 30);
    assert.equal((await summaries(h, a.callId)).length, 0);
    const b = await liveCall(h);
    await h.cleanup.query("update app.call set state='refused',refusal='UNKNOWN_NUMBER' where id=$1", [b.callId]);
    assert.equal((await summaries(h, b.callId)).length, 0);
  } finally {
    await h.close();
  }
});

test("crash-ended call queues and counts only completed turns", async () => {
  const h = await createHarness();
  try {
    const c = await liveCall(h);
    await answer(h, c.callId);
    await addTurn(h, c.callId, "Satu", "completed", "Jawab satu", 2000);
    await addTurn(h, c.callId, "Dua", "running", null);
    await endCall(h, c.callId, 40, "expired");
    assert.equal((await summaries(h, c.callId))[0].state, "pending");
    assert.equal(await worker(h, "claim"), null);
    const [row] = await summaries(h, c.callId);
    assert.equal(row.state, "skipped");
    assert.equal(row.skip_reason, "TOO_SHORT");
  } finally {
    await h.close();
  }
});

test("claim skips short calls and returns the next", async () => {
  const h = await createHarness();
  try {
    const first = await summarisedCall(h, 1, 40);
    const second = await liveCall(h);
    await answer(h, second.callId);
    await endCall(h, second.callId, 40);
    const third = await summarisedCall(h, 2, 40);
    await h.cleanup.query("insert into app.call_proposal(org_id,call_id,turn_id,step,kind,details)select org_id,call_id,id,0,'message','{}' from app.call_turn where call_id=$1 limit 1", [third.callId]);
    // Order the queue: first, second, third.
    await h.cleanup.query("update app.call_summary set created_at=now()-interval '3 minutes' where call_id=$1", [first.callId]);
    await h.cleanup.query("update app.call_summary set created_at=now()-interval '2 minutes' where call_id=$1", [second.callId]);
    await h.cleanup.query("update app.call_summary set created_at=now()-interval '1 minute' where call_id=$1", [third.callId]);
    const claim = (await worker<Claim>(h, "claim"))!;
    assert.equal(claim.attempt, 1);
    assert.equal(claim.turns.length, 2);
    assert.deepEqual(claim.turns.map((t) => t.input), ["Soalan 1", "Soalan 2"]);
    assert.deepEqual(claim.turns.map((t) => t.answer), ["Jawapan 1", "Jawapan 2"]);
    assert.deepEqual(claim.proposals, ["message"]);
    assert.equal(claim.call.caller_e164, "+60115550191");
    const [r1] = await summaries(h, first.callId);
    assert.deepEqual([r1.state, r1.skip_reason], ["skipped", "TOO_SHORT"]);
    const [r2] = await summaries(h, second.callId);
    assert.deepEqual([r2.state, r2.skip_reason], ["skipped", "NO_TURNS"]);
    const [r3] = await summaries(h, third.callId);
    assert.equal(r3.state, "running");
    assert.equal(r3.lease_token, claim.lease);
  } finally {
    await h.close();
  }
});

test("a call under 15 seconds is skipped as too short", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h, 2, 10);
    assert.equal(await worker(h, "claim"), null);
    assert.equal((await summaries(h, c.callId))[0].skip_reason, "TOO_SHORT");
  } finally {
    await h.close();
  }
});

// One completed turn is enough when the call ended with something staff act
// on (transfer, handoff, message, booking request) and lasted 15 s or more.
async function oneTurnCall(h: Harness, outcome: string | null, seconds = 40) {
  const c = await liveCall(h);
  await answer(h, c.callId);
  await addTurn(h, c.callId, "Soalan satu", "completed", "Jawapan satu", 1000);
  await h.cleanup.query("update app.call set outcome=$2 where id=$1", [c.callId, outcome]);
  await endCall(h, c.callId, seconds);
  return c;
}

test("a one-turn call with a staff outcome is summarized", async () => {
  for (const outcome of ["transferred", "transfer_failed", "handoff", "message", "booking_proposed"]) {
    const h = await createHarness();
    try {
      const c = await oneTurnCall(h, outcome);
      const claim = (await worker<Claim>(h, "claim"))!;
      assert.ok(claim, outcome);
      assert.equal(claim.turns.length, 1);
      assert.equal(claim.call.outcome, outcome);
      assert.equal((await summaries(h, c.callId))[0].state, "running", outcome);
    } finally {
      await h.close();
    }
  }
});

test("a one-turn answered call is skipped as too short", async () => {
  const h = await createHarness();
  try {
    const c = await oneTurnCall(h, "answered");
    assert.equal(await worker(h, "claim"), null);
    assert.deepEqual(
      [(await summaries(h, c.callId))[0].state, (await summaries(h, c.callId))[0].skip_reason],
      ["skipped", "TOO_SHORT"],
    );
  } finally {
    await h.close();
  }
});

test("a one-turn transferred call under 15 seconds is skipped as too short", async () => {
  const h = await createHarness();
  try {
    const c = await oneTurnCall(h, "transferred", 10);
    assert.equal(await worker(h, "claim"), null);
    assert.equal((await summaries(h, c.callId))[0].skip_reason, "TOO_SHORT");
  } finally {
    await h.close();
  }
});

test("write needs the live lease", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    const claim = (await worker<Claim>(h, "claim"))!;
    assert.deepEqual(await worker(h, "write", claim.id, randomUUID(), { ...fields, model: "m" }), { ok: false });
    assert.equal((await summaries(h, c.callId))[0].state, "running");
    assert.deepEqual(await worker(h, "write", claim.id, claim.lease, { ...fields, model: "claude-test" }), { ok: true });
    const [row] = await summaries(h, c.callId);
    assert.equal(row.state, "done");
    assert.equal(row.reason_ms, fields.reason_ms);
    assert.equal(row.next_step_en, fields.next_step_en);
    assert.equal(row.model, "claude-test");
    assert.equal(row.revision, 2);
    assert.equal(row.lease_token, null);
    assert.ok(row.completed_at);
  } finally {
    await h.close();
  }
});

test("write accepts a null next step", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    const claim = (await worker<Claim>(h, "claim"))!;
    assert.deepEqual(await worker(h, "write", claim.id, claim.lease, { ...fields, next_step_en: null, next_step_ms: null, model: "m" }), { ok: true });
    const [row] = await summaries(h, c.callId);
    assert.equal(row.state, "done");
    assert.equal(row.next_step_en, null);
    assert.equal(row.next_step_ms, null);
  } finally {
    await h.close();
  }
});

test("write after lease lost changes nothing", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    const claim = (await worker<Claim>(h, "claim"))!;
    await h.cleanup.query("update app.call_summary set lease_until=now()-interval '1 second' where id=$1", [claim.id]);
    assert.equal(await worker(h, "maintain"), 1);
    assert.equal((await summaries(h, c.callId))[0].state, "pending");
    assert.deepEqual(await worker(h, "write", claim.id, claim.lease, { ...fields, model: "m" }), { ok: false });
    assert.equal((await summaries(h, c.callId))[0].state, "pending");
  } finally {
    await h.close();
  }
});

test("third failure is final", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    for (let i = 1; i <= 3; i++) {
      const claim = (await worker<Claim>(h, "claim"))!;
      assert.equal(claim.attempt, i);
      await worker(h, "fail", claim.id, claim.lease, { code: "MODEL_FAILED" });
      const [row] = await summaries(h, c.callId);
      assert.equal(row.state, i < 3 ? "pending" : "failed");
      assert.equal(row.error_code, "MODEL_FAILED");
      assert.equal(row.lease_token, null);
    }
    assert.equal(await worker(h, "claim"), null);
  } finally {
    await h.close();
  }
});

test("expired lease on the third attempt fails with LEASE_EXPIRED", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    await h.cleanup.query("update app.call_summary set attempts=2 where call_id=$1", [c.callId]);
    const claim = (await worker<Claim>(h, "claim"))!;
    assert.equal(claim.attempt, 3);
    await h.cleanup.query("update app.call_summary set lease_until=now()-interval '1 second' where id=$1", [claim.id]);
    assert.equal(await worker(h, "maintain"), 1);
    const [row] = await summaries(h, c.callId);
    assert.deepEqual([row.state, row.error_code], ["failed", "LEASE_EXPIRED"]);
  } finally {
    await h.close();
  }
});

test("staff read, cannot edit; other org sees nothing", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    const q = "select id from app.call_summary where call_id=$1";
    assert.equal((await asApp(h, h.staff, h.orgA.id, q, [c.callId])).rows.length, 1);
    assert.equal((await asApp(h, h.staff, h.orgA.id, "update app.call_summary set reason_en='x' where call_id=$1", [c.callId])).count, 0);
    assert.equal((await asApp(h, h.bob, h.orgB.id, q, [c.callId])).rows.length, 0);
    assert.equal((await asApp(h, h.alice, h.orgA.id, "update app.call_summary set reason_en='x',edited=true where call_id=$1", [c.callId])).count, 1);
    await assert.rejects(asApp(h, h.alice, h.orgA.id, "delete from app.call_summary where call_id=$1", [c.callId]), /permission denied/);
    await assert.rejects(asApp(h, h.alice, h.orgA.id, "update app.call_summary set state='done' where call_id=$1", [c.callId]), /permission denied/);
  } finally {
    await h.close();
  }
});

test("deleting the contact deletes the summary", async () => {
  const h = await createHarness();
  try {
    const c = await summarisedCall(h);
    assert.equal((await summaries(h, c.callId)).length, 1);
    await h.cleanup.query("delete from app.contact where id=$1", [c.contactId]);
    assert.equal((await summaries(h, c.callId)).length, 0);
  } finally {
    await h.close();
  }
});

test("web role cannot run the worker function", async () => {
  const h = await createHarness();
  try {
    await assert.rejects(asApp(h, h.alice, h.orgA.id, "select app_private.call_summary('claim',$1)", [h.namespace]), /permission denied/);
  } finally {
    await h.close();
  }
});
