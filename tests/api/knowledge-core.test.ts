import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookingFixture } from "../helpers/booking.ts";
import { AgentRepository } from "../../engine/src/agent/repository.ts";
import { AgentRunner } from "../../engine/src/agent/runner.ts";
import { Engine } from "../../engine/src/engine.ts";
import { submitTurn } from "../../packages/domain/src/agent-test/turns.ts";
import { gapRecord, searchUnits } from "../../packages/domain/src/knowledge/tools.ts";

const settings = {
  name: "Kedai Contoh",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "Hai, Kedai Contoh.",
  instructions: "",
  aiDisclosure: "Saya pembantu AI.",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "",
};
const rows = [
  { item: "Bateri kereta NS60", aliases: ["NS60L", "46B24L", "bateri Myvi"], priceSen: 23000, stockNote: "in stock", attributes: { brand: "Contoh Power", fits: ["Perodua Myvi 2011-2017"] } },
  { item: "Minyak enjin 5W-30 4 liter", aliases: ["engine oil 5w30"], priceSen: 13500, stockNote: "in stock", attributes: { brand: "Contoh Lube" } },
  { item: "Brek pad depan", aliases: ["BP-2201"], priceSen: 8800, stockNote: "call to check", attributes: { fits: ["Proton Saga 2016"] } },
];

async function setup() {
  const f = await bookingFixture();
  const agentPath = `/agents/${f.h.orgA.agentId}`;
  let revision = (await f.req("GET", `${agentPath}/draft`)).body.data.revision;
  const send = async (method: string, path: string, body: Record<string, unknown>) => {
    const r = await f.req(method, agentPath + path, { expectedAgentRevision: revision, ...body });
    if (r.status !== 200) throw Error(`${method} ${path} ${r.status} ${JSON.stringify(r.body)}`);
    if (typeof r.body.data?.revision === "number") revision = r.body.data.revision;
    else revision = (await f.req("GET", `${agentPath}/draft`)).body.data.revision;
    return r.body.data;
  };
  const draft = await f.req("PUT", `${agentPath}/draft`, { expectedRevision: revision, settings });
  assert.equal(draft.status, 200);
  revision = draft.body.data.revision;
  await send("PUT", "/packs", { packs: ["stock-price"] });
  await send("POST", "/facts", { packId: "stock-price", fieldKey: "delivery_options", title: "Delivery", value: "Rider dalam 10 km, RM 8." });
  await send("POST", "/facts", { title: "Parking", value: "Free parking behind the shop." });
  await send("POST", "/rules", { kind: "never", text: "x", packId: "stock-price", packRuleId: "no-diagnosis", enabled: false });
  await send("POST", "/rules", { kind: "never", text: "Never mention competitor prices." });
  await send("POST", "/catalogue", { status: "confirmed", packId: "stock-price", rows });
  const core = await send("POST", "/catalogue", { status: "draft", rows: [{ item: "Tayar draf 195/55" }] });
  // An existing-style free-text item: it keeps working as a free fact.
  await send("POST", "/knowledge", { kind: "faq", name: "Waktu solat", content: "Kedai tutup sebentar untuk solat Jumaat 12:45-14:30." });
  const sync = async () => {
    revision = (await f.req("GET", `${agentPath}/draft`)).body.data.revision;
  };
  return { f, agentPath, send, core, rev: () => revision, sync };
}

async function runningTurn(f: Awaited<ReturnType<typeof bookingFixture>>, revision: number, contactId?: string) {
  const s = (
    await f.req("POST", "/agent-tests", {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      ...(contactId ? { contactId } : {}),
      source: { kind: "draft", expectedRevision: revision },
    })
  ).body.data;
  const turn = (
    await f.h.cleanup.query(
      "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,lease_token,lease_until)values($1,$2,$3,'fixture','Test','running',$4,now()+interval '60 seconds')returning *",
      [f.h.orgA.id, s.id, randomUUID(), randomUUID()],
    )
  ).rows[0];
  return { session: s, turn };
}

test("knowledge core: editing, drafts, publish freezes everything, lookup and gaps", async () => {
  const { f, agentPath, send, core, rev, sync } = await setup();
  const repo = new AgentRepository(f.h.namespace);
  try {
    assert.equal(core.catalogue.total, 4);
    assert.equal(core.catalogue.drafts, 1);
    assert.deepEqual(core.packs, ["stock-price"]);
    // Unknown packs and fields are refused.
    assert.equal((await f.req("PUT", agentPath + "/packs", { expectedAgentRevision: rev(), packs: ["nope"] })).status, 422);
    assert.equal(
      (await f.req("POST", agentPath + "/facts", { expectedAgentRevision: rev(), packId: "stock-price", fieldKey: "nope", title: "x", value: "y" })).status,
      422,
    );

    // Publish freezes packs, confirmed facts, resolved rules and the catalogue (drafts excluded).
    const version = (await f.req("POST", agentPath + "/publish", { expectedRevision: rev() })).body.data;
    const snap = version.snapshot;
    await sync();
    assert.deepEqual(snap.packs, ["stock-price"]);
    assert.equal(snap.facts.length, 2);
    assert.ok(snap.rules.some((r: any) => r.text === "Never mention competitor prices."));
    assert.ok(!snap.rules.some((r: any) => r.ruleId === "no-diagnosis"));
    assert.ok(snap.rules.some((r: any) => r.ruleId === "never-claim-genuine"));
    assert.equal(snap.catalogue.rows, 3);
    const setRows = async () =>
      Number((await f.h.cleanup.query("select count(*) from app.catalogue_set_row where set_id=$1", [snap.catalogue.setId])).rows[0].count);
    assert.equal(await setRows(), 3);
    // Later edits do not touch the published version.
    const live = (await f.req("GET", agentPath + "/core")).body.data;
    await send("DELETE", "/catalogue/" + live.catalogue.rows.find((r: any) => r.status === "confirmed").id, {});
    await send("POST", "/facts", { title: "New fact", value: "After publish." });
    const again = (await f.req("GET", `${agentPath}/versions/${version.id}`)).body.data.snapshot;
    assert.deepEqual(again, snap);
    assert.equal(await setRows(), 3);

    // Confirming drafts makes them live for the next freeze.
    const confirmed = await send("POST", "/confirm", {});
    assert.equal(confirmed.catalogue.drafts, 0);

    // Restore brings the published core back into the draft.
    const restored = await f.req("POST", agentPath + "/restore", { expectedRevision: rev(), versionId: version.id });
    assert.equal(restored.status, 200);
    await sync();
    const back = (await f.req("GET", agentPath + "/core")).body.data;
    assert.equal(back.catalogue.total, 3);
    assert.equal(back.facts.length, 2);
    assert.ok(back.rules.some((r: any) => r.pack_rule_id === "no-diagnosis" && !r.enabled));
    const revision = back.revision;

    // A draft test session freezes the same way and carries hours from the schedule.
    const { session, turn } = await runningTurn(f, revision);
    const stored = (await f.h.cleanup.query("select snapshot from app.test_session where id=$1", [session.id])).rows[0].snapshot;
    assert.equal(stored.catalogue.rows, 3);
    assert.equal(stored.context.schedule.timezone, "Asia/Kuala_Lumpur");
    assert.deepEqual(stored.context.schedule.weekdays[0], [{ start: "09:00", end: "18:00" }]);

    // Catalogue lookup through the agent role, bound to the running turn.
    const k = repo.knowledge({ turn });
    const byCode = await k.catalogue({ item: "", code: "ns-60 l", fits: "" });
    assert.equal(byCode[0].item, "Bateri kereta NS60");
    assert.equal(byCode[0].match, "code");
    assert.equal(byCode[0].score, 1);
    assert.equal((await k.catalogue({ item: "engine oil 5w30", code: "", fits: "" }))[0].item, "Minyak enjin 5W-30 4 liter");
    assert.equal((await k.catalogue({ item: "batteri kreta", code: "", fits: "Myvi" }))[0].item, "Bateri kereta NS60");
    assert.deepEqual(await k.catalogue({ item: "timing belt", code: "", fits: "Honda City" }), []);
    // A turn without a valid lease gets nothing.
    await assert.rejects(repo.knowledge({ turn: { ...turn, lease_token: randomUUID() } }).catalogue({ item: "bateri", code: "", fits: "" }), /TURN_CANCELLED/);

    // Existing free-text knowledge is still found.
    const hits = await searchUnits(stored, undefined, "solat Jumaat");
    assert.equal(hits[0]?.title, "Waktu solat");

    // Gap log: recorded, deduplicated, contact details masked.
    await k.gap(gapRecord("How much is a timing belt? Call me 012-555 0188", "en", "text", "I will ask staff."));
    await k.gap(gapRecord("How much is a timing belt? Call me 012-555 0188", "en", "text", "I will ask staff."));
    let gaps = (await f.req("GET", agentPath + "/gaps")).body.data;
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].ask_count, 2);
    assert.doesNotMatch(gaps[0].question, /555/);
    const resolved = await f.req("POST", `${agentPath}/gaps/${gaps[0].id}/resolve`, {
      as: "fact",
      expectedRevision: gaps[0].revision,
      expectedAgentRevision: revision,
      title: "Timing belt",
      value: "We do not stock timing belts.",
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.data.status, "resolved");
    const facts = (await f.req("GET", agentPath + "/core")).body.data.facts;
    assert.ok(facts.some((x: any) => x.title === "Timing belt" && x.source === "gap"));
    await k.gap(gapRecord("Do you sell tyres?", "en", "voice", "I will ask staff."));
    gaps = (await f.req("GET", agentPath + "/gaps")).body.data;
    const open = gaps.find((g: any) => g.status === "open");
    assert.equal((await f.req("POST", `${agentPath}/gaps/${open.id}/ignore`, { expectedRevision: open.revision })).status, 200);
  } finally {
    await repo.close();
    await f.close();
  }
});

test("knowledge core tables are tenant isolated", async () => {
  const { f, agentPath } = await setup();
  try {
    const tables = ["knowledge_fact", "knowledge_rule", "catalogue_row", "catalogue_set", "catalogue_set_row", "knowledge_unit", "knowledge_gap", "knowledge_gap_ask"];
    // Owner A sees their own rows.
    await f.h.sqlAsApp(f.h.alice, f.h.orgA.id, async (tx: any) => {
      assert.ok(Number((await tx.query("select count(*) from app.knowledge_fact")).rows[0].count) >= 2);
    });
    await f.req("POST", "/agent-tests", { agentId: f.h.orgA.agentId, locationId: f.h.orgA.locationId, source: { kind: "draft", expectedRevision: (await f.req("GET", agentPath + "/draft")).body.data.revision } });
    // Bob, owner of org B, sees none of org A's rows in any new table.
    await f.h.sqlAsApp(f.h.bob, f.h.orgB.id, async (tx: any) => {
      for (const t of tables)
        assert.equal(Number((await tx.query(`select count(*) from app.${t} where org_id=$1`, [f.h.orgA.id])).rows[0].count), 0, t);
      await assert.rejects(
        tx.query("insert into app.knowledge_fact(org_id,agent_id,title,value)values($1,$2,'x','\"y\"')", [f.h.orgA.id, f.h.orgA.agentId]),
      );
    });
    assert.equal(Number((await f.h.cleanup.query("select count(*) from app.catalogue_set_row where org_id=$1", [f.h.orgA.id])).rows[0].count), 3);
    assert.equal((await f.api.request(f.h.bob, f.h.orgB.id, "GET", `/api/v1${agentPath}/core`)).status, 404);
    assert.equal((await f.api.request(f.h.staff, f.h.orgA.id, "GET", `/api/v1${agentPath}/core`)).status, 403);
    assert.equal((await f.api.request(f.h.staff, f.h.orgA.id, "GET", `/api/v1${agentPath}/gaps`)).status, 403);
  } finally {
    await f.close();
  }
});

test("a typed turn calls lookup_catalogue, takes a message and records a gap; export and delete cover it", async () => {
  const { f, rev } = await setup();
  let runner: AgentRunner | undefined;
  let engine: Engine | undefined;
  try {
    const session = (
      await f.req("POST", "/agent-tests", {
        agentId: f.h.orgA.agentId,
        locationId: f.h.orgA.locationId,
        contactId: f.contact.id,
        source: { kind: "draft", expectedRevision: rev() },
      })
    ).body.data;
    await f.h.db.withUserTransaction(f.h.alice, f.h.orgA.id, (tx, ctx) =>
      submitTurn(
        tx,
        ctx,
        session.id,
        { text: "Ada timing belt Honda City 2012? Nombor saya 012-555 0177", expectedSessionRevision: 1, clientTurnId: randomUUID() },
        randomUUID(),
        { configured: true, available: true, modelDigest: "a".repeat(64), reason: null },
      ),
    );
    const prompts: string[] = [];
    const decisions: unknown[] = [
      { kind: "tool", call: { name: "lookup_catalogue", args: { item: "timing belt", code: "", fits: "Honda City 2012" } } },
      { kind: "tool", call: { name: "take_message", args: { text: "Customer asks for a timing belt for Honda City 2012.", unanswered: true } } },
      { kind: "answer", text: "Saya akan tanya staf dan mereka akan hubungi anda.", citations: [] },
    ];
    runner = await AgentRunner.create(f.h.namespace, {
      generate: async (input) => {
        assert.equal(input.decision, "core");
        prompts.push(input.messages[0].content);
        return decisions.shift() as never;
      },
    }, null);
    await runner.tick();
    const turn = (await f.h.cleanup.query("select state,error_code,answer from app.test_turn where session_id=$1", [session.id])).rows[0];
    assert.equal(turn.state, "completed", turn.error_code);
    assert.match(prompts[0], /RULES \(/);
    assert.match(prompts[0], /BUSINESS FACTS/);
    assert.match(prompts[0], /Opening hours \(Asia\/Kuala_Lumpur\)/);
    const steps = (await f.h.cleanup.query("select tool,result from app.test_tool_step where session_id=$1 order by step", [session.id])).rows;
    assert.deepEqual(steps.map((s) => s.tool), ["lookup_catalogue", "take_message"]);
    assert.equal(steps[0].result.found, false);
    const asks = (await f.h.cleanup.query("select question,contact_id,channel from app.knowledge_gap_ask where org_id=$1", [f.h.orgA.id])).rows;
    assert.equal(asks.length, 1);
    assert.equal(asks[0].contact_id, f.contact.id);
    assert.doesNotMatch(asks[0].question, /555/);

    // Export includes the contact's gap asks.
    const ex = (await f.req("POST", `/contacts/${f.contact.id}/export`, { expectedRevision: 1 })).body.data;
    engine = await Engine.create(f.h.namespace);
    await engine.tick();
    const download = await f.req("GET", `/jobs/${ex.id}/download`);
    assert.equal(download.status, 200);
    assert.equal(download.body.knowledgeGaps.length, 1);
    // Deletion removes the asks, and the gap with no asks left.
    const del = await f.req("POST", `/contacts/${f.contact.id}/deletion`, { expectedRevision: 1 });
    assert.equal(del.status, 200);
    await engine.tick();
    assert.equal(Number((await f.h.cleanup.query("select count(*) from app.knowledge_gap_ask where org_id=$1", [f.h.orgA.id])).rows[0].count), 0);
    assert.equal(Number((await f.h.cleanup.query("select count(*) from app.knowledge_gap where org_id=$1", [f.h.orgA.id])).rows[0].count), 0);
  } finally {
    await runner?.close();
    await engine?.close();
    await f.close();
  }
});
