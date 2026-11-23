import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { Engine } from "../../engine/src/engine.ts";
test("privacy jobs survive enqueue crash, export checks authority, deletion stays atomic and idempotent", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  let engine: Engine | undefined;
  try {
    const req = (method: string, path: string, body?: unknown) =>
      api.request(h.alice, h.orgA.id, method, "/api/v1" + path, body);
    const c = (
      await req("POST", "/contacts", {
        name: "Contoh Privasi",
        phone: null,
        preferredLanguage: "en",
      })
    ).body.data;
    assert.equal(
      (
        await api.request(
          h.staff,
          h.orgA.id,
          "POST",
          `/api/v1/contacts/${c.id}/export`,
          { expectedRevision: 1 },
        )
      ).status,
      403,
    );
    const exported = await req("POST", `/contacts/${c.id}/export`, {
      expectedRevision: 1,
    });
    assert.equal(exported.status, 200);
    const ex = exported.body.data;
    engine = await Engine.create(h.namespace);
    await engine.tick();
    let download = await req("GET", `/jobs/${ex.id}/download`);
    assert.equal(download.status, 200);
    assert.equal(download.body.contact.name, "Contoh Privasi");
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.equal(
      (
        await api.request(
          h.bob,
          h.orgB.id,
          "GET",
          `/api/v1/jobs/${ex.id}/download`,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await api.request(
          h.staff,
          h.orgA.id,
          "GET",
          `/api/v1/jobs/${ex.id}/download`,
        )
      ).status,
      403,
    );
    await h.cleanup.query(
      "update app.privacy_job set expires_at=now()-interval '1 second' where id=$1",
      [ex.id],
    );
    assert.equal((await req("GET", `/jobs/${ex.id}/download`)).status, 410);
    const deletion = await req("POST", `/contacts/${c.id}/deletion`, {
      expectedRevision: 1,
    });
    assert.equal(deletion.status, 200);
    const job = deletion.body.data;
    assert.equal(
      (
        await req("POST", `/contacts/${c.id}/notes`, {
          expectedRevision: 2,
          text: "Blocked",
        })
      ).status,
      409,
    );
    await assert.rejects(engine.tick("after-enqueue"), /INJECTED_CRASH/);
    await engine.close();
    engine = await Engine.create(h.namespace);
    await assert.rejects(engine.tick("before-commit"), /INJECTED_CRASH/);
    assert.equal((await req("GET", `/contacts/${c.id}`)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await engine.tick();
    await engine.tick();
    assert.equal(
      (await req("GET", `/jobs/${job.id}`)).body.data.state,
      "completed",
    );
    assert.equal((await req("GET", `/contacts/${c.id}`)).status, 404);
    assert.equal((await req("GET", `/jobs/${ex.id}/download`)).status, 404);
    assert.equal(
      (
        await h.cleanup.query(
          "select count(*) from app.audit_log where org_id=$1 and action='privacy.deleted'",
          [h.orgA.id],
        )
      ).rows[0].count,
      "1",
    );
    const worker = new pg.Pool({
      connectionString: process.env.WORKER_DATABASE_URL,
    });
    try {
      await assert.rejects(
        worker.query("select * from app.contact"),
        /permission denied/,
      );
      await assert.rejects(
        worker.query("update app.member set role='owner'"),
        /permission denied/,
      );
    } finally {
      await worker.end();
    }
  } finally {
    await engine?.close();
    await api.close();
    await h.close();
  }
});

test("contact export lists the contact's follow-ups without staff user ids", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  let engine: Engine | undefined;
  try {
    const req = (method: string, path: string, body?: unknown) =>
      api.request(h.alice, h.orgA.id, method, "/api/v1" + path, body);
    const c = (
      await req("POST", "/contacts", {
        name: "Contoh Susulan",
        phone: null,
        preferredLanguage: "ms",
      })
    ).body.data;
    // A completed call turn with a message proposal: the database creates
    // the follow-up. Fake values only.
    const callId = (
      await h.cleanup.query(
        `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,contact_id,sip_call_id,room,participant_identity,token_hash)
         values($1,$2,$3,$4,'{}','+60112223333',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text))returning id`,
        [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, c.id],
      )
    ).rows[0].id;
    const turnId = (
      await h.cleanup.query(
        "insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)values($1,$2,gen_random_uuid(),'Boleh tinggal pesanan?','running',gen_random_uuid(),now()+interval '60 seconds')returning id",
        [h.orgA.id, callId],
      )
    ).rows[0].id;
    await h.cleanup.query(
      "insert into app.call_proposal(org_id,call_id,turn_id,step,kind,details)values($1,$2,$3,0,'message',$4)",
      [h.orgA.id, callId, turnId, JSON.stringify({ text: "Sila telefon semula esok." })],
    );
    await h.cleanup.query(
      "update app.call_turn set state='completed',completed_at=now(),revision=revision+1 where id=$1",
      [turnId],
    );
    const item = (
      await h.cleanup.query("select id from app.follow_up where org_id=$1 and contact_id=$2", [h.orgA.id, c.id])
    ).rows[0];
    assert.equal(
      (
        await req("POST", `/follow-ups/${item.id}/assign`, {
          expectedRevision: 1,
          assigneeUserId: h.staff.userId,
          dueAt: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (await req("POST", `/follow-ups/${item.id}/close`, { expectedRevision: 2, state: "done" })).status,
      200,
    );
    const ex = (await req("POST", `/contacts/${c.id}/export`, { expectedRevision: 1 })).body.data;
    engine = await Engine.create(h.namespace);
    // The follow-up alerts queued above share the engine's small batches.
    let download = await req("GET", `/jobs/${ex.id}/download`);
    for (let i = 0; i < 5 && download.status !== 200; i++) {
      await engine.tick();
      download = await req("GET", `/jobs/${ex.id}/download`);
    }
    assert.equal(download.status, 200);
    assert.equal(download.body.followUps.length, 1);
    const [f] = download.body.followUps;
    assert.deepEqual(Object.keys(f).sort(), ["closed_at", "created_at", "details", "due_at", "kind", "source", "state"]);
    assert.equal(f.kind, "message");
    assert.equal(f.source, "call");
    assert.equal(f.state, "done");
    assert.equal(f.details.text, "Sila telefon semula esok.");
    assert.ok(f.closed_at);
    assert.ok(!JSON.stringify(download.body.followUps).includes(h.staff.userId));
    assert.ok(!JSON.stringify(download.body.followUps).includes(h.alice.userId));
  } finally {
    await engine?.close();
    await api.close();
    await h.close();
  }
});
