import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("knowledge participates in draft revision and publish requires disclosure", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const path = "/api/v1/agents/" + h.orgA.agentId;
    assert.equal(
      (
        await api.request(h.alice, h.orgA.id, "POST", path + "/publish", {
          expectedRevision: 1,
        })
      ).status,
      422,
    );
    const knowledge = {
      expectedAgentRevision: 1,
      kind: "faq",
      name: "Hours",
      content: "Open by appointment.",
    };
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "POST",
          path + "/knowledge",
          knowledge,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "POST",
          path + "/knowledge",
          knowledge,
        )
      ).status,
      409,
    );
    const list = await api.request(
      h.alice,
      h.orgA.id,
      "GET",
      path + "/knowledge",
    );
    assert.equal(list.body.data.length, 1);
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query("update app.agent set location_id=$1 where id=$2", [
          h.orgB.locationId,
          h.orgA.agentId,
        ]),
      ),
      /foreign key/,
    );
    const archive = await api.request(
      h.alice,
      h.orgA.id,
      "POST",
      `/api/v1/locations/${h.orgA.locationId}/archive`,
      { expectedRevision: 1 },
    );
    assert.equal(archive.status, 409);
  } finally {
    await api.close();
    await h.close();
  }
});
