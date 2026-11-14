// The frozen catalogue lookup behind real phone calls and WhatsApp turns
// (app_private.agent_call and app_private.whatsapp_work, both through
// app_private.knowledge_lookup). Local database only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { phoneFixture, phoneSettings } from "../helpers/phone.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";
import { buildInboundText, signBody } from "../../packages/whatsapp/src/index.ts";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const secret = "test-app-secret-" + randomUUID();
const waPhone = String(100000000 + Math.floor(Math.random() * 899999999));
const customer = "6011" + String(Math.floor(Math.random() * 9000000) + 1000000);
const rows = [
  { item: "Servis biasa 1.0HP", aliases: ["servis aircond"], priceSen: 8000, stockNote: "ada", attributes: {} },
];
const query = { item: "servis biasa", code: "", fits: "" };

type Fixture = Awaited<ReturnType<typeof phoneFixture>>;

// A published version whose frozen catalogue holds the row above.
const done = new WeakSet<object>();
async function published(f: Fixture) {
  if (done.has(f)) return;
  done.add(f);
  const path = `/agents/${f.h.orgA.agentId}`;
  const draft = (await f.req("GET", `${path}/draft`)).body.data;
  const put = await f.req("PUT", `${path}/draft`, { expectedRevision: draft.revision, settings: phoneSettings() });
  assert.equal(put.status, 200);
  const cat = await f.req("POST", `${path}/catalogue`, {
    expectedAgentRevision: put.body.data.revision,
    status: "confirmed",
    rows,
  });
  assert.equal(cat.status, 200, JSON.stringify(cat.body));
  const rev = (await f.req("GET", `${path}/draft`)).body.data.revision;
  const pub = await f.req("POST", `${path}/publish`, { expectedRevision: rev });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
}

async function liveCall(f: Fixture) {
  await published(f);
  const dialled = await f.addNumber();
  const { result } = await f.ring(dialled);
  assert.equal(result.refusal, null);
  if (result.refusal !== null) throw Error("refused");
  const tokenHash = sha(result.token);
  const env = (
    await f.h.cleanup.query("select app_private.agent_call('turn_begin',$1,$2,$3,null,null,$4) as v", [
      f.h.namespace,
      result.callId,
      tokenHash,
      JSON.stringify({ input: "Berapa harga servis?", clientTurnId: randomUUID() }),
    ])
  ).rows[0].v;
  return { callId: result.callId, tokenHash, turn: env.turn.id as string, lease: env.turn.lease_token as string };
}

const callWork = (f: Fixture, action: string, c: { callId: string; tokenHash: string; turn: string; lease: string }, data: unknown) =>
  f.h.cleanup
    .query("select app_private.agent_call($1,$2,$3,$4,$5,$6,$7) as v", [action, f.h.namespace, c.callId, c.tokenHash, c.turn, c.lease, JSON.stringify(data)])
    .then((r) => r.rows[0].v);

// A WhatsApp turn claimed through the same SQL the worker uses; no worker, no model.
async function liveTurn(f: Fixture) {
  Object.assign(process.env, {
    JOMCALL_WHATSAPP_PROVIDER: "fake",
    WHATSAPP_APP_SECRET: secret,
    WHATSAPP_VERIFY_TOKEN: "verify-token-" + randomUUID(),
  });
  await published(f);
  const saved = await f.req("PUT", "/channels/whatsapp", { phoneNumberId: waPhone, wabaId: "200000001", agentEnabled: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  await f.h.cleanup.query("update app.whatsapp_channel set state='connected' where org_id=$1", [f.h.orgA.id]);
  const raw = JSON.stringify(
    buildInboundText({ phoneNumberId: waPhone, from: customer, name: "Aina Contoh", id: "wamid.IN" + randomUUID(), text: "Berapa harga servis?" }),
  );
  const res = await webhookPost(
    new Request("http://127.0.0.1:4182/api/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signBody(raw, secret) },
      body: raw,
    }),
  );
  assert.equal(res.status, 200);
  const work = async (action: string, id: string | null, lease: string | null, data: unknown = {}) =>
    (await f.h.cleanup.query("select app_private.whatsapp_work($1,$2,$3,$4,$5) as v", [action, f.h.namespace, id, lease, JSON.stringify(data)])).rows[0].v;
  await work("ingest", null, null);
  const claim = await work("turn_claim", null, null);
  assert.ok(claim?.turn, "a turn was claimed");
  return { work, turn: claim.turn.id as string, lease: claim.turn.lease_token as string };
}

async function cleanWhatsApp(f: Fixture) {
  await f.h.cleanup.query("delete from app.whatsapp_event where namespace=$1", [f.h.namespace]);
}

test("a phone turn looks up a frozen catalogue row", async () => {
  const f = await phoneFixture();
  try {
    const c = await liveCall(f);
    const found = await callWork(f, "catalogue", c, query);
    assert.equal(found.length, 1);
    assert.equal(found[0].item, "Servis biasa 1.0HP");
    assert.equal(found[0].price_sen, 8000);
  } finally {
    await f.close();
  }
});

test("a WhatsApp turn looks up a frozen catalogue row", async () => {
  const f = await phoneFixture();
  try {
    const t = await liveTurn(f);
    const found = await t.work("catalogue", t.turn, t.lease, query);
    assert.equal(found.length, 1);
    assert.equal(found[0].item, "Servis biasa 1.0HP");
    assert.equal(found[0].price_sen, 8000);
  } finally {
    await cleanWhatsApp(f);
    await f.close();
  }
});

test("a lookup reads the published set, not later edits", async () => {
  const f = await phoneFixture();
  try {
    const c = await liveCall(f);
    const t = await liveTurn(f);
    const changed = await f.h.cleanup.query(
      "update app.catalogue_row set price_sen=9999 where org_id=$1 and item=$2",
      [f.h.orgA.id, rows[0].item],
    );
    assert.equal(changed.rowCount, 1);
    assert.equal((await callWork(f, "catalogue", c, query))[0].price_sen, 8000);
    assert.equal((await t.work("catalogue", t.turn, t.lease, query))[0].price_sen, 8000);
  } finally {
    await cleanWhatsApp(f);
    await f.close();
  }
});

test("another organization's call or turn is refused and returns no rows", async () => {
  const f = await phoneFixture();
  try {
    const a = await liveCall(f);
    const t = await liveTurn(f);
    // Organization B has a real running call and turn of its own.
    const org = f.h.orgB;
    const bHash = sha("b-token-" + randomUUID());
    const bCall = (
      await f.h.cleanup.query(
        `insert into app.call(org_id,namespace,location_id,agent_id,snapshot,dialled_e164,sip_call_id,room,participant_identity,token_hash)
         values($1,$2,$3,$4,$5,'+60112223333','SCL_'||gen_random_uuid(),'room-b','sip_b',$6)returning id`,
        [org.id, f.h.namespace, org.locationId, org.agentId, JSON.stringify({ catalogue: { setId: null } }), bHash],
      )
    ).rows[0].id;
    const bLease = randomUUID();
    const bTurn = (
      await f.h.cleanup.query(
        "insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)values($1,$2,$3,'Test','running',$4,now()+interval '60 seconds')returning id",
        [org.id, bCall, randomUUID(), bLease],
      )
    ).rows[0].id;
    const b = { callId: bCall as string, tokenHash: bHash, turn: bTurn as string, lease: bLease };
    // A's call with B's turn, and B's call with A's token: nothing is read.
    assert.equal(await callWork(f, "catalogue", { ...a, turn: b.turn, lease: b.lease }, query), null);
    await assert.rejects(callWork(f, "catalogue", { ...b, tokenHash: a.tokenHash }, query), /VOICE_UNAUTHORIZED/);
    // B's own call whose snapshot names A's set still cannot read A's rows.
    await f.h.cleanup.query("update app.call set snapshot=$2 where id=$1", [
      b.callId,
      JSON.stringify({
        catalogue: {
          setId: (await f.h.cleanup.query("select snapshot->'catalogue'->>'setId' as s from app.call where id=$1", [a.callId])).rows[0].s,
        },
      }),
    ]);
    assert.deepEqual(await callWork(f, "catalogue", b, query), []);
    // WhatsApp: a turn is reached only with its own id and lease.
    assert.equal(await t.work("catalogue", t.turn, randomUUID(), query), null);
    assert.equal(await t.work("catalogue", randomUUID(), t.lease, query), null);
  } finally {
    await cleanWhatsApp(f);
    await f.close();
  }
});

test("recording a lookup_catalogue tool step is accepted on both channels", async () => {
  const f = await phoneFixture();
  try {
    const c = await liveCall(f);
    const t = await liveTurn(f);
    const step = (name: string) => ({ step: 0, call: { name, args: {} }, effect: { kind: "answer" } });
    const ok = await callWork(f, "record", c, step("lookup_catalogue"));
    assert.ok(ok);
    await assert.rejects(callWork(f, "record", c, { ...step("delete_everything"), step: 1 }), /INVALID_TOOL/);
    assert.ok(await t.work("turn_record", t.turn, t.lease, step("lookup_catalogue")));
    await assert.rejects(t.work("turn_record", t.turn, t.lease, { ...step("delete_everything"), step: 1 }), /INVALID_TOOL/);
  } finally {
    await cleanWhatsApp(f);
    await f.close();
  }
});

test("agent_knowledge results are unchanged", async () => {
  const f = await phoneFixture();
  try {
    const path = `/agents/${f.h.orgA.agentId}`;
    const draft = (await f.req("GET", `${path}/draft`)).body.data;
    const put = await f.req("PUT", `${path}/draft`, { expectedRevision: draft.revision, settings: phoneSettings() });
    const cat = await f.req("POST", `${path}/catalogue`, { expectedAgentRevision: put.body.data.revision, status: "confirmed", rows });
    assert.equal(cat.status, 200);
    const rev = (await f.req("GET", `${path}/draft`)).body.data.revision;
    const session = (
      await f.req("POST", "/agent-tests", {
        agentId: f.h.orgA.agentId,
        locationId: f.h.orgA.locationId,
        source: { kind: "draft", expectedRevision: rev },
      })
    ).body.data;
    const lease = randomUUID();
    const turn = (
      await f.h.cleanup.query(
        "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,lease_token,lease_until)values($1,$2,$3,'fixture','Test','running',$4,now()+interval '60 seconds')returning id",
        [f.h.orgA.id, session.id, randomUUID(), lease],
      )
    ).rows[0].id;
    const run = async (data: unknown) =>
      (await f.h.cleanup.query("select app_private.agent_knowledge('catalogue',$1,$2,$3,$4) as v", [f.h.namespace, turn, lease, JSON.stringify(data)])).rows[0].v;
    const found = await run(query);
    assert.equal(typeof found[0].updated_at, "string");
    delete found[0].updated_at;
    assert.deepEqual(found, [
      { ordinal: 0, item: "Servis biasa 1.0HP", aliases: ["servis aircond"], price_sen: 8000, stock_note: "ada", attributes: {}, match: "trigram", score: 1 },
    ]);
    assert.deepEqual(await run({ item: "timing belt", code: "", fits: "Honda City" }), []);
    await assert.rejects(run({ item: "", code: "", fits: "" }), /INVALID_TOOL/);
  } finally {
    await f.close();
  }
});
