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

test("a draft test carries live hours; a published test carries the version's", async () => {
  const f = await createPhase2Harness();
  try {
    const agentPath = `/agents/${f.h.orgA.agentId}`;
    const draft = (await f.req("GET", agentPath + "/draft")).body.data;
    const saved = await f.req("PUT", agentPath + "/draft", {
      expectedRevision: draft.revision,
      settings: {
        ...draft.draft,
        aiDisclosure: "Saya pembantu AI.",
        greeting: "Hai.",
      },
    });
    assert.equal(saved.status, 200);
    const stored = async (id: string) =>
      (await f.h.cleanup.query("select snapshot from app.test_session where id=$1", [id])).rows[0].snapshot;
    const started = await f.req("POST", "/agent-tests", {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      source: { kind: "draft", expectedRevision: saved.body.data.revision },
    });
    assert.equal(started.status, 200);
    const s1 = await stored(started.body.data.id);
    assert.equal(s1.hours.length, 1);
    assert.equal(s1.hours[0].locationId, f.h.orgA.locationId);
    assert.deepEqual(s1.hours[0].weekdays[0], [{ start: "09:00", end: "18:00" }]);
    assert.ok(s1.context.schedule);
    const published = await f.req("POST", agentPath + "/publish", { expectedRevision: saved.body.data.revision });
    assert.equal(published.status, 200);
    const sp = `/locations/${f.h.orgA.locationId}/schedule`;
    const cur = (await f.req("GET", sp)).body.data;
    const changed = await f.req("PUT", sp, {
      expectedRevision: cur.revision,
      timezone: "Asia/Kuala_Lumpur",
      weekdays: Array.from({ length: 7 }, () => [{ start: "07:00", end: "11:00" }]),
      closures: [],
    });
    assert.equal(changed.status, 200);
    const fromVersion = await f.req("POST", "/agent-tests", {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      source: { kind: "published", versionId: published.body.data.id },
    });
    assert.equal(fromVersion.status, 200);
    const s2 = await stored(fromVersion.body.data.id);
    assert.deepEqual(s2.hours[0].weekdays[0], [{ start: "09:00", end: "18:00" }]);
    assert.deepEqual(s2.context.schedule.weekdays[0], [{ start: "07:00", end: "11:00" }]);
  } finally {
    await f.close();
  }
});
