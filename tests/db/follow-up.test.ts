// The follow-up queue in the database (app.follow_up): creation when an
// agent turn ends, the back-fill, who may close, reopen and assign,
// state mirroring to the source proposal, the chat flag and cascades.
// Local database only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Identity = Harness["alice"];

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const fakePhone = () => "+6011" + String(Math.floor(Math.random() * 9000000) + 1000000);

// A live phone call for a fake caller with one running turn.
async function liveCall(h: Harness) {
  const contactId = (
    await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,'Caller Contoh',$2)returning id", [h.orgA.id, fakePhone()])
  ).rows[0].id as string;
  const tokenHash = sha("token-" + randomUUID());
  const callId = (
    await h.cleanup.query(
      `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,contact_id,sip_call_id,room,participant_identity,token_hash)
       values($1,$2,$3,$4,'{}','+60112223333',$5,'SCL_'||gen_random_uuid(),'room-a','sip_a',$6)returning id`,
      [h.orgA.id, h.namespace, h.orgA.locationId, h.orgA.agentId, contactId, tokenHash],
    )
  ).rows[0].id as string;
  const lease = randomUUID();
  const turnId = (
    await h.cleanup.query(
      "insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)values($1,$2,$3,'Boleh tinggal pesanan?','running',$4,now()+interval '60 seconds')returning id",
      [h.orgA.id, callId, randomUUID(), lease],
    )
  ).rows[0].id as string;
  return { callId, contactId, tokenHash, turnId, lease };
}

async function callProposal(h: Harness, c: { callId: string; turnId: string }, step: number, kind: string, details: unknown) {
  return (
    await h.cleanup.query(
      "insert into app.call_proposal(org_id,call_id,turn_id,step,kind,details)values($1,$2,$3,$4,$5,$6)returning id",
      [h.orgA.id, c.callId, c.turnId, step, kind, JSON.stringify(details)],
    )
  ).rows[0].id as string;
}

const completeCallTurn = (h: Harness, turnId: string) =>
  h.cleanup.query("update app.call_turn set state='completed',completed_at=now(),revision=revision+1 where id=$1", [turnId]);

// A WhatsApp conversation for a fake customer with one running turn.
async function liveChat(h: Harness, attempt = 1) {
  let channelId = (await h.cleanup.query("select id from app.whatsapp_channel where org_id=$1", [h.orgA.id])).rows[0]?.id as string | undefined;
  if (!channelId)
    channelId = (
      await h.cleanup.query("insert into app.whatsapp_channel(org_id,namespace,location_id,agent_id)values($1,$2,$3,$4)returning id", [
        h.orgA.id,
        h.namespace,
        h.orgA.locationId,
        h.orgA.agentId,
      ])
    ).rows[0].id as string;
  const phone = fakePhone();
  const contactId = (
    await h.cleanup.query("insert into app.contact(org_id,name,phone_e164)values($1,'Pelanggan Contoh',$2)returning id", [h.orgA.id, phone])
  ).rows[0].id as string;
  const conversationId = (
    await h.cleanup.query("insert into app.conversation(org_id,channel_id,contact_id,wa_id)values($1,$2,$3,$4)returning id", [
      h.orgA.id,
      channelId,
      contactId,
      phone.slice(1),
    ])
  ).rows[0].id as string;
  const turnId = (
    await h.cleanup.query(
      "insert into app.conversation_turn(org_id,conversation_id,input,state,attempt)values($1,$2,'Boleh book esok?','running',$3)returning id",
      [h.orgA.id, conversationId, attempt],
    )
  ).rows[0].id as string;
  return { channelId, conversationId, contactId, turnId, attempt };
}

async function chatProposal(h: Harness, c: { conversationId: string; turnId: string; attempt: number }, step: number, kind: string, details: unknown, attempt = c.attempt) {
  return (
    await h.cleanup.query(
      "insert into app.conversation_proposal(org_id,conversation_id,turn_id,attempt,step,kind,details)values($1,$2,$3,$4,$5,$6,$7)returning id",
      [h.orgA.id, c.conversationId, c.turnId, attempt, step, kind, JSON.stringify(details)],
    )
  ).rows[0].id as string;
}

const completeChatTurn = (h: Harness, turnId: string) =>
  h.cleanup.query("update app.conversation_turn set state='completed',completed_at=now() where id=$1", [turnId]);

const followUps = (h: Harness, where: string, args: unknown[]) =>
  h.cleanup.query(`select * from app.follow_up where ${where} order by created_at,id`, args).then((r) => r.rows);

const asApp = <T>(h: Harness, who: Identity, org: string, sql: string, args: unknown[] = []) =>
  h.sqlAsApp(who, org, (tx) => tx.query(sql, args)).then((r) => r.rows as T[]);

const close = (h: Harness, who: Identity, id: string, revision: number, state: string, booking: string | null = null) =>
  asApp<{ v: Record<string, unknown> }>(h, who, h.orgA.id, "select app_private.follow_up_close($1,$2,$3,$4) as v", [id, revision, state, booking]).then(
    (r) => r[0].v,
  );
const reopen = (h: Harness, who: Identity, id: string, revision: number) =>
  asApp<{ v: Record<string, unknown> }>(h, who, h.orgA.id, "select app_private.follow_up_reopen($1,$2) as v", [id, revision]).then((r) => r[0].v);
const assign = (h: Harness, who: Identity, id: string, revision: number, assignee: string | null, due: string | null) =>
  asApp<{ v: Record<string, unknown> }>(h, who, h.orgA.id, "select app_private.follow_up_assign($1,$2,$3,$4) as v", [id, revision, assignee, due]).then(
    (r) => r[0].v,
  );

// One completed call turn with a message proposal: the common starting point.
async function callItem(h: Harness, kind = "message", details: unknown = { text: "Sila telefon semula esok." }) {
  const c = await liveCall(h);
  const proposalId = await callProposal(h, c, 0, kind, details);
  await completeCallTurn(h, c.turnId);
  const [f] = await followUps(h, "call_proposal_id=$1", [proposalId]);
  return { ...c, proposalId, followUp: f };
}

test("follow-up created on call turn completion, none while the turn runs", async () => {
  const h = await createHarness();
  try {
    const c = await liveCall(h);
    const details = { text: "Sila telefon semula esok." };
    const proposalId = await callProposal(h, c, 0, "message", details);
    assert.equal((await followUps(h, "call_id=$1", [c.callId])).length, 0);
    await completeCallTurn(h, c.turnId);
    const rows = await followUps(h, "call_id=$1", [c.callId]);
    assert.equal(rows.length, 1);
    const f = rows[0];
    assert.equal(f.source, "call");
    assert.equal(f.kind, "message");
    assert.deepEqual(f.details, details);
    assert.equal(f.state, "open");
    assert.equal(f.contact_id, c.contactId);
    assert.equal(f.call_proposal_id, proposalId);
    assert.equal(f.conversation_proposal_id, null);
    assert.equal(f.namespace, h.namespace);
    assert.equal(f.revision, 1);
    // A later update of the completed turn creates nothing more.
    await h.cleanup.query("update app.call_turn set revision=revision+1 where id=$1", [c.turnId]);
    assert.equal((await followUps(h, "call_id=$1", [c.callId])).length, 1);
  } finally {
    await h.close();
  }
});

test("no follow-up after turn_cancel deletes the proposal", async () => {
  const h = await createHarness();
  try {
    const c = await liveCall(h);
    await callProposal(h, c, 0, "message", { text: "Pesanan yang ditarik balik." });
    await h.cleanup.query("select app_private.agent_call('turn_cancel',$1,$2,$3,$4,$5,'{}')", [h.namespace, c.callId, c.tokenHash, c.turnId, c.lease]);
    assert.equal((await h.cleanup.query("select state from app.call_turn where id=$1", [c.turnId])).rows[0].state, "cancelled");
    assert.equal((await followUps(h, "call_id=$1", [c.callId])).length, 0);
  } finally {
    await h.close();
  }
});

// The owners and admins of org A who get a "new" alert.
const managers = (h: Harness) =>
  h.cleanup
    .query("select user_id from app.member where org_id=$1 and active and role in('owner','admin') order by user_id", [h.orgA.id])
    .then((r) => r.rows.map((x) => x.user_id as string));
const newAlerts = (h: Harness, followUpId: string) =>
  h.cleanup
    .query(
      `select a.user_id,(select count(*)::int from app.outbox o where o.kind='follow_up.alert' and o.resource_id=a.id) as outbox
       from app.follow_up_alert a where a.follow_up_id=$1 and a.reason='new' order by a.user_id`,
      [followUpId],
    )
    .then((r) => r.rows as { user_id: string; outbox: number }[]);
const agentCall = (h: Harness, action: string, c: { callId: string; tokenHash: string; turnId: string; lease: string }, data: unknown) =>
  h.cleanup.query("select app_private.agent_call($1,$2,$3,$4,$5,$6,$7)", [action, h.namespace, c.callId, c.tokenHash, c.turnId, c.lease, JSON.stringify(data)]);

test("a call turn cut off by call_end keeps its proposal as an open follow-up, with the new alert", async () => {
  const h = await createHarness();
  try {
    const c = await liveCall(h);
    const details = { text: "Pesanan sebelum talian terputus." };
    const proposalId = await callProposal(h, c, 0, "message", details);
    await h.cleanup.query("select app_private.agent_call('call_end',$1,$2,$3,null,null,$4)", [
      h.namespace,
      c.callId,
      c.tokenHash,
      JSON.stringify({ reason: "hangup" }),
    ]);
    assert.equal((await h.cleanup.query("select state from app.call_turn where id=$1", [c.turnId])).rows[0].state, "cancelled");
    const rows = await followUps(h, "call_proposal_id=$1", [proposalId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "open");
    assert.equal(rows[0].kind, "message");
    assert.deepEqual(rows[0].details, details);
    const queued = await newAlerts(h, rows[0].id);
    assert.deepEqual(
      queued.map((a) => a.user_id),
      await managers(h),
    );
    assert.ok(queued.length > 0 && queued.every((a) => a.outbox === 1));
  } finally {
    await h.close();
  }
});

test("a call turn ended by turn_fail keeps its proposal as an open follow-up", async () => {
  const h = await createHarness();
  try {
    const c = await liveCall(h);
    const proposalId = await callProposal(h, c, 0, "handoff", { reason: "Mahu bercakap dengan staf." });
    await agentCall(h, "turn_fail", c, { code: "MODEL_FAILED" });
    assert.equal((await h.cleanup.query("select state from app.call_turn where id=$1", [c.turnId])).rows[0].state, "failed");
    const rows = await followUps(h, "call_proposal_id=$1", [proposalId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "open");
    assert.equal(rows[0].kind, "handoff");
    // The turn's state changing again creates nothing more.
    await h.cleanup.query("update app.call_turn set state='cancelled' where id=$1", [c.turnId]);
    assert.equal((await followUps(h, "call_id=$1", [c.callId])).length, 1);
  } finally {
    await h.close();
  }
});

test("back-fill restores follow-ups of cancelled and failed call turns, with no alerts", async () => {
  const h = await createHarness();
  try {
    const ended = await liveCall(h);
    const cut = await callProposal(h, ended, 0, "message", { text: "Terputus" });
    await h.cleanup.query("select app_private.agent_call('call_end',$1,$2,$3,null,null,'{\"reason\":\"hangup\"}')", [
      h.namespace,
      ended.callId,
      ended.tokenHash,
    ]);
    const failing = await liveCall(h);
    const failed = await callProposal(h, failing, 0, "message", { text: "Gagal" });
    await agentCall(h, "turn_fail", failing, {});
    const withdrawn = await liveCall(h);
    const gone = await callProposal(h, withdrawn, 0, "message", { text: "Ditarik balik" });
    await agentCall(h, "turn_cancel", withdrawn, {});
    assert.equal((await h.cleanup.query("select count(*)::int n from app.call_proposal where id=$1", [gone])).rows[0].n, 0);

    await h.cleanup.query("delete from app.follow_up where call_proposal_id = any($1)", [[cut, failed]]);
    await h.cleanup.query("select app_private.follow_up_backfill()");
    for (const id of [cut, failed]) {
      const [f] = await followUps(h, "call_proposal_id=$1", [id]);
      assert.equal(f?.state, "open", id);
      assert.equal((await newAlerts(h, f.id)).length, 0);
    }
  } finally {
    await h.close();
  }
});

test("follow-up created on WhatsApp turn completion, only for the completed attempt", async () => {
  const h = await createHarness();
  try {
    const t = await liveChat(h, 2);
    const failed = await chatProposal(h, t, 0, "message", { text: "Dari cubaan yang gagal." }, 1);
    const details = { resourceId: randomUUID(), startAt: "2026-12-01T02:00:00Z", title: "Servis aircond" };
    const kept = await chatProposal(h, t, 0, "booking", details);
    assert.equal((await followUps(h, "conversation_id=$1", [t.conversationId])).length, 0);
    await completeChatTurn(h, t.turnId);
    const rows = await followUps(h, "conversation_id=$1", [t.conversationId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].conversation_proposal_id, kept);
    assert.notEqual(rows[0].conversation_proposal_id, failed);
    assert.equal(rows[0].source, "whatsapp");
    assert.equal(rows[0].kind, "booking");
    assert.deepEqual(rows[0].details, details);
    assert.equal(rows[0].contact_id, t.contactId);
    assert.equal(rows[0].call_proposal_id, null);
    assert.equal(rows[0].namespace, h.namespace);
    assert.equal(rows[0].state, "open");
  } finally {
    await h.close();
  }
});

test("back-fill restores missing follow-ups of completed turns once, with the proposal's state", async () => {
  const h = await createHarness();
  try {
    const c = await liveCall(h);
    const pending = await callProposal(h, c, 0, "message", { text: "Satu" });
    const done = await callProposal(h, c, 1, "message", { text: "Dua" });
    const dismissed = await callProposal(h, c, 2, "handoff", { reason: "Tiga" });
    await completeCallTurn(h, c.turnId);
    const t = await liveChat(h);
    const chatOpen = await chatProposal(h, t, 0, "message", { text: "Empat" });
    await completeChatTurn(h, t.turnId);
    // A running turn's proposal must stay without a follow-up.
    const running = await liveCall(h);
    const unheard = await callProposal(h, running, 0, "message", { text: "Belum didengar" });

    await h.cleanup.query("delete from app.follow_up where call_proposal_id = any($1) or conversation_proposal_id=$2", [[pending, done, dismissed], chatOpen]);
    await h.cleanup.query("update app.call_proposal set state='done' where id=$1", [done]);
    await h.cleanup.query("update app.call_proposal set state='dismissed' where id=$1", [dismissed]);

    const first = (await h.cleanup.query("select app_private.follow_up_backfill() as n")).rows[0].n;
    assert.ok(first >= 4, `back-filled ${first}`);
    const state = async (where: string, id: string) => (await followUps(h, where, [id]))[0]?.state;
    assert.equal(await state("call_proposal_id=$1", pending), "open");
    assert.equal(await state("call_proposal_id=$1", done), "done");
    assert.equal(await state("call_proposal_id=$1", dismissed), "dismissed");
    assert.equal(await state("conversation_proposal_id=$1", chatOpen), "open");
    assert.equal((await followUps(h, "call_proposal_id=$1", [unheard])).length, 0);
    // A second run adds nothing and leaves the back-fill setting off for the
    // rest of its transaction (later alerts skip inserts only while it is on).
    const tx = await h.cleanup.connect();
    try {
      await tx.query("begin");
      assert.equal((await tx.query("select app_private.follow_up_backfill() as n")).rows[0].n, 0);
      assert.equal((await tx.query("select current_setting('jomcall.follow_up_backfill',true) as s")).rows[0].s, "");
      await tx.query("commit");
    } finally {
      tx.release();
    }
    assert.equal((await followUps(h, "call_id=$1", [c.callId])).length, 3);
    const priv = (
      await h.cleanup.query(
        "select has_function_privilege('jomcall_app','app_private.follow_up_backfill()','execute') as app,(select proowner::regrole::text from pg_proc where oid='app_private.follow_up_backfill()'::regprocedure) as owner",
      )
    ).rows[0];
    assert.equal(priv.app, false);
    assert.equal(priv.owner, "jomcall_jobs");
  } finally {
    await h.close();
  }
});

test("close and reopen by staff mirror the state to the source proposal", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    const closed = await close(h, h.staff, c.followUp.id, 1, "done");
    assert.equal(closed.state, "done");
    assert.equal(closed.closed_by, h.staff.userId);
    assert.ok(closed.closed_at);
    assert.equal(closed.revision, 2);
    assert.equal((await h.cleanup.query("select state from app.call_proposal where id=$1", [c.proposalId])).rows[0].state, "done");
    const opened = await reopen(h, h.staff, c.followUp.id, 2);
    assert.equal(opened.state, "open");
    assert.equal(opened.closed_by, null);
    assert.equal(opened.closed_at, null);
    assert.equal((await h.cleanup.query("select state from app.call_proposal where id=$1", [c.proposalId])).rows[0].state, "pending");
    // Reopening an open item is a conflict.
    await assert.rejects(reopen(h, h.staff, c.followUp.id, 3), /CONFLICT/);

    const t = await liveChat(h);
    const p = await chatProposal(h, t, 0, "message", { text: "Pesanan WhatsApp" });
    await completeChatTurn(h, t.turnId);
    const [w] = await followUps(h, "conversation_proposal_id=$1", [p]);
    await close(h, h.staff, w.id, 1, "dismissed");
    assert.equal((await h.cleanup.query("select state from app.conversation_proposal where id=$1", [p])).rows[0].state, "dismissed");
    await reopen(h, h.staff, w.id, 2);
    assert.equal((await h.cleanup.query("select state from app.conversation_proposal where id=$1", [p])).rows[0].state, "open");
  } finally {
    await h.close();
  }
});

test("staff cannot assign, and nobody writes app.follow_up directly", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    await assert.rejects(assign(h, h.staff, c.followUp.id, 1, h.staff.userId, null), /FORBIDDEN/);
    const [after] = await followUps(h, "id=$1", [c.followUp.id]);
    assert.equal(after.assignee_user_id, null);
    assert.equal(after.revision, 1);
    for (const who of [h.staff, h.alice]) {
      await assert.rejects(asApp(h, who, h.orgA.id, "update app.follow_up set state='done'"), /permission denied/);
      await assert.rejects(
        asApp(h, who, h.orgA.id, "insert into app.follow_up(org_id,namespace,source,kind,details)values($1,'local','call','message','{}')", [h.orgA.id]),
        /permission denied/,
      );
    }
  } finally {
    await h.close();
  }
});

test("staff read follow-ups but still not call proposals", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    assert.equal((await asApp(h, h.staff, h.orgA.id, "select id from app.call_proposal")).length, 0);
    const seen = await asApp<{ id: string }>(h, h.staff, h.orgA.id, "select id from app.follow_up");
    assert.deepEqual(
      seen.map((r) => r.id),
      [c.followUp.id],
    );
  } finally {
    await h.close();
  }
});

test("the web role can no longer update proposals", async () => {
  const h = await createHarness();
  try {
    await callItem(h);
    await assert.rejects(asApp(h, h.alice, h.orgA.id, "update app.call_proposal set state='done'"), /permission denied/);
    await assert.rejects(asApp(h, h.alice, h.orgA.id, "update app.conversation_proposal set state='done'"), /permission denied/);
  } finally {
    await h.close();
  }
});

test("a booking item becomes done only with a booking id", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h, "booking", { resourceId: randomUUID(), startAt: "2026-12-01T02:00:00Z", title: "Servis aircond" });
    await assert.rejects(close(h, h.staff, c.followUp.id, 1, "done"), /BOOKING_CONFIRM_REQUIRED/);
    await assert.rejects(close(h, h.staff, c.followUp.id, 1, "finished"), /INVALID_STATE/);
    const resource = (
      await h.cleanup.query("insert into app.booking_resource(org_id,location_id,name,duration_minutes)values($1,$2,'Juruteknik Contoh',60)returning id", [
        h.orgA.id,
        h.orgA.locationId,
      ])
    ).rows[0].id;
    const booking = (
      await h.cleanup.query(
        `insert into app.booking(org_id,contact_id,resource_id,location_id,title,start_at,end_at,timezone,status,source,creator_id)
         values($1,$2,$3,$4,'Servis aircond','2026-12-01T02:00:00Z','2026-12-01T03:00:00Z','Asia/Kuala_Lumpur','confirmed','staff',$5)returning id`,
        [h.orgA.id, c.contactId, resource, h.orgA.locationId, h.alice.userId],
      )
    ).rows[0].id;
    const closed = await close(h, h.staff, c.followUp.id, 1, "done", booking);
    assert.equal(closed.booking_id, booking);
    const opened = await reopen(h, h.staff, c.followUp.id, 2);
    assert.equal(opened.booking_id, null);
    // Declining needs no booking.
    assert.equal((await close(h, h.staff, c.followUp.id, 3, "dismissed")).state, "dismissed");
    // A booking id is refused on anything but a booking marked done.
    const m = await callItem(h);
    await assert.rejects(close(h, h.staff, m.followUp.id, 1, "done", booking), /INVALID_STATE/);
  } finally {
    await h.close();
  }
});

test("a stale revision or a closed item is a conflict", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    await close(h, h.staff, c.followUp.id, 1, "done");
    await assert.rejects(reopen(h, h.staff, c.followUp.id, 1), /CONFLICT/);
    await assert.rejects(close(h, h.staff, c.followUp.id, 2, "dismissed"), /CONFLICT/);
    await assert.rejects(assign(h, h.alice, c.followUp.id, 2, h.staff.userId, null), /CONFLICT/);
    await assert.rejects(close(h, h.staff, randomUUID(), 1, "done"), /NOT_FOUND/);
  } finally {
    await h.close();
  }
});

test("the chat flag clears when its last open item closes, and only for an item reason", async () => {
  const h = await createHarness();
  try {
    const flagged = async (reason: string) => {
      const t = await liveChat(h);
      const a = await chatProposal(h, t, 0, "message", { text: "Satu" });
      const b = await chatProposal(h, t, 1, "booking", { resourceId: randomUUID(), startAt: "2026-12-01T02:00:00Z", title: "Dua" });
      await h.cleanup.query("update app.conversation set needs_attention=true,attention_reason=$2 where id=$1", [t.conversationId, reason]);
      await completeChatTurn(h, t.turnId);
      const [fa] = await followUps(h, "conversation_proposal_id=$1", [a]);
      const [fb] = await followUps(h, "conversation_proposal_id=$1", [b]);
      return { t, fa, fb };
    };
    const chat = async (id: string) => (await h.cleanup.query("select needs_attention,attention_reason,revision from app.conversation where id=$1", [id])).rows[0];

    const m = await flagged("MESSAGE_LEFT");
    await close(h, h.staff, m.fa.id, 1, "done");
    const still = await chat(m.t.conversationId);
    assert.equal(still.needs_attention, true);
    assert.equal(still.attention_reason, "MESSAGE_LEFT");
    const before = still.revision;
    await close(h, h.staff, m.fb.id, 1, "dismissed");
    const cleared = await chat(m.t.conversationId);
    assert.equal(cleared.needs_attention, false);
    assert.equal(cleared.attention_reason, null);
    assert.equal(cleared.revision, before + 1);

    for (const reason of ["OPTED_OUT", "SEND_FAILED"]) {
      const x = await flagged(reason);
      await close(h, h.staff, x.fa.id, 1, "done");
      await close(h, h.staff, x.fb.id, 1, "dismissed");
      const kept = await chat(x.t.conversationId);
      assert.equal(kept.needs_attention, true, reason);
      assert.equal(kept.attention_reason, reason);
    }
  } finally {
    await h.close();
  }
});

const chatState = async (h: Harness, id: string) =>
  (await h.cleanup.query("select owner,needs_attention,attention_reason,handoff_turn_id,revision from app.conversation where id=$1", [id])).rows[0];

test("the customer's own staff keyword flag stays when an unrelated item closes; the agent's handoff clears it", async () => {
  const h = await createHarness();
  try {
    // A chat with an open message item; then the customer types "staff"
    // (the worker's keyword path: owner staff, HANDOFF_REQUESTED, no item).
    const t = await liveChat(h);
    const m = await chatProposal(h, t, 0, "message", { text: "Sila hubungi saya." });
    await h.cleanup.query("update app.conversation set needs_attention=true,attention_reason='MESSAGE_LEFT' where id=$1", [t.conversationId]);
    await completeChatTurn(h, t.turnId);
    await h.cleanup.query("update app.conversation set owner='staff',needs_attention=true,attention_reason='HANDOFF_REQUESTED' where id=$1", [t.conversationId]);
    const [fm] = await followUps(h, "conversation_proposal_id=$1", [m]);
    await close(h, h.staff, fm.id, 1, "done");
    const kept = await chatState(h, t.conversationId);
    assert.equal(kept.needs_attention, true);
    assert.equal(kept.attention_reason, "HANDOFF_REQUESTED");

    // The agent's handoff (handoff_turn_id set, a handoff item from that
    // turn): closing that item clears the flag.
    const a = await liveChat(h);
    const hp = await chatProposal(h, a, 0, "handoff", { reason: "Mahu staf." });
    await h.cleanup.query("update app.conversation set owner='staff',needs_attention=true,attention_reason='HANDOFF_REQUESTED',handoff_turn_id=$2 where id=$1", [
      a.conversationId,
      a.turnId,
    ]);
    await completeChatTurn(h, a.turnId);
    const [fh] = await followUps(h, "conversation_proposal_id=$1", [hp]);
    const before = (await chatState(h, a.conversationId)).revision;
    await close(h, h.staff, fh.id, 1, "done");
    const cleared = await chatState(h, a.conversationId);
    assert.equal(cleared.needs_attention, false);
    assert.equal(cleared.attention_reason, null);
    assert.equal(cleared.revision, before + 1);
  } finally {
    await h.close();
  }
});

test("reopening a WhatsApp item raises its chat flag again, with the reason for its kind", async () => {
  const h = await createHarness();
  try {
    for (const [kind, details, reason] of [
      ["message", { text: "Satu" }, "MESSAGE_LEFT"],
      ["booking", { resourceId: randomUUID(), startAt: "2026-12-01T02:00:00Z", title: "Dua" }, "BOOKING_PROPOSED"],
      ["handoff", { reason: "Tiga" }, "HANDOFF_REQUESTED"],
    ] as const) {
      const t = await liveChat(h);
      const p = await chatProposal(h, t, 0, kind, details);
      await completeChatTurn(h, t.turnId);
      const [f] = await followUps(h, "conversation_proposal_id=$1", [p]);
      await close(h, h.staff, f.id, 1, "dismissed");
      const quiet = await chatState(h, t.conversationId);
      assert.equal(quiet.needs_attention, false, kind);
      await reopen(h, h.staff, f.id, 2);
      const raised = await chatState(h, t.conversationId);
      assert.equal(raised.needs_attention, true, kind);
      assert.equal(raised.attention_reason, reason);
      assert.equal(raised.revision, quiet.revision + 1);
      // Owner and the handoff turn are the worker's; reopen leaves them.
      assert.equal(raised.owner, quiet.owner);
      assert.equal(raised.handoff_turn_id, quiet.handoff_turn_id);
      if (kind === "handoff") {
        // A handoff item reopened after hand-back (no handoff turn) raises
        // HANDOFF_REQUESTED, and closing it again does not clear it: the
        // flag cannot be told from the customer's own keyword (known limit).
        await close(h, h.staff, f.id, 3, "done");
        assert.equal((await chatState(h, t.conversationId)).attention_reason, "HANDOFF_REQUESTED");
      }
    }
    // A chat already flagged for something else keeps that reason.
    const t = await liveChat(h);
    const p = await chatProposal(h, t, 0, "message", { text: "Empat" });
    await completeChatTurn(h, t.turnId);
    const [f] = await followUps(h, "conversation_proposal_id=$1", [p]);
    await close(h, h.staff, f.id, 1, "done");
    await h.cleanup.query("update app.conversation set needs_attention=true,attention_reason='OPTED_OUT' where id=$1", [t.conversationId]);
    const before = await chatState(h, t.conversationId);
    await reopen(h, h.staff, f.id, 2);
    const after = await chatState(h, t.conversationId);
    assert.equal(after.attention_reason, "OPTED_OUT");
    assert.equal(after.revision, before.revision);
    // A call item reopens without touching any chat.
    const c = await callItem(h);
    await close(h, h.staff, c.followUp.id, 1, "done");
    await reopen(h, h.staff, c.followUp.id, 2);
  } finally {
    await h.close();
  }
});

test("owners assign to an active member; deactivating the member clears open assignments", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    await assert.rejects(assign(h, h.alice, c.followUp.id, 1, h.bob.userId, null), /INVALID_ASSIGNEE/);
    const due = "2026-12-01T01:00:00.000Z";
    const a = await assign(h, h.alice, c.followUp.id, 1, h.staff.userId, due);
    assert.equal(a.assignee_user_id, h.staff.userId);
    assert.equal(new Date(a.due_at as string).toISOString(), due);
    assert.equal(a.assigned_by, h.alice.userId);
    assert.ok(a.assigned_at);
    assert.equal(a.revision, 2);
    await h.cleanup.query("update app.member set active=false where org_id=$1 and user_id=$2", [h.orgA.id, h.staff.userId]);
    const [after] = await followUps(h, "id=$1", [c.followUp.id]);
    assert.equal(after.assignee_user_id, null);
    assert.equal(after.state, "open");
    assert.equal(after.revision, 3);
    // An inactive member cannot be assigned.
    await assert.rejects(assign(h, h.alice, c.followUp.id, 3, h.staff.userId, null), /INVALID_ASSIGNEE/);
    // Unassigning is allowed.
    assert.equal((await assign(h, h.alice, c.followUp.id, 3, null, null)).assignee_user_id, null);
  } finally {
    await h.close();
  }
});

test("deleting the contact or the proposal removes its follow-ups", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    const t = await liveChat(h);
    const p = await chatProposal(h, t, 0, "message", { text: "WhatsApp" });
    await completeChatTurn(h, t.turnId);
    assert.equal((await followUps(h, "contact_id=$1", [t.contactId])).length, 1);
    await h.cleanup.query("delete from app.contact where id=$1", [t.contactId]);
    assert.equal((await followUps(h, "conversation_proposal_id=$1", [p])).length, 0);
    await h.cleanup.query("delete from app.contact where id=$1", [c.contactId]);
    assert.equal((await followUps(h, "id=$1", [c.followUp.id])).length, 0);

    const d = await callItem(h);
    await h.cleanup.query("delete from app.call_proposal where id=$1", [d.proposalId]);
    assert.equal((await followUps(h, "id=$1", [d.followUp.id])).length, 0);
  } finally {
    await h.close();
  }
});

test("another organization sees and changes none of org A's follow-ups", async () => {
  const h = await createHarness();
  try {
    const c = await callItem(h);
    assert.equal((await asApp(h, h.bob, h.orgB.id, "select id from app.follow_up")).length, 0);
    const asBob = (sql: string, args: unknown[]) => asApp(h, h.bob, h.orgB.id, sql, args);
    await assert.rejects(asBob("select app_private.follow_up_close($1,1,'done',null)", [c.followUp.id]), /NOT_FOUND/);
    await assert.rejects(asBob("select app_private.follow_up_reopen($1,1)", [c.followUp.id]), /NOT_FOUND/);
    await assert.rejects(asBob("select app_private.follow_up_assign($1,1,null,null)", [c.followUp.id]), /NOT_FOUND/);
    const [same] = await followUps(h, "id=$1", [c.followUp.id]);
    assert.equal(same.state, "open");
    assert.equal(same.revision, 1);
  } finally {
    await h.close();
  }
});
