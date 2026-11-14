// The frozen catalogue lookup behind real phone calls and WhatsApp turns
// (app_private.agent_call and app_private.whatsapp_work, both through
// app_private.knowledge_lookup). Local database only; fake names and numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { phoneFixture, phoneSettings } from "../helpers/phone.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";
import { buildInboundText, signBody } from "../../packages/whatsapp/src/index.ts";
import { gapRecord } from "../../packages/domain/src/knowledge/tools.ts";
import { Engine } from "../../engine/src/engine.ts";

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
  const env = {
    JOMCALL_WHATSAPP_PROVIDER: "fake",
    WHATSAPP_APP_SECRET: secret,
    WHATSAPP_VERIFY_TOKEN: "verify-token-" + randomUUID(),
  };
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await liveTurnInner(f);
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function liveTurnInner(f: Fixture) {
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

test("another organization's call is refused, and an unknown WhatsApp turn id or lease returns nothing", async () => {
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
    // WhatsApp: a turn is reached only with its own id and lease (an unknown
    // turn id or an unknown lease finds nothing).
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

const embedQuery = { model: "no-such-model", vector: "[" + Array(768).fill(0).join(",") + "]", hashes: [] as string[] };

test("a unit lookup with a model that has no embeddings returns nothing on every path", async () => {
  const f = await phoneFixture();
  try {
    const c = await liveCall(f);
    const t = await liveTurn(f);
    assert.deepEqual(await callWork(f, "units", c, embedQuery), []);
    assert.deepEqual(await t.work("units", t.turn, t.lease, embedQuery), []);
    // agent_knowledge (browser path)
    const path = `/agents/${f.h.orgA.agentId}`;
    const rev = (await f.req("GET", `${path}/draft`)).body.data.revision;
    const session = (
      await f.req("POST", "/agent-tests", { agentId: f.h.orgA.agentId, locationId: f.h.orgA.locationId, source: { kind: "draft", expectedRevision: rev } })
    ).body.data;
    const lease = randomUUID();
    const turn = (
      await f.h.cleanup.query(
        "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,lease_token,lease_until)values($1,$2,$3,'fixture','Test','running',$4,now()+interval '60 seconds')returning id",
        [f.h.orgA.id, session.id, randomUUID(), lease],
      )
    ).rows[0].id;
    const r = (await f.h.cleanup.query("select app_private.agent_knowledge('units',$1,$2,$3,$4) as v", [f.h.namespace, turn, lease, JSON.stringify(embedQuery)])).rows[0].v;
    assert.deepEqual(r, []);
  } finally {
    await cleanWhatsApp(f);
    await f.close();
  }
});

test("a call whose snapshot has no catalogue set gets an empty result", async () => {
  const f = await phoneFixture();
  try {
    // Published with no catalogue, so the frozen snapshot has setId null.
    await f.publish();
    const dialled = await f.addNumber();
    const { result } = await f.ring(dialled);
    if (result.refusal !== null) throw Error("refused");
    const tokenHash = sha(result.token);
    const snap = (await f.h.cleanup.query("select snapshot->'catalogue'->>'setId' as s from app.call where id=$1", [result.callId])).rows[0].s;
    assert.equal(snap, null);
    const env = (
      await f.h.cleanup.query("select app_private.agent_call('turn_begin',$1,$2,$3,null,null,$4) as v", [
        f.h.namespace,
        result.callId,
        tokenHash,
        JSON.stringify({ input: "Berapa harga servis?", clientTurnId: randomUUID() }),
      ])
    ).rows[0].v;
    const c = { callId: result.callId, tokenHash, turn: env.turn.id as string, lease: env.turn.lease_token as string };
    assert.deepEqual(await callWork(f, "catalogue", c, query), []);
  } finally {
    await f.close();
  }
});

// Gap log on phone and WhatsApp.
const gapData = (over: Record<string, unknown> = {}) => ({
  ...gapRecord("Ada jual tayar?", "ms", "phone", "Saya akan tanya staf."),
  ...over,
});
const asks = async (f: Fixture) =>
  (await f.h.cleanup.query("select question,contact_id,session_id,call_id,conversation_id,channel from app.knowledge_gap_ask where org_id=$1 order by asked_at,id", [f.h.orgA.id])).rows;

test("a phone gap is stored against the call", async () => {
  const f = await phoneFixture();
  try {
    const c = await liveCall(f);
    const r = await callWork(f, "gap", c, gapData());
    assert.ok(r.id);
    const rows = await asks(f);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].call_id, c.callId);
    assert.equal(rows[0].session_id, null);
    assert.equal(rows[0].conversation_id, null);
    assert.equal(rows[0].channel, "phone");
    await assert.rejects(callWork(f, "gap", c, gapData({ channel: "whatsapp" })), /INVALID_GAP/);
    await assert.rejects(callWork(f, "gap", c, gapData({ key: "nope" })), /INVALID_GAP/);
  } finally {
    await f.close();
  }
});

test("a WhatsApp gap masks contact details exactly as the browser path does", async () => {
  const f = await phoneFixture();
  try {
    const t = await liveTurn(f);
    const text = "boleh call saya 0123456789 nama Ali";
    const wa = gapRecord(text, "ms", "whatsapp", "Saya akan tanya staf.");
    assert.doesNotMatch(wa.question, /0123456789/);
    const r = await t.work("gap", t.turn, t.lease, wa);
    assert.ok(r.id);
    // The same string through the browser path, via the same gapRecord.
    const path = `/agents/${f.h.orgA.agentId}`;
    const rev = (await f.req("GET", `${path}/draft`)).body.data.revision;
    const session = (
      await f.req("POST", "/agent-tests", { agentId: f.h.orgA.agentId, locationId: f.h.orgA.locationId, source: { kind: "draft", expectedRevision: rev } })
    ).body.data;
    const lease = randomUUID();
    const turn = (
      await f.h.cleanup.query(
        "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,lease_token,lease_until)values($1,$2,$3,'fixture','Test','running',$4,now()+interval '60 seconds')returning id",
        [f.h.orgA.id, session.id, randomUUID(), lease],
      )
    ).rows[0].id;
    await f.h.cleanup.query("select app_private.agent_knowledge('gap',$1,$2,$3,$4)", [
      f.h.namespace, turn, lease, JSON.stringify(gapRecord(text, "ms", "text", "x")),
    ]);
    const rows = await asks(f);
    const wRow = rows.find((x) => x.channel === "whatsapp");
    const bRow = rows.find((x) => x.channel === "text");
    assert.ok(wRow && bRow);
    assert.equal(wRow.question, bRow.question);
    assert.doesNotMatch(wRow.question, /0123456789/);
    assert.ok(wRow.conversation_id);
    assert.ok(wRow.contact_id);
    await assert.rejects(t.work("gap", t.turn, t.lease, { ...wa, channel: "phone" }), /INVALID_GAP/);
    assert.equal(await t.work("gap", t.turn, randomUUID(), wa), null);
  } finally {
    await cleanWhatsApp(f);
    await f.close();
  }
});

test("contact export and delete cover channel gaps", async () => {
  const f = await phoneFixture();
  let engine: Engine | undefined;
  try {
    const t = await liveTurn(f);
    await t.work("gap", t.turn, t.lease, gapRecord("Ada jual tayar?", "ms", "whatsapp", "Saya akan tanya staf."));
    const row = (await asks(f))[0];
    assert.ok(row.contact_id);
    const rev = (await f.h.cleanup.query("select revision from app.contact where id=$1", [row.contact_id])).rows[0].revision;
    const ex = (await f.req("POST", `/contacts/${row.contact_id}/export`, { expectedRevision: rev })).body.data;
    engine = await Engine.create(f.h.namespace);
    await engine.tick();
    const download = await f.req("GET", `/jobs/${ex.id}/download`);
    assert.equal(download.status, 200);
    assert.equal(download.body.knowledgeGaps.length, 1);
    assert.equal(download.body.knowledgeGaps[0].channel, "whatsapp");
    const del = await f.req("POST", `/contacts/${row.contact_id}/deletion`, { expectedRevision: rev });
    assert.equal(del.status, 200);
    await engine.tick();
    assert.equal((await asks(f)).length, 0);
    assert.equal(Number((await f.h.cleanup.query("select count(*) from app.knowledge_gap where org_id=$1", [f.h.orgA.id])).rows[0].count), 0);
  } finally {
    await engine?.close();
    await cleanWhatsApp(f);
    await f.close();
  }
});

test("an ask needs at most one parent, and a phone or WhatsApp ask needs its own", async () => {
  const f = await phoneFixture();
  try {
    const c = await liveCall(f);
    const t = await liveTurn(f);
    await callWork(f, "gap", c, gapData());
    await t.work("gap", t.turn, t.lease, gapRecord("Soalan lain", "ms", "whatsapp", ""));
    const [a, w] = await asks(f);
    const gapId = (await f.h.cleanup.query("select gap_id from app.knowledge_gap_ask where call_id=$1", [a.call_id])).rows[0].gap_id;
    const ins = (cols: string, vals: unknown[]) =>
      f.h.cleanup.query(`insert into app.knowledge_gap_ask(org_id,gap_id,question,language,channel,${cols})values($1,$2,'q','ms',$3,${vals.slice(3).map((_, i) => "$" + (i + 4)).join(",")})`, vals as never);
    // Two parents.
    await assert.rejects(ins("call_id,conversation_id", [f.h.orgA.id, gapId, "phone", a.call_id, w.conversation_id]), /knowledge_gap_ask_one_parent/);
    // A phone ask with no call, and a WhatsApp ask with no conversation.
    await assert.rejects(ins("contact_id", [f.h.orgA.id, gapId, "phone", null]), /knowledge_gap_ask_one_parent/);
    await assert.rejects(ins("contact_id", [f.h.orgA.id, gapId, "whatsapp", null]), /knowledge_gap_ask_one_parent/);
    // A browser channel may not carry a call.
    await assert.rejects(ins("call_id", [f.h.orgA.id, gapId, "text", a.call_id]), /knowledge_gap_ask_one_parent/);
  } finally {
    await cleanWhatsApp(f);
    await f.close();
  }
});
