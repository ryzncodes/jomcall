// Follow-up alerts in the database (app.follow_up_alert): queueing for new
// and assigned items, none on back-fill or self-assignment, the payload the
// engine reads (no customer data), skip rules, ack and claim_outbox.
// Local database only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Identity = Harness["alice"];

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const fakePhone = () => "+6011" + String(Math.floor(Math.random() * 9000000) + 1000000);

async function setup() {
  const h = await createHarness();
  const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 2 });
  return {
    h,
    worker,
    close: async () => {
      await worker.end();
      await h.close();
    },
  };
}

// The harness has no admin: staff becomes one for a test.
const promoteStaff = (h: Harness) => h.cleanup.query("update app.member set role='admin' where org_id=$1 and user_id=$2", [h.orgA.id, h.staff.userId]);

// One completed call turn with a message proposal, as in tests/db/follow-up.test.ts.
async function callItem(h: Harness, text = "Sila telefon semula esok.") {
  const contactId = (
    await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,'Caller Contoh',$2)returning id", [h.orgA.id, fakePhone()])
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
      JSON.stringify({ text, name: "Caller Contoh", phone: "+60110000000" }),
    ])
  ).rows[0].id as string;
  await h.cleanup.query("update app.call_turn set state='completed',completed_at=now(),revision=revision+1 where id=$1", [turnId]);
  const f = (await h.cleanup.query("select * from app.follow_up where call_proposal_id=$1", [proposalId])).rows[0];
  return { callId, contactId, turnId, proposalId, followUp: f };
}

const alerts = (h: Harness, followUpId: string) =>
  h.cleanup
    .query("select * from app.follow_up_alert where follow_up_id=$1 order by reason,event_revision,user_id", [followUpId])
    .then((r) => r.rows);

const alertOutbox = (h: Harness, alertIds: string[]) =>
  h.cleanup
    .query("select * from app.outbox where kind='follow_up.alert' and resource_id = any($1) order by created_at,id", [alertIds])
    .then((r) => r.rows);

const namespaceAlertOutbox = (h: Harness) =>
  h.cleanup.query("select count(*)::int n from app.outbox where kind='follow_up.alert' and namespace=$1", [h.namespace]).then((r) => r.rows[0].n as number);

const assign = (h: Harness, who: Identity, id: string, revision: number, assignee: string | null) =>
  h
    .sqlAsApp(who, h.orgA.id, (tx) => tx.query("select app_private.follow_up_assign($1,$2,$3,null) as v", [id, revision, assignee]))
    .then((r) => r.rows[0].v as Record<string, unknown>);

const close = (h: Harness, who: Identity, id: string, revision: number) =>
  h.sqlAsApp(who, h.orgA.id, (tx) => tx.query("select app_private.follow_up_close($1,$2,'dismissed',null) as v", [id, revision]));

const outboxFor = async (h: Harness, alertId: string) => (await alertOutbox(h, [alertId]))[0].id as string;
const payload = async (s: Awaited<ReturnType<typeof setup>>, outboxId: string) =>
  (await s.worker.query("select app_private.follow_up_alert_payload($1,$2) v", [outboxId, s.h.namespace])).rows[0].v as Record<string, unknown> | null;
const alertState = async (h: Harness, id: string) => (await h.cleanup.query("select state,attempts,sent_at from app.follow_up_alert where id=$1", [id])).rows[0];

test("new item queues one alert per owner and admin", async () => {
  const s = await setup();
  const { h } = s;
  try {
    // Staff as staff: the owner only.
    const one = await callItem(h);
    const a1 = await alerts(h, one.followUp.id);
    assert.deepEqual(
      a1.map((a) => [a.user_id, a.reason, a.event_revision, a.state, a.attempts, a.namespace]),
      [[h.alice.userId, "new", 1, "queued", 0, h.namespace]],
    );
    const o1 = await alertOutbox(h, a1.map((a) => a.id));
    assert.deepEqual(
      o1.map((o) => [o.kind, o.namespace, o.org_id]),
      [["follow_up.alert", h.namespace, h.orgA.id]],
    );

    // Staff promoted to admin: owner and admin.
    await promoteStaff(h);
    const two = await callItem(h);
    const a2 = await alerts(h, two.followUp.id);
    assert.deepEqual(a2.map((a) => a.user_id).sort(), [h.alice.userId, h.staff.userId].sort());
    assert.ok(a2.every((a) => a.reason === "new" && a.state === "queued"));
    assert.equal((await alertOutbox(h, a2.map((a) => a.id))).length, 2);

    // An inactive admin gets nothing (deactivate after the tests above).
    await h.cleanup.query("update app.member set active=false where org_id=$1 and user_id=$2", [h.orgA.id, h.staff.userId]);
    const three = await callItem(h);
    assert.deepEqual(
      (await alerts(h, three.followUp.id)).map((a) => a.user_id),
      [h.alice.userId],
    );

    // Org B's owner never gets org A's alerts.
    assert.equal((await h.cleanup.query("select count(*)::int n from app.follow_up_alert where user_id=$1", [h.bob.userId])).rows[0].n, 0);
  } finally {
    await s.close();
  }
});

test("self-assignment queues nothing; assigning staff queues one", async () => {
  const s = await setup();
  const { h } = s;
  try {
    const c = await callItem(h);
    const before = (await alerts(h, c.followUp.id)).length;
    await assign(h, h.alice, c.followUp.id, 1, h.alice.userId);
    assert.equal((await alerts(h, c.followUp.id)).length, before);

    const a = await assign(h, h.alice, c.followUp.id, 2, h.staff.userId);
    const assigned = (await alerts(h, c.followUp.id)).filter((x) => x.reason === "assigned");
    assert.deepEqual(
      assigned.map((x) => [x.user_id, x.event_revision, x.state]),
      [[h.staff.userId, a.revision, "queued"]],
    );
    assert.equal((await alertOutbox(h, [assigned[0].id])).length, 1);

    // Re-saving the same assignee and unassigning queue nothing more.
    await assign(h, h.alice, c.followUp.id, 3, h.staff.userId);
    await assign(h, h.alice, c.followUp.id, 4, null);
    assert.equal((await alerts(h, c.followUp.id)).filter((x) => x.reason === "assigned").length, 1);

    // Assigning the same person again later is a new event.
    const again = await assign(h, h.alice, c.followUp.id, 5, h.staff.userId);
    const twice = (await alerts(h, c.followUp.id)).filter((x) => x.reason === "assigned");
    assert.deepEqual(
      twice.map((x) => x.event_revision),
      [3, again.revision],
    );
  } finally {
    await s.close();
  }
});

test("back-fill queues nothing", async () => {
  const s = await setup();
  const { h } = s;
  try {
    await promoteStaff(h);
    const c = await callItem(h);
    // Deleting the follow-up cascades its alerts, not their outbox rows.
    await h.cleanup.query("delete from app.follow_up where id=$1", [c.followUp.id]);
    const outboxBefore = await namespaceAlertOutbox(h);
    const n = (await h.cleanup.query("select app_private.follow_up_backfill() as n")).rows[0].n;
    assert.ok(n >= 1, `back-filled ${n}`);
    const [restored] = (await h.cleanup.query("select * from app.follow_up where call_proposal_id=$1", [c.proposalId])).rows;
    assert.equal(restored.state, "open");
    assert.equal((await alerts(h, restored.id)).length, 0);
    assert.equal(await namespaceAlertOutbox(h), outboxBefore);
    // After the back-fill, a new item in a fresh session still queues alerts.
    const d = await callItem(h);
    assert.equal((await alerts(h, d.followUp.id)).length, 2);
  } finally {
    await s.close();
  }
});

test("payload", async () => {
  const s = await setup();
  const { h } = s;
  try {
    const c = await callItem(h);
    const [a] = await alerts(h, c.followUp.id);
    const outboxId = await outboxFor(h, a.id);
    const op = (await h.cleanup.query("select operation_id from app.outbox where id=$1", [outboxId])).rows[0].operation_id;
    const p = await payload(s, outboxId);
    assert.ok(p);
    assert.deepEqual(Object.keys(p).sort(), ["createdAt", "email", "followUpId", "kind", "operationId", "reason", "source"]);
    assert.equal(p.email, h.alice.confirmedEmail);
    assert.equal(p.operationId, op);
    assert.equal(p.reason, "new");
    assert.equal(p.kind, "message");
    assert.equal(p.source, "call");
    assert.equal(p.followUpId, c.followUp.id);
    assert.equal(new Date(p.createdAt as string).toISOString(), new Date(c.followUp.created_at).toISOString());
    // Nothing of what the caller said, nor who they are, nor the organization.
    const text = JSON.stringify(p);
    for (const absent of ["Caller Contoh", "+6011", "+60110000000", "Sila telefon", "Studio Contoh", "details"]) assert.ok(!text.includes(absent), absent);
    assert.equal((await alertState(h, a.id)).attempts, 1);
    // A payload for another namespace or kind is nothing.
    assert.equal((await s.worker.query("select app_private.follow_up_alert_payload($1,'local') v", [outboxId])).rows[0].v, null);

    // Closed: null, skipped.
    await close(h, h.alice, c.followUp.id, 1);
    assert.equal(await payload(s, outboxId), null);
    assert.equal((await alertState(h, a.id)).state, "skipped");
    // Asked again: still null, still skipped.
    assert.equal(await payload(s, outboxId), null);

    // Recipient no longer an active member: null, skipped.
    await promoteStaff(h);
    const d = await callItem(h);
    const staffAlert = (await alerts(h, d.followUp.id)).find((x) => x.user_id === h.staff.userId)!;
    await h.cleanup.query("update app.member set active=false where org_id=$1 and user_id=$2", [h.orgA.id, h.staff.userId]);
    assert.equal(await payload(s, await outboxFor(h, staffAlert.id)), null);
    assert.equal((await alertState(h, staffAlert.id)).state, "skipped");

    // Follow-up gone: the alert goes with it and the payload is null.
    const e = await callItem(h);
    const [ea] = await alerts(h, e.followUp.id);
    const eo = await outboxFor(h, ea.id);
    await h.cleanup.query("delete from app.call_proposal where id=$1", [e.proposalId]);
    assert.equal(await payload(s, eo), null);
  } finally {
    await s.close();
  }
});

test("payload for unassigned", async () => {
  const s = await setup();
  const { h } = s;
  try {
    await promoteStaff(h);
    const c = await callItem(h);
    await assign(h, h.alice, c.followUp.id, 1, h.staff.userId);
    const [staffAssigned] = (await alerts(h, c.followUp.id)).filter((x) => x.reason === "assigned");
    const outboxId = await outboxFor(h, staffAssigned.id);
    // Reassigned to the owner before the email went: nothing to send.
    await assign(h, h.staff, c.followUp.id, 2, h.alice.userId);
    assert.equal(await payload(s, outboxId), null);
    assert.equal((await alertState(h, staffAssigned.id)).state, "skipped");
    // Staff's "new" alert is still sendable: staff is still an active admin.
    const staffNew = (await alerts(h, c.followUp.id)).find((x) => x.reason === "new" && x.user_id === h.staff.userId)!;
    const p = await payload(s, await outboxFor(h, staffNew.id));
    assert.equal(p?.email, h.staff.confirmedEmail);
    assert.equal(p?.reason, "new");
  } finally {
    await s.close();
  }
});

test("ack", async () => {
  const s = await setup();
  const { h } = s;
  try {
    await promoteStaff(h);
    const c = await callItem(h);
    const [first, second] = await alerts(h, c.followUp.id);
    const o1 = await outboxFor(h, first.id);
    const o2 = await outboxFor(h, second.id);
    await s.worker.query("select app_private.ack_follow_up_alert($1,$2,false)", [o1, h.namespace]);
    const sent = await alertState(h, first.id);
    assert.equal(sent.state, "sent");
    assert.ok(sent.sent_at);
    await s.worker.query("select app_private.ack_follow_up_alert($1,$2,true)", [o2, h.namespace]);
    const failed = await alertState(h, second.id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.sent_at, null);
    // A sent alert is not sent again, and a later failure does not change it.
    assert.equal(await payload(s, o1), null);
    await s.worker.query("select app_private.ack_follow_up_alert($1,$2,true)", [o1, h.namespace]);
    assert.equal((await alertState(h, first.id)).state, "sent");
    // Gone: a no-op.
    await s.worker.query("select app_private.ack_follow_up_alert($1,$2,false)", [randomUUID(), h.namespace]);
  } finally {
    await s.close();
  }
});

test("claim_outbox returns follow_up.alert rows for the namespace", async () => {
  const s = await setup();
  const { h } = s;
  try {
    const c = await callItem(h);
    const [a] = await alerts(h, c.followUp.id);
    const outboxId = await outboxFor(h, a.id);
    const claimed = (await s.worker.query("select * from app_private.claim_outbox($1,20)", [h.namespace])).rows;
    const mine = claimed.filter((r) => r.id === outboxId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].kind, "follow_up.alert");
    assert.equal(mine[0].resource_id, a.id);
    // Another namespace does not see it.
    const other = (await s.worker.query("select * from app_private.claim_outbox($1,20)", [`test_${randomUUID()}`])).rows;
    assert.equal(other.length, 0);
  } finally {
    await s.close();
  }
});

test("the web role reads no alert and calls no alert function", async () => {
  const s = await setup();
  const { h } = s;
  try {
    const r = (
      await h.cleanup.query(
        `select has_table_privilege('jomcall_app','app.follow_up_alert','select') sel,
          (select relrowsecurity and relforcerowsecurity from pg_class where oid='app.follow_up_alert'::regclass) rls,
          has_function_privilege('jomcall_app','app_private.follow_up_alert_payload(uuid,text)','execute') pay,
          has_function_privilege('jomcall_app','app_private.ack_follow_up_alert(uuid,text,boolean)','execute') ack,
          (select proowner::regrole::text from pg_proc where oid='app_private.follow_up_alert_payload(uuid,text)'::regprocedure) owner`,
      )
    ).rows[0];
    assert.deepEqual(r, { sel: false, rls: true, pay: false, ack: false, owner: "jomcall_jobs" });
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) => tx.query("select * from app.follow_up_alert")),
      /permission denied/,
    );
  } finally {
    await s.close();
  }
});
