// The contact timeline through the web dispatcher: order and paging across
// kinds, what staff see of a call, the open list, PDPA hiding, cursors and
// tenant isolation. Local database only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";

type Harness = Awaited<ReturnType<typeof createHarness>>;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const fakePhone = () => "+6011" + String(Math.floor(Math.random() * 9000000) + 1000000);
const WORDS = "Rahsia panggilan: sila telefon semula esok.";

async function setup() {
  const h = await createHarness();
  const api = await createApiHarness(h);
  const get = (who: Harness["alice"], org: string, path: string) => api.request(who, org, "GET", "/api/v1" + path);
  const q = (sql: string, values: unknown[] = []) => h.cleanup.query(sql, values);
  return { h, api, get, q, close: async () => { await api.close(); await h.close(); } };
}

async function contact(h: Harness, phone = fakePhone()) {
  return (await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,'Pelanggan Contoh',$2)returning id", [h.orgA.id, phone]))
    .rows[0].id as string;
}

// A call with one completed turn whose message proposal becomes a follow-up.
async function call(h: Harness, contactId: string, at: string) {
  const callId = (
    await h.cleanup.query(
      `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,contact_id,sip_call_id,room,participant_identity,token_hash,started_at)
       values($1,$2,$3,$4,'{}','+60112223333',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',$6,$7)returning id`,
      [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, contactId, sha("token-" + randomUUID()), at],
    )
  ).rows[0].id as string;
  const turnId = (
    await h.cleanup.query(
      "insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)values($1,$2,$3,$4,'running',$5,now()+interval '60 seconds')returning id",
      [h.orgA.id, callId, randomUUID(), WORDS, randomUUID()],
    )
  ).rows[0].id as string;
  await h.cleanup.query("insert into app.call_proposal(org_id,call_id,turn_id,step,kind,details)values($1,$2,$3,0,'message',$4)", [
    h.orgA.id,
    callId,
    turnId,
    JSON.stringify({ text: "Sila telefon semula.", name: "Pelanggan Contoh" }),
  ]);
  await h.cleanup.query("update app.call_turn set state='completed',completed_at=now(),revision=revision+1 where id=$1", [turnId]);
  const followUpId = (await h.cleanup.query("select id from app.follow_up where call_id=$1", [callId])).rows[0].id as string;
  return { callId, followUpId };
}

test("every kind shows newest first; staff get no call words; open list on page one", async () => {
  const { h, get, q, close } = await setup();
  try {
    const id = await contact(h);
    const { callId, followUpId } = await call(h, id, "2026-11-20T09:00:00+08:00");
    await q("update app.follow_up set created_at='2026-11-20T09:05:00+08:00' where id=$1", [followUpId]);
    const channelId = (
      await q("insert into app.whatsapp_channel(org_id,namespace,location_id,agent_id)values($1,$2,$3,$4)returning id", [
        h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId,
      ])
    ).rows[0].id;
    const conversationId = (
      await q("insert into app.conversation(org_id,channel_id,contact_id,wa_id,last_message_at)values($1,$2,$3,'60111111111','2026-11-21T10:00:00+08:00')returning id", [
        h.orgA.id, channelId, id,
      ])
    ).rows[0].id;
    await q("insert into app.message(org_id,conversation_id,direction,author,kind,body,status,created_at)values($1,$2,'inbound','customer','text','Ada slot petang?','received','2026-11-21T10:00:00+08:00')", [
      h.orgA.id, conversationId,
    ]);
    const resourceId = (
      await q("insert into app.booking_resource(org_id,location_id,name,duration_minutes)values($1,$2,'Kerusi 1',30)returning id", [h.orgA.id, h.orgA.locationId])
    ).rows[0].id;
    const bookingId = (
      await q(
        `insert into app.booking(org_id,contact_id,resource_id,location_id,title,start_at,end_at,timezone,status,source,creator_id,created_at)
         values($1,$2,$3,$4,'Potong rambut','2030-01-02T10:00:00+08:00','2030-01-02T10:30:00+08:00','Asia/Kuala_Lumpur','confirmed','staff',$5,'2026-11-22T08:00:00+08:00')returning id`,
        [h.orgA.id, id, resourceId, h.orgA.locationId, h.alice.userId],
      )
    ).rows[0].id;
    const noteId = (
      await q("insert into app.contact_note(org_id,contact_id,text,actor_id,created_at)values($1,$2,'Suka pagi.',$3,'2026-11-23T08:00:00+08:00')returning id", [h.orgA.id, id, h.alice.userId])
    ).rows[0].id;
    const consentId = (
      await q(
        "insert into app.consent_record(org_id,contact_id,channel,purpose,granted,source,evidence,actor_id,created_at)values($1,$2,'whatsapp','service',true,'manual','Setuju di kaunter',$3,'2026-11-24T08:00:00+08:00')returning id",
        [h.orgA.id, id, h.alice.userId],
      )
    ).rows[0].id;

    for (const who of [h.alice, h.staff]) {
      const r = await get(who, h.orgA.id, `/contacts/${id}/timeline`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const t = r.body.data;
      assert.deepEqual(
        t.items.map((e: { kind: string; id: string }) => [e.kind, e.id]),
        [["consent", consentId], ["note", noteId], ["booking", bookingId], ["chat", conversationId], ["follow_up", followUpId], ["call", callId]],
      );
      assert.equal(t.next, null);
      // No role reads what was said on a call here.
      assert.ok(!JSON.stringify(t).includes(WORDS));
      const c = t.items.find((e: { kind: string }) => e.kind === "call");
      assert.deepEqual(Object.keys(c).sort(), ["after_hours", "at", "duration_seconds", "id", "kind", "outcome", "refusal", "state", "transfer_result"]);
      const chat = t.items.find((e: { kind: string }) => e.kind === "chat");
      assert.equal(chat.last_body, "Ada slot petang?");
      assert.equal(chat.last_author, "customer");
      const f = t.items.find((e: { kind: string }) => e.kind === "follow_up");
      assert.equal(f.follow_up_kind, "message");
      assert.equal(f.state, "open");
      assert.equal(f.text, "Sila telefon semula.");
      assert.deepEqual(t.open.map((e: { id: string }) => e.id), [followUpId]);
      assert.equal(t.items.find((e: { kind: string }) => e.kind === "booking").status, "confirmed");
    }

    // Awaiting PDPA deletion: follow-ups hidden, the rest still shown.
    await q("update app.contact set deletion_pending=true where id=$1", [id]);
    const p = (await get(h.alice, h.orgA.id, `/contacts/${id}/timeline`)).body.data;
    assert.ok(!p.items.some((e: { kind: string }) => e.kind === "follow_up"));
    assert.equal(p.items.length, 5);
    assert.deepEqual(p.open, []);
  } finally {
    await close();
  }
});

test("pages across kinds in strict order with no repeats or gaps", async () => {
  const { h, get, q, close } = await setup();
  try {
    const id = await contact(h);
    const resourceId = (
      await q("insert into app.booking_resource(org_id,location_id,name,duration_minutes)values($1,$2,'Kerusi 1',30)returning id", [h.orgA.id, h.orgA.locationId])
    ).rows[0].id;
    // 40 entries over four kinds; every fourth minute repeats a time so
    // ties fall on the page boundary too.
    for (let i = 0; i < 40; i++) {
      const at = new Date(Date.UTC(2026, 10, 1, 0, Math.floor(i / 2))).toISOString();
      const kind = i % 4;
      if (kind === 0) await q("insert into app.contact_note(org_id,contact_id,text,actor_id,created_at)values($1,$2,$3,$5,$4)", [h.orgA.id, id, "Nota " + i, at, h.alice.userId]);
      if (kind === 1)
        await q(
          "insert into app.consent_record(org_id,contact_id,channel,purpose,granted,source,evidence,actor_id,created_at)values($1,$2,'phone','service',true,'manual',$3,$5,$4)",
          [h.orgA.id, id, "Bukti " + i, at, h.alice.userId],
        );
      if (kind === 2)
        await q(
          `insert into app.booking(org_id,contact_id,resource_id,location_id,title,start_at,end_at,timezone,status,source,creator_id,created_at)
           values($1,$2,$3,$4,$5,$6::timestamptz+interval '30 days',$6::timestamptz+interval '30 days 30 minutes','Asia/Kuala_Lumpur','requested','staff',$7,$6)`,
          [h.orgA.id, id, resourceId, h.orgA.locationId, "Janji " + i, at, h.alice.userId],
        );
      if (kind === 3)
        await q(
          `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,contact_id,sip_call_id,room,participant_identity,token_hash,started_at)
           values($1,$2,$3,$4,'{}','+60112223333',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',$6,$7)`,
          [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, id, sha("t" + randomUUID()), at],
        );
    }
    const first = (await get(h.staff, h.orgA.id, `/contacts/${id}/timeline`)).body.data;
    assert.equal(first.items.length, 30);
    assert.ok(first.next);
    const second = (await get(h.staff, h.orgA.id, `/contacts/${id}/timeline?cursor=${first.next}`)).body.data;
    assert.equal(second.items.length, 10);
    assert.equal(second.next, null);
    assert.equal(second.open, null);
    const all = [...first.items, ...second.items];
    assert.equal(new Set(all.map((e: { kind: string; id: string }) => e.kind + e.id)).size, 40);
    assert.deepEqual(new Set(all.map((e: { kind: string }) => e.kind)), new Set(["note", "consent", "booking", "call"]));
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i];
      assert.ok(a.at > b.at || (a.at === b.at && a.id > b.id), `order at ${i}`);
    }
  } finally {
    await close();
  }
});

test("bad cursors, another contact's cursor and another workspace are refused", async () => {
  const { h, get, q, close } = await setup();
  try {
    const id = await contact(h);
    const other = await contact(h);
    for (let i = 0; i < 31; i++)
      await q("insert into app.contact_note(org_id,contact_id,text,actor_id)values($1,$2,$3,$4)", [h.orgA.id, other, "Nota " + i, h.alice.userId]);
    const next = (await get(h.alice, h.orgA.id, `/contacts/${other}/timeline`)).body.data.next;
    assert.ok(next);
    const wrong = await get(h.alice, h.orgA.id, `/contacts/${id}/timeline?cursor=${next}`);
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.error.code, "INVALID_CURSOR");
    const junk = Buffer.from(JSON.stringify([id, "2026-02-31 10:00:00+08", randomUUID()])).toString("base64url");
    assert.equal((await get(h.alice, h.orgA.id, `/contacts/${id}/timeline?cursor=${junk}`)).status, 422);
    assert.equal((await get(h.alice, h.orgA.id, `/contacts/${id}/timeline?cursor=nope`)).status, 422);
    // Bob's workspace cannot see orgA's contact.
    assert.equal((await get(h.bob, h.orgB.id, `/contacts/${id}/timeline`)).status, 404);
    assert.equal((await get(h.alice, h.orgA.id, `/contacts/${randomUUID()}/timeline`)).status, 404);
  } finally {
    await close();
  }
});
