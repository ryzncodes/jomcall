import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("agent saves conflict, publishing deduplicates and history stays immutable", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const path = "/api/v1/agents/" + h.orgA.agentId;
    const initial = await api.request(
      h.alice,
      h.orgA.id,
      "GET",
      path + "/draft",
    );
    assert.equal(initial.status, 200);
    const settings = {
      ...initial.body.data.draft,
      aiDisclosure: "Saya pembantu AI.",
      greeting: "Hello from our sample studio",
    };
    const saved = await api.request(
      h.alice,
      h.orgA.id,
      "PUT",
      path + "/draft",
      { expectedRevision: 1, settings },
    );
    assert.equal(saved.status, 200);
    assert.equal(
      (
        await api.request(h.alice, h.orgA.id, "PUT", path + "/draft", {
          expectedRevision: 1,
          settings,
        })
      ).status,
      409,
    );
    const key = randomUUID();
    const publish = () =>
      api.request(
        h.alice,
        h.orgA.id,
        "POST",
        path + "/publish",
        { expectedRevision: 2 },
        { "idempotency-key": key },
      );
    const [a, b] = await Promise.all([publish(), publish()]);
    assert.equal(a.status, 200);
    assert.equal(b.body.data.id, a.body.data.id);
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query("update app.agent_version set snapshot=$1 where id=$2", [
          {},
          a.body.data.id,
        ]),
      ),
      /permission denied|immutable/i,
    );
    assert.equal(
      (await api.request(h.staff, h.orgA.id, "GET", path + "/draft")).status,
      403,
    );
    assert.equal(
      (await api.request(h.bob, h.orgB.id, "GET", path + "/draft")).status,
      404,
    );
    const restored = await api.request(
      h.alice,
      h.orgA.id,
      "POST",
      path + "/restore",
      { versionId: a.body.data.id, expectedRevision: 3 },
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.body.data.revision, 4);
    assert.equal(
      (await api.request(h.alice, h.orgA.id, "GET", path + "/versions")).body
        .data.items.length,
      1,
    );
  } finally {
    await api.close();
    await h.close();
  }
});
