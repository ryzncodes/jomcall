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
    const result = await f.req("GET", "/agent-tests/" + s.id);
    assert.equal(result.status, 200);
    assert.ok(
      Number.isFinite(Date.parse(result.body.data.turns[0].created_at)),
    );
    assert.equal(result.body.data.sources.length, 1);
    assert.equal(result.body.data.sources[0].sourceId, citation);
    assert.equal(result.body.data.sources[0].title, "QA source");
    assert.ok(Array.from(result.body.data.sources[0].excerpt).length <= 1200);
  } finally {
    await f.close();
  }
});
