// The call summary worker against the local database, with a fake `write`.
// No network call and no model call. Fake names and numbers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { CallSummaryWorker } from "../../engine/src/agent/call-summary.ts";
import type { SummaryInput } from "../../packages/inference/src/call-summary.ts";

type Write = NonNullable<Parameters<typeof CallSummaryWorker.create>[1]>["write"];
type Result = Awaited<ReturnType<NonNullable<Write>>>;

const fields = {
  reason_en: "Asked about opening hours.",
  reason_ms: "Tanya waktu operasi.",
  outcome_en: "Told the hours.",
  outcome_ms: "Diberitahu waktu.",
  next_step_en: null,
  next_step_ms: null,
};
const good = (): Result => ({ fields, model: "fake-model" });
function fake(...steps: Result[]) {
  const inputs: SummaryInput[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const write: NonNullable<Write> = async (_client, input, opts) => {
    inputs.push(input);
    signals.push(opts?.signal);
    return steps.length > 1 ? steps.shift()! : steps[0]!;
  };
  return { write, inputs, signals };
}

async function fixture() {
  const f = await createPhase2Harness();
  const h = f.h;
  const q = (sql: string, args: unknown[] = []) => h.cleanup.query(sql, args);
  const workers: CallSummaryWorker[] = [];
  const worker = async (write: NonNullable<Write>, opts: { enabled?: boolean } = {}) => {
    const w = await CallSummaryWorker.create(h.namespace, {
      write,
      enabled: opts.enabled ?? true,
      maintainEveryMs: 0,
    });
    workers.push(w);
    return w;
  };
  // An answered call that ended after `seconds`, with two completed turns and
  // one still running.
  const endedCall = async () => {
    const contact = (
      await q("insert into app.contact(org_id,name,phone_e164)values($1,'Caller Contoh','+60115550101')returning id", [h.orgA.id])
    ).rows[0].id as string;
    const call = (
      await q(
        `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,caller_e164,contact_id,sip_call_id,room,participant_identity,token_hash)
         values($1,$2,$3,$4,'{}','+60115550190','+60115550101',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',$6)returning id`,
        [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, contact, createHash("sha256").update(randomUUID()).digest("hex")],
      )
    ).rows[0].id as string;
    await q("update app.call set answered_at=now() where id=$1", [call]);
    const turn = (input: string, answer: string | null, state: string, ageMs: number) =>
      q(
        `insert into app.call_turn(org_id,call_id,client_turn_id,input,answer,state,created_at)
         values($1,$2,$3,$4,$5,$6,now()-($7||' milliseconds')::interval)`,
        [h.orgA.id, call, randomUUID(), input, answer, state, String(ageMs)],
      );
    await turn("Soalan satu", "Jawapan satu", "completed", 3000);
    await turn("Soalan dua", "Jawapan dua", "completed", 2000);
    await turn("Soalan tiga", null, "running", 1000);
    await q("update app.call set state='ended',ended_at=now(),duration_seconds=40,end_reason='hangup' where id=$1", [call]);
    return call;
  };
  const row = async (call: string) => (await q("select * from app.call_summary where call_id=$1", [call])).rows[0];
  const close = async () => {
    for (const w of workers) await w.close();
    await f.close();
  };
  return { h, worker, endedCall, row, close };
}
async function withFixture(run: (x: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const x = await fixture();
  try {
    await run(x);
  } finally {
    await x.close();
  }
}

test("writes a summary for an ended call", () =>
  withFixture(async (x) => {
    const call = await x.endedCall();
    const { write, signals } = fake(good());
    const w = await x.worker(write);
    assert.equal(await w.tick(), true);
    const r = await x.row(call);
    assert.equal(r.state, "done");
    assert.equal(r.reason_en, fields.reason_en);
    assert.equal(r.outcome_ms, fields.outcome_ms);
    assert.equal(r.next_step_en, null);
    assert.equal(r.model, "fake-model");
    assert.ok(signals[0] instanceof AbortSignal);
    assert.equal(await w.tick(), false);
  }));

test("guard failure retries then fails", () =>
  withFixture(async (x) => {
    const call = await x.endedCall();
    const { write } = fake({ error: "QUOTE" });
    const w = await x.worker(write);
    assert.equal(await w.tick(), true);
    assert.equal((await x.row(call)).state, "pending");
    assert.equal(await w.tick(), true);
    assert.equal((await x.row(call)).state, "pending");
    assert.equal(await w.tick(), true);
    const r = await x.row(call);
    assert.equal(r.state, "failed");
    assert.equal(r.error_code, "QUOTE");
    assert.equal(await w.tick(), false);
  }));

test("a write the database refuses becomes a failed attempt, not a thrown error", () =>
  withFixture(async (x) => {
    const call = await x.endedCall();
    const { write } = fake({ fields: { ...fields, reason_en: "" }, model: "fake-model" });
    const w = await x.worker(write);
    assert.equal(await w.tick(), true);
    const r = await x.row(call);
    assert.equal(r.state, "pending");
    assert.equal(r.error_code, "SUMMARY_INVALID");
  }));

test("disabled worker claims nothing", () =>
  withFixture(async (x) => {
    const call = await x.endedCall();
    const { write, inputs } = fake(good());
    const w = await x.worker(write, { enabled: false });
    assert.equal(await w.tick(), false);
    assert.equal((await x.row(call)).state, "pending");
    assert.equal(inputs.length, 0);
  }));

test("sends only completed turns and keeps the caller number out of the request fields", () =>
  withFixture(async (x) => {
    await x.endedCall();
    const { write, inputs } = fake(good());
    const w = await x.worker(write);
    assert.equal(await w.tick(), true);
    const input = inputs[0]!;
    assert.deepEqual(
      input.turns.map((t) => t.input),
      ["Soalan satu", "Soalan dua"],
    );
    assert.equal(input.callerE164, "+60115550101");
    assert.equal(input.outcome, null);
    assert.equal(input.afterHours, false);
    assert.deepEqual(input.proposals, []);
  }));

test("close stops the loop promptly", () =>
  withFixture(async (x) => {
    const w = await x.worker(fake(good()).write);
    const loop = w.run();
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    await w.close();
    await loop;
    assert.ok(Date.now() - t0 < 2000);
  }));
