import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
test("test inspection exposes persisted start time and bounded cited snapshot excerpts", async () => {
  const f = await createPhase2Harness();
  try {
    const k = await f.req("POST", `/agents/${f.h.orgA.agentId}/knowledge`, {
      expectedAgentRevision: 1,
      kind: "faq",
      name: "QA source",
      content: "Consultation RM80. ".repeat(150),
    });
    const s = (
      await f.req("POST", "/agent-tests", {
        agentId: f.h.orgA.agentId,
        locationId: f.h.orgA.locationId,
        source: { kind: "draft", expectedRevision: k.body.data.revision },
      })
    ).body.data;
    const citation = s.snapshot_hash.slice(0, 24) + ":0:0";
    await f.h.cleanup.query(
      "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,citations)values($1,$2,$3,'fixture','Price?','completed',$4)",
      [
        f.h.orgA.id,
        s.id,
        randomUUID(),
        JSON.stringify([citation, "unknown-source"]),
      ],
    );
    await f.h.cleanup.query(
      "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,channel,timings,created_at)values($1,$2,$3,'fixture','Spoken?','completed','voice',$4,now()+interval '1 second')",
      [
        f.h.orgA.id,
        s.id,
        randomUUID(),
        JSON.stringify({
          transcriptMs: 420,
          firstSentenceMs: 1300,
          totalMs: 2600,
        }),
      ],
    );
    const result = await f.req("GET", "/agent-tests/" + s.id);
    assert.equal(result.status, 200);
    assert.ok(
      Number.isFinite(Date.parse(result.body.data.turns[0].created_at)),
    );
    assert.equal(result.body.data.turns[0].channel, "text");
    assert.deepEqual(result.body.data.turns[0].timings, {});
    assert.equal(result.body.data.turns[1].channel, "voice");
    assert.deepEqual(result.body.data.turns[1].timings, {
      transcriptMs: 420,
      firstSentenceMs: 1300,
      totalMs: 2600,
    });
    assert.equal(result.body.data.sources.length, 1);
    assert.equal(result.body.data.sources[0].sourceId, citation);
    assert.equal(result.body.data.sources[0].title, "QA source");
    assert.ok(Array.from(result.body.data.sources[0].excerpt).length <= 1200);
  } finally {
    await f.close();
  }
});
test("test inspection returns every turn up to 60, then only the latest 60 in order", async () => {
  const f = await createPhase2Harness();
  try {
    const s = (
      await f.req("POST", "/agent-tests", {
        agentId: f.h.orgA.agentId,
        locationId: f.h.orgA.locationId,
        source: { kind: "draft", expectedRevision: 1 },
      })
    ).body.data;
    const seed = async (count: number) => {
      await f.h.cleanup.query(
        "delete from app.test_turn where org_id=$1 and session_id=$2",
        [f.h.orgA.id, s.id],
      );
      await f.h.cleanup.query(
        "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,channel,created_at) select $1,$2,gen_random_uuid(),'fixture','turn '||lpad(n::text,3,'0'),'completed','voice',now()+n*interval '1 second' from generate_series(1,$3::int) n",
        [f.h.orgA.id, s.id, count],
      );
      const r = await f.req("GET", "/agent-tests/" + s.id);
      assert.equal(r.status, 200);
      return r.body.data.turns.map((t: { input: string }) => t.input);
    };
    const few = await seed(25);
    assert.equal(few.length, 25);
    assert.equal(few[0], "turn 001");
    assert.equal(few[24], "turn 025");
    const many = await seed(65);
    assert.equal(many.length, 60);
    assert.equal(many[0], "turn 006");
    assert.equal(many[59], "turn 065");
    assert.deepEqual(many, [...many].sort());
  } finally {
    await f.close();
  }
});
