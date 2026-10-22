import test from "node:test";
import assert from "node:assert/strict";
import { createPhase2Harness } from "../helpers/phase2.ts";
test("text sessions freeze draft knowledge, hide snapshots, enforce manager/tenant access and expiry", async () => {
  const f = await createPhase2Harness();
  try {
    const k = await f.req("POST", `/agents/${f.h.orgA.agentId}/knowledge`, {
      expectedAgentRevision: 1,
      kind: "faq",
      name: "Hours",
      content: "Buka Isnin.",
    });
    assert.equal(k.status, 200);
    const input = {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      source: { kind: "draft", expectedRevision: k.body.data.revision },
    };
    const created = await f.req("POST", "/agent-tests", input);
    assert.equal(created.status, 200);
    const s = created.body.data;
    assert.equal(s.snapshot, undefined);
    assert.equal(
      (
        await f.api.request(
          f.h.staff,
          f.h.orgA.id,
          "GET",
          "/api/v1/agent-tests/" + s.id,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.api.request(
          f.h.bob,
          f.h.orgB.id,
          "GET",
          "/api/v1/agent-tests/" + s.id,
        )
      ).status,
      404,
    );
    await f.req("POST", `/agents/${f.h.orgA.agentId}/knowledge`, {
      expectedAgentRevision: k.body.data.revision,
      kind: "faq",
      name: "Changed",
      content: "Buka Ahad.",
    });
    const search = await f.req(
      "GET",
      `/agent-tests/${s.id}/knowledge?query=Isnin`,
    );
    assert.equal(search.body.data.length, 1);
    assert.equal(
      (await f.req("GET", `/agent-tests/${s.id}/knowledge?query=Ahad`)).body
        .data.length,
      0,
    );
    await f.h.cleanup.query(
      "update app.test_session set expires_at=now()-interval '1 second' where id=$1",
      [s.id],
    );
    assert.equal((await f.req("GET", `/agent-tests/${s.id}`)).status, 410);
    assert.equal(
      (await f.req("DELETE", `/agent-tests/${s.id}`, { expectedRevision: 1 }))
        .status,
      200,
    );
  } finally {
    await f.close();
  }
});
