// The call summary on the call read and list, and the owner/admin edit
// command. Local database only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

async function fixture() {
  const p = await createPhase2Harness();
  const { h } = p;
  const call = async (summary: "done" | "pending" | null) => {
    const id = (
      await h.cleanup.query(
        `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,caller_e164,sip_call_id,room,participant_identity,token_hash,state,answered_at,ended_at,duration_seconds)
         values($1,$2,$3,$4,'{}','+60115550190','+60115550191','SCL_'||gen_random_uuid(),'room-a','sip_a',$5,'ended',now(),now(),40)returning id`,
        [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, sha("t" + randomUUID())],
      )
    ).rows[0].id as string;
    if (summary === "done")
      await h.cleanup.query(
        `insert into app.call_summary(org_id,namespace,call_id,state,reason_en,reason_ms,outcome_en,outcome_ms,next_step_en,next_step_ms,model,completed_at,revision)
         values($1,$2,$3,'done','Asked about opening hours','Bertanya waktu buka','Told the hours','Diberitahu waktu','Call back','Hubungi semula','claude-haiku-5-5',now(),2)`,
        [h.orgA.id, h.namespace, id],
      );
    if (summary === "pending")
      await h.cleanup.query("insert into app.call_summary(org_id,namespace,call_id)values($1,$2,$3)", [h.orgA.id, h.namespace, id]);
    return id;
  };
  return { ...p, call };
}

test("every member reads the summary; staff still get no turns; other businesses see nothing", async () => {
  const p = await fixture();
  const { h, api, req } = p;
  try {
    const id = await p.call("done");
    const d = (await req("GET", `/calls/${id}`)).body.data;
    // The detail's one source for the reason is `summary`, not top-level fields.
    assert.equal("reason_en" in d, false);
    assert.equal("reason_ms" in d, false);
    assert.equal(d.summary.state, "done");
    assert.equal(d.summary.reason_en, "Asked about opening hours");
    assert.equal(d.summary.reason_ms, "Bertanya waktu buka");
    assert.equal(d.summary.next_step_ms, "Hubungi semula");
    assert.equal(d.summary.edited, false);
    assert.equal(d.summary.revision, 2);
    const s = await api.request(h.staff, h.orgA.id, "GET", `/api/v1/calls/${id}`);
    assert.equal(s.status, 200);
    assert.equal(s.body.data.turns, null);
    assert.equal(s.body.data.summary.reason_en, "Asked about opening hours");
    assert.equal((await api.request(h.bob, h.orgB.id, "GET", `/api/v1/calls/${id}`)).status, 404);
  } finally {
    await p.close();
  }
});

test("a call with no summary row has summary null; the list carries the reason only when done", async () => {
  const p = await fixture();
  const { req } = p;
  try {
    const none = await p.call(null);
    const pend = await p.call("pending");
    const done = await p.call("done");
    assert.equal((await req("GET", `/calls/${none}`)).body.data.summary, null);
    const pd = (await req("GET", `/calls/${pend}`)).body.data;
    assert.equal(pd.summary.state, "pending");
    assert.equal(pd.summary.reason_en, null);
    const items = (await req("GET", "/calls")).body.data.items as any[];
    const by = (id: string) => items.find((i) => i.id === id);
    assert.equal(by(done).reason_en, "Asked about opening hours");
    assert.equal(by(done).reason_ms, "Bertanya waktu buka");
    assert.equal(by(pend).reason_en, null);
    assert.equal(by(none).reason_ms, null);
  } finally {
    await p.close();
  }
});

test("owners edit both languages with a revision check; staff cannot; clear empties all six", async () => {
  const p = await fixture();
  const { h, api, req } = p;
  try {
    const id = await p.call("done");
    const body = { reason: "Asked about Saturday servicing", outcome: null, nextStep: null, expectedRevision: 2 };
    const staff = await api.request(h.staff, h.orgA.id, "PATCH", `/api/v1/calls/${id}/summary`, body);
    assert.equal(staff.status, 403);
    const ok = await req("PATCH", `/calls/${id}/summary`, body);
    assert.equal(ok.status, 200);
    const s = ok.body.data;
    assert.equal(s.reason_en, "Asked about Saturday servicing");
    assert.equal(s.reason_ms, "Asked about Saturday servicing");
    assert.equal(s.outcome_en, null);
    assert.equal(s.outcome_ms, null);
    assert.equal(s.next_step_en, null);
    assert.equal(s.edited, true);
    assert.equal(s.revision, 3);
    const stale = await req("PATCH", `/calls/${id}/summary`, body);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "CONFLICT");
    const audit = (
      await h.cleanup.query("select metadata from app.audit_log where org_id=$1 and action='call_summary.updated' and target_id=$2", [h.orgA.id, id])
    ).rows;
    assert.equal(audit.length, 1);
    assert.equal(JSON.stringify(audit[0].metadata).includes("Saturday"), false);
    const clear = await req("PATCH", `/calls/${id}/summary`, { reason: null, outcome: null, nextStep: null, expectedRevision: 3 });
    assert.equal(clear.status, 200);
    for (const k of ["reason", "outcome", "next_step"])
      for (const l of ["en", "ms"]) assert.equal(clear.body.data[`${k}_${l}`], null);
    assert.equal(clear.body.data.edited, true);
    assert.equal(clear.body.data.revision, 4);
  } finally {
    await p.close();
  }
});

test("edit on a pending summary is SUMMARY_NOT_READY; a call without one is NOT_FOUND", async () => {
  const p = await fixture();
  const { req } = p;
  try {
    const pend = await p.call("pending");
    const r = await req("PATCH", `/calls/${pend}/summary`, { reason: "x", outcome: null, nextStep: null, expectedRevision: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, "SUMMARY_NOT_READY");
    const none = await p.call(null);
    assert.equal((await req("PATCH", `/calls/${none}/summary`, { reason: "x", outcome: null, nextStep: null, expectedRevision: 1 })).status, 404);
  } finally {
    await p.close();
  }
});
