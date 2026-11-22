import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { Engine } from "../../engine/src/engine.ts";
import { FakeSender } from "../../engine/src/mail.ts";

// The engine sends the queued follow-up emails with no customer data in them.
process.env.NODE_ENV = "test";
type H = Awaited<ReturnType<typeof createHarness>>;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const SECRET = { name: "Pemanggil Rahsia", phone: "+60123334444", text: "Nombor akaun saya 12345" };

// One completed call turn with a message proposal, as in tests/db/follow-up-alerts.test.ts.
async function callItem(h: H) {
  const contactId = (
    await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,$2,$3)returning id", [h.orgA.id, SECRET.name, SECRET.phone])
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
      JSON.stringify({ text: SECRET.text, name: SECRET.name, phone: SECRET.phone }),
    ])
  ).rows[0].id as string;
  await h.cleanup.query("update app.call_turn set state='completed',completed_at=now(),revision=revision+1 where id=$1", [turnId]);
  const f = (await h.cleanup.query("select * from app.follow_up where call_proposal_id=$1", [proposalId])).rows[0];
  return { contactId, proposalId, followUpId: f.id as string };
}
const alertStates = async (h: H, followUpId: string) =>
  (await h.cleanup.query("select state from app.follow_up_alert where follow_up_id=$1 order by user_id", [followUpId])).rows.map((r) => r.state as string);
const stub = { plans: { firstAfterMs: 3_600_000, notify: async () => {} } };

async function run(h: H, mail: FakeSender, ticks = 4) {
  const engine = await Engine.create(h.namespace, { mail, ...stub });
  try {
    for (let i = 0; i < ticks; i++) await engine.tick();
  } finally {
    await engine.close();
  }
}

test("a new follow-up is mailed once to each owner, with no customer data", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    const mail = new FakeSender();
    await run(h, mail);
    const sent = mail.sent.filter((m) => m.text.includes(c.followUpId));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, h.alice.confirmedEmail);
    assert.equal(sent[0].subject, "New follow-up in JomCall / Susulan baharu dalam JomCall");
    assert.match(sent[0].text, /took a message from a phone call at /);
    for (const secret of [SECRET.name, SECRET.phone, "12345", SECRET.text, "Studio Contoh"])
      assert.ok(!sent[0].subject.includes(secret) && !sent[0].text.includes(secret), secret);
    assert.deepEqual(await alertStates(h, c.followUpId), ["sent"]);
    await run(h, mail);
    assert.equal(mail.sent.filter((m) => m.text.includes(c.followUpId)).length, 1);
  } finally {
    await h.close();
  }
});

test("an item closed before the tick sends nothing and the alert is skipped", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    await h.cleanup.query("update app.follow_up set state='dismissed',revision=revision+1 where id=$1", [c.followUpId]);
    const mail = new FakeSender();
    await run(h, mail);
    assert.equal(mail.sent.filter((m) => m.text.includes(c.followUpId)).length, 0);
    assert.deepEqual(await alertStates(h, c.followUpId), ["skipped"]);
  } finally {
    await h.close();
  }
});

test("a contact waiting for deletion sends nothing and the alert is skipped", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    await h.cleanup.query("update app.contact set deletion_pending=true where id=$1", [c.contactId]);
    const mail = new FakeSender();
    await run(h, mail);
    assert.equal(mail.sent.filter((m) => m.text.includes(c.followUpId)).length, 0);
    assert.deepEqual(await alertStates(h, c.followUpId), ["skipped"]);
  } finally {
    await h.close();
  }
});
