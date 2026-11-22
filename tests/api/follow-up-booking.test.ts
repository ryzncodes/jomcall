// Confirming a booking follow-up into JomCall's own calendar (design D5),
// reopening it, and the follow-ups on the call and chat reads. Local
// database only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { bookingFixture } from "../helpers/booking.ts";

type Fixture = Awaited<ReturnType<typeof bookingFixture>>;
type Who = Fixture["h"]["alice"];
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const fakePhone = () => "+6011" + String(Math.floor(Math.random() * 9000000) + 1000000);

// One completed call turn with one proposal; its follow-up is created by the
// database when the turn completes.
async function callItem(f: Fixture, contactId: string | null, kind: string, details: unknown) {
  const { h } = f;
  const callId = (
    await h.cleanup.query(
      `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,contact_id,sip_call_id,room,participant_identity,token_hash)
       values($1,$2,$3,$4,'{}','+60112223333',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',$6)returning id`,
      [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, contactId, sha("token-" + randomUUID())],
    )
  ).rows[0].id as string;
  const turnId = (
    await h.cleanup.query(
      "insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)values($1,$2,$3,'Boleh tempah esok pukul 9?','running',$4,now()+interval '60 seconds')returning id",
      [h.orgA.id, callId, randomUUID(), randomUUID()],
    )
  ).rows[0].id as string;
  const proposalId = (
    await h.cleanup.query("insert into app.call_proposal(org_id,call_id,turn_id,step,kind,details)values($1,$2,$3,0,$4,$5)returning id", [
      h.orgA.id,
      callId,
      turnId,
      kind,
      JSON.stringify(details),
    ])
  ).rows[0].id as string;
  await h.cleanup.query("update app.call_turn set state='completed',completed_at=now(),revision=revision+1 where id=$1", [turnId]);
  const followUp = (await h.cleanup.query("select * from app.follow_up where call_proposal_id=$1", [proposalId])).rows[0];
  assert.ok(followUp, "follow-up created");
  return { callId, followUp };
}

const bookingDetails = (f: Fixture, startAt = f.slotStart) => ({ resourceId: f.resource.id, startAt, title: "Servis Contoh" });

const post = (f: Fixture, who: Who, path: string, body: unknown) => f.api.request(who, f.h.orgA.id, "POST", "/api/v1" + path, body);
const get = (f: Fixture, who: Who, path: string) => f.api.request(who, f.h.orgA.id, "GET", "/api/v1" + path);
const bookingRows = (f: Fixture) =>
  f.h.cleanup.query("select * from app.booking where org_id=$1 order by created_at,id", [f.h.orgA.id]).then((r) => r.rows);
const item = (f: Fixture, id: string) => f.h.cleanup.query("select * from app.follow_up where id=$1", [id]).then((r) => r.rows[0]);
const offered = async (f: Fixture) =>
  (await get(f, f.h.staff, `/booking-availability?resourceId=${f.resource.id}&fromDate=${f.day}&days=1`)).body.data.items.some(
    (s: { startAt: string }) => Date.parse(s.startAt) === Date.parse(f.slotStart),
  );

test("confirm booking: a confirmed staff booking, the item done, the slot no longer offered; reopen cancels it", async () => {
  const f = await bookingFixture();
  try {
    const { followUp } = await callItem(f, f.contact.id, "booking", bookingDetails(f));
    assert.equal(await offered(f), true);
    const res = await post(f, f.h.staff, `/follow-ups/${followUp.id}/confirm-booking`, { expectedRevision: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.state, "done");
    assert.ok(res.body.data.booking_id);
    const [b] = await bookingRows(f);
    assert.equal(b.id, res.body.data.booking_id);
    assert.equal(b.status, "confirmed");
    assert.equal(b.source, "staff");
    assert.equal(b.contact_id, f.contact.id);
    assert.equal(b.resource_id, f.resource.id);
    assert.equal(b.title, "Servis Contoh");
    assert.equal(Date.parse(b.start_at), Date.parse(f.slotStart));
    assert.equal(await offered(f), false);
    const audits = (
      await f.h.cleanup.query("select action from app.audit_log where org_id=$1 and target_id in($2,$3)", [f.h.orgA.id, followUp.id, b.id])
    ).rows
      .map((r) => r.action)
      .sort();
    // One transaction, so one created_at: compare as a set.
    assert.deepEqual(audits, ["booking.confirm", "booking.requested", "follow_up.confirm_booking"]);

    const re = await post(f, f.h.staff, `/follow-ups/${followUp.id}/reopen`, { expectedRevision: res.body.data.revision });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.equal(re.body.data.state, "open");
    assert.equal(re.body.data.booking_id, null);
    const [after] = await bookingRows(f);
    assert.equal(after.status, "cancelled");
    assert.equal(after.revision, b.revision + 1);
    assert.equal(
      (await f.h.cleanup.query("select count(*)::int n from app.audit_log where org_id=$1 and action='booking.cancelled' and target_id=$2", [f.h.orgA.id, b.id]))
        .rows[0].n,
      1,
    );
    assert.equal(await offered(f), true);
  } finally {
    await f.close();
  }
});

test("a taken slot or a bad time refuses the confirm and leaves the item open with no new booking", async () => {
  const f = await bookingFixture();
  try {
    const other = (await post(f, f.h.alice, "/contacts", { name: "Tetamu Lain", phone: null, preferredLanguage: "ms" })).body.data;
    const taken = (await post(f, f.h.alice, "/bookings", { ...f.input, contactId: other.id })).body.data;
    assert.equal((await post(f, f.h.alice, `/bookings/${taken.id}/confirm`, { expectedRevision: 1 })).status, 200);
    const { followUp } = await callItem(f, f.contact.id, "booking", bookingDetails(f));
    const res = await post(f, f.h.staff, `/follow-ups/${followUp.id}/confirm-booking`, { expectedRevision: 1 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "SLOT_UNAVAILABLE");
    assert.equal((await item(f, followUp.id)).state, "open");
    assert.equal((await bookingRows(f)).length, 1);

    const past = new Date(Math.floor((Date.now() - 3600000) / 900000) * 900000).toISOString();
    const soon = new Date(Math.floor((Date.now() + 600000) / 900000) * 900000).toISOString();
    for (const startAt of [past, soon]) {
      const bad = await callItem(f, f.contact.id, "booking", bookingDetails(f, startAt));
      const r = await post(f, f.h.staff, `/follow-ups/${bad.followUp.id}/confirm-booking`, { expectedRevision: 1 });
      assert.equal(r.status, 422, startAt);
      assert.equal(r.body.error.code, "INVALID_BOOKING_TIME");
      assert.equal((await item(f, bad.followUp.id)).state, "open");
    }
    assert.equal((await bookingRows(f)).length, 1);
  } finally {
    await f.close();
  }
});

test("confirm refuses an item with no contact, a non-booking item and a stale revision", async () => {
  const f = await bookingFixture();
  try {
    const nobody = await callItem(f, null, "booking", bookingDetails(f));
    const r = await post(f, f.h.staff, `/follow-ups/${nobody.followUp.id}/confirm-booking`, { expectedRevision: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, "CONTACT_REQUIRED");
    const message = await callItem(f, f.contact.id, "message", { text: "Sila telefon semula." });
    const m = await post(f, f.h.staff, `/follow-ups/${message.followUp.id}/confirm-booking`, { expectedRevision: 1 });
    assert.equal(m.status, 422);
    assert.equal(m.body.error.code, "INVALID_STATE");
    const booking = await callItem(f, f.contact.id, "booking", bookingDetails(f));
    const stale = await post(f, f.h.staff, `/follow-ups/${booking.followUp.id}/confirm-booking`, { expectedRevision: 2 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "CONFLICT");
    assert.equal((await bookingRows(f)).length, 0);
  } finally {
    await f.close();
  }
});

test("close done on a booking item needs the confirm; dismissed declines it", async () => {
  const f = await bookingFixture();
  try {
    const { followUp } = await callItem(f, f.contact.id, "booking", bookingDetails(f));
    const done = await post(f, f.h.staff, `/follow-ups/${followUp.id}/close`, { expectedRevision: 1, state: "done" });
    assert.equal(done.status, 409);
    assert.equal(done.body.error.code, "BOOKING_CONFIRM_REQUIRED");
    const declined = await post(f, f.h.staff, `/follow-ups/${followUp.id}/close`, { expectedRevision: 1, state: "dismissed" });
    assert.equal(declined.status, 200);
    assert.equal(declined.body.data.state, "dismissed");
    assert.equal((await bookingRows(f)).length, 0);
  } finally {
    await f.close();
  }
});

test("reopen leaves alone a booking that is not this item's contact's", async () => {
  const f = await bookingFixture();
  try {
    const other = (await post(f, f.h.alice, "/contacts", { name: "Tetamu Lain", phone: null, preferredLanguage: "ms" })).body.data;
    const theirs = (await post(f, f.h.alice, "/bookings", { ...f.input, contactId: other.id })).body.data;
    assert.equal((await post(f, f.h.alice, `/bookings/${theirs.id}/confirm`, { expectedRevision: 1 })).status, 200);
    const { followUp } = await callItem(f, f.contact.id, "booking", bookingDetails(f));
    // Closed straight through the database function, as the owner, with a
    // booking that belongs to another contact.
    await f.h.sqlAsApp(f.h.alice, f.h.orgA.id, (tx) =>
      tx.query("select app_private.follow_up_close($1,1,'done',$2)", [followUp.id, theirs.id]),
    );
    const re = await post(f, f.h.alice, `/follow-ups/${followUp.id}/reopen`, { expectedRevision: 2 });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.equal(re.body.data.state, "open");
    const b = (await f.h.cleanup.query("select status,revision from app.booking where id=$1", [theirs.id])).rows[0];
    assert.equal(b.status, "confirmed");
    assert.equal(b.revision, 2);
  } finally {
    await f.close();
  }
});

test("call detail gives every role the follow-ups; only managers get the turns", async () => {
  const f = await bookingFixture();
  try {
    const { callId, followUp } = await callItem(f, f.contact.id, "message", { text: "Sila telefon semula esok.", phone: fakePhone() });
    const staff = await get(f, f.h.staff, `/calls/${callId}`);
    assert.equal(staff.status, 200, JSON.stringify(staff.body));
    assert.equal(staff.body.data.turns, null);
    assert.equal(staff.body.data.proposals, undefined);
    assert.equal(staff.body.data.followUps.length, 1);
    assert.equal(staff.body.data.followUps[0].id, followUp.id);
    assert.equal(staff.body.data.followUps[0].kind, "message");
    assert.equal(staff.body.data.followUps[0].state, "open");
    assert.equal(staff.body.data.followUps[0].details.text, "Sila telefon semula esok.");
    const alice = await get(f, f.h.alice, `/calls/${callId}`);
    assert.equal(alice.body.data.turns.length, 1);
    assert.equal(alice.body.data.followUps.length, 1);
    assert.equal(alice.body.data.followUps[0].revision, 1);
  } finally {
    await f.close();
  }
});

test("conversation detail shows its follow-ups with the state after a close", async () => {
  const f = await bookingFixture();
  try {
    const { h } = f;
    const phone = fakePhone();
    const channelId = (
      await h.cleanup.query("insert into app.whatsapp_channel(org_id,namespace,location_id,agent_id)values($1,$2,$3,$4)returning id", [
        h.orgA.id,
        h.namespace,
        h.orgA.locationId,
        h.orgA.agentId,
      ])
    ).rows[0].id;
    const contactId = (
      await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,'Pelanggan Contoh',$2)returning id", [h.orgA.id, phone])
    ).rows[0].id;
    const conversationId = (
      await h.cleanup.query("insert into app.conversation(org_id,channel_id,contact_id,wa_id)values($1,$2,$3,$4)returning id", [
        h.orgA.id,
        channelId,
        contactId,
        phone.slice(1),
      ])
    ).rows[0].id;
    const turnId = (
      await h.cleanup.query("insert into app.conversation_turn(org_id,conversation_id,input,state,attempt)values($1,$2,'Tolong hubungi saya.','running',1)returning id", [
        h.orgA.id,
        conversationId,
      ])
    ).rows[0].id;
    const proposalId = (
      await h.cleanup.query(
        "insert into app.conversation_proposal(org_id,conversation_id,turn_id,attempt,step,kind,details)values($1,$2,$3,1,0,'message',$4)returning id",
        [h.orgA.id, conversationId, turnId, JSON.stringify({ text: "Tolong hubungi saya petang ini." })],
      )
    ).rows[0].id;
    await h.cleanup.query("update app.conversation_turn set state='completed',completed_at=now() where id=$1", [turnId]);
    const followUp = (await h.cleanup.query("select * from app.follow_up where conversation_proposal_id=$1", [proposalId])).rows[0];
    let d = await get(f, h.staff, `/conversations/${conversationId}`);
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.data.proposals, undefined);
    assert.equal(d.body.data.followUps.length, 1);
    assert.equal(d.body.data.followUps[0].state, "open");
    assert.equal((await post(f, h.staff, `/follow-ups/${followUp.id}/close`, { expectedRevision: 1, state: "done" })).status, 200);
    d = await get(f, h.staff, `/conversations/${conversationId}`);
    assert.equal(d.body.data.followUps[0].state, "done");
    assert.equal(d.body.data.followUps[0].details.text, "Tolong hubungi saya petang ini.");
  } finally {
    await f.close();
  }
});
