// Follow-up commands through the web dispatcher: list, count, close, reopen,
// assign, rights, tenant isolation and PDPA hiding. Local database only;
// fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";

type Harness = Awaited<ReturnType<typeof createHarness>>;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const fakePhone = () => "+6011" + String(Math.floor(Math.random() * 9000000) + 1000000);

// One completed call turn with a message proposal, as in tests/db/follow-up.test.ts.
async function callItem(h: Harness, phone = fakePhone()) {
  const contactId = (
    await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,'Caller Contoh',$2)returning id", [h.orgA.id, phone])
  ).rows[0].id as string;
  const callId = (
    await h.cleanup.query(
      `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,contact_id,sip_call_id,room,participant_identity,token_hash)
       values($1,$2,$3,$4,'{}','+60112223333',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',$6)returning id`,
      [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, contactId, sha("token-" + randomUUID())],
    )
  ).rows[0].id as string;
  const turnId = (
    await h.cleanup.query(
      "insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)values($1,$2,$3,'Boleh tinggal pesanan?','running',$4,now()+interval '60 seconds')returning id",
      [h.orgA.id, callId, randomUUID(), randomUUID()],
    )
  ).rows[0].id as string;
  const proposalId = (
    await h.cleanup.query("insert into app.call_proposal(org_id,call_id,turn_id,step,kind,details)values($1,$2,$3,0,'message',$4)returning id", [
      h.orgA.id,
      callId,
      turnId,
      JSON.stringify({ text: "Sila telefon semula esok.", name: "Caller Contoh", phone }),
    ])
  ).rows[0].id as string;
  await h.cleanup.query("update app.call_turn set state='completed',completed_at=now(),revision=revision+1 where id=$1", [turnId]);
  const f = (await h.cleanup.query("select * from app.follow_up where call_proposal_id=$1", [proposalId])).rows[0];
  return { contactId, callId, followUp: f };
}

async function setup() {
  const h = await createHarness();
  const api = await createApiHarness(h);
  const get = (who: Harness["alice"], org: string, path: string) => api.request(who, org, "GET", "/api/v1" + path);
  const post = (who: Harness["alice"], org: string, path: string, body: unknown, key?: string) =>
    api.request(who, org, "POST", "/api/v1" + path, body, key ? { "idempotency-key": key } : {});
  return { h, api, get, post, close: async () => { await api.close(); await h.close(); } };
}

test("list and count show the item with its contact; mine follows assignment", async () => {
  const { h, get, post, close } = await setup();
  try {
    const { followUp, contactId } = await callItem(h, "+60111234567");
    const list = await get(h.staff, h.orgA.id, "/follow-ups");
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 1);
    const item = list.body.data.items[0];
    assert.equal(item.id, followUp.id);
    assert.equal(item.kind, "message");
    assert.equal(item.source, "call");
    assert.equal(item.state, "open");
    assert.equal(item.assignee, null);
    assert.deepEqual(item.contact, { id: contactId, name: "Caller Contoh", phone: "+60111234567" });
    assert.equal(list.body.data.next, null);
    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups?view=done")).body.data.items.length, 0);
    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups?view=mine")).body.data.items.length, 0);
    assert.deepEqual((await get(h.staff, h.orgA.id, "/follow-ups/count")).body.data, { open: 1, mine: 0 });

    const a = await post(h.alice, h.orgA.id, `/follow-ups/${followUp.id}/assign`, {
      expectedRevision: item.revision,
      assigneeUserId: h.staff.userId,
      dueAt: "2030-01-01T10:00:00+08:00",
    });
    assert.equal(a.status, 200);
    assert.equal(a.body.data.assignee.userId, h.staff.userId);
    assert.ok(a.body.data.assignee.name);
    assert.ok(a.body.data.due_at);
    assert.deepEqual((await get(h.staff, h.orgA.id, "/follow-ups/count")).body.data, { open: 1, mine: 1 });
    assert.deepEqual((await get(h.alice, h.orgA.id, "/follow-ups/count")).body.data, { open: 1, mine: 0 });
    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups?view=mine")).body.data.items.length, 1);
  } finally {
    await close();
  }
});

test("close and reopen; a stale second close conflicts once; same key replays", async () => {
  const { h, get, post, close } = await setup();
  try {
    const { followUp } = await callItem(h);
    const path = `/follow-ups/${followUp.id}/close`;
    const k = randomUUID();
    const first = await post(h.staff, h.orgA.id, path, { expectedRevision: 1, state: "done" }, k);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.state, "done");
    const replay = await post(h.staff, h.orgA.id, path, { expectedRevision: 1, state: "done" }, k);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.data, first.body.data);
    const second = await post(h.staff, h.orgA.id, path, { expectedRevision: 1, state: "done" }, randomUUID());
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, "CONFLICT");
    const audits = await h.cleanup.query("select count(*)::int n from app.audit_log where org_id=$1 and action='follow_up.close' and target_id=$2", [h.orgA.id, followUp.id]);
    assert.equal(audits.rows[0].n, 1);

    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups?view=done")).body.data.items.length, 1);
    assert.deepEqual((await get(h.staff, h.orgA.id, "/follow-ups/count")).body.data, { open: 0, mine: 0 });
    const re = await post(h.staff, h.orgA.id, `/follow-ups/${followUp.id}/reopen`, { expectedRevision: first.body.data.revision });
    assert.equal(re.status, 200);
    assert.equal(re.body.data.state, "open");
  } finally {
    await close();
  }
});

test("assign rights and assignee checks; promoted staff may assign", async () => {
  const { h, post, close } = await setup();
  try {
    const { followUp } = await callItem(h);
    const path = `/follow-ups/${followUp.id}/assign`;
    const asStaff = await post(h.staff, h.orgA.id, path, { expectedRevision: 1, assigneeUserId: h.staff.userId, dueAt: null });
    assert.equal(asStaff.status, 403);
    assert.equal(asStaff.body.error.code, "FORBIDDEN");
    const outsider = await post(h.alice, h.orgA.id, path, { expectedRevision: 1, assigneeUserId: h.bob.userId, dueAt: null });
    assert.equal(outsider.status, 422);
    assert.equal(outsider.body.error.code, "INVALID_ASSIGNEE");
    await h.cleanup.query("update app.member set role='admin' where org_id=$1 and user_id=$2", [h.orgA.id, h.staff.userId]);
    try {
      const asAdmin = await post(h.staff, h.orgA.id, path, { expectedRevision: 1, assigneeUserId: h.alice.userId, dueAt: null });
      assert.equal(asAdmin.status, 200);
      assert.equal(asAdmin.body.data.assignee.userId, h.alice.userId);
    } finally {
      await h.cleanup.query("update app.member set role='staff' where org_id=$1 and user_id=$2", [h.orgA.id, h.staff.userId]);
    }
  } finally {
    await close();
  }
});

test("another organization sees nothing and cannot close", async () => {
  const { h, get, post, close } = await setup();
  try {
    const { followUp } = await callItem(h);
    const list = await get(h.bob, h.orgB.id, "/follow-ups");
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 0);
    assert.deepEqual((await get(h.bob, h.orgB.id, "/follow-ups/count")).body.data, { open: 0, mine: 0 });
    const c = await post(h.bob, h.orgB.id, `/follow-ups/${followUp.id}/close`, { expectedRevision: 1, state: "done" });
    assert.equal(c.status, 404);
  } finally {
    await close();
  }
});

test("a contact pending deletion hides its item from list and count", async () => {
  const { h, get, close } = await setup();
  try {
    const { contactId } = await callItem(h);
    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups")).body.data.items.length, 1);
    await h.cleanup.query("update app.contact set deletion_pending=true where id=$1", [contactId]);
    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups")).body.data.items.length, 0);
    assert.deepEqual((await get(h.staff, h.orgA.id, "/follow-ups/count")).body.data, { open: 0, mine: 0 });
  } finally {
    await close();
  }
});

test("cursors: bad one is refused; a well-formed one pages in both orders", async () => {
  const { h, get, post, close } = await setup();
  try {
    const a = await callItem(h);
    const b = await callItem(h);
    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups?cursor=zzz")).status, 422);
    for (const f of [a.followUp, b.followUp])
      assert.equal((await post(h.staff, h.orgA.id, `/follow-ups/${f.id}/close`, { expectedRevision: 1, state: "dismissed" })).status, 200);
    const cur = (view: string, id: string) =>
      Buffer.from(JSON.stringify([view, "2100-01-01T00:00:00.000000+00:00", id])).toString("base64url");
    // Everything closed is older than the year 2100: newest-first paging still returns both.
    const done = await get(h.staff, h.orgA.id, "/follow-ups?view=done&cursor=" + cur("done", randomUUID()));
    assert.equal(done.status, 200);
    assert.equal(done.body.data.items.length, 2);
    const raw = (at: string) => Buffer.from(JSON.stringify(["open", at, randomUUID()])).toString("base64url");
    for (const at of ["1", "2026", "12/31/2026", "-271821-04-20T00:00:00Z", "2026-13-45T00:00:00Z", "0000-01-01T00:00:00Z"]) {
      const r = await get(h.staff, h.orgA.id, "/follow-ups?cursor=" + raw(at));
      assert.equal(r.status, 422, at);
      assert.equal(r.body.error.code, "INVALID_CURSOR");
    }
    assert.equal((await get(h.staff, h.orgA.id, "/follow-ups?view=open&cursor=" + cur("done", randomUUID()))).status, 422);
  } finally {
    await close();
  }
});
