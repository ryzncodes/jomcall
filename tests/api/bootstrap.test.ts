import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("workspace writes are idempotent and revision-aware", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const key = randomUUID(),
      body = {
        name: "Example Revision",
        businessType: "other",
        expectedRevision: 1,
      },
      path = `/api/v1/organizations/${h.orgA.id}`;
    const a = await api.request(h.alice, h.orgA.id, "PATCH", path, body, {
      "idempotency-key": key,
    });
    assert.equal(a.status, 200);
    const b = await api.request(h.alice, h.orgA.id, "PATCH", path, body, {
      "idempotency-key": key,
    });
    assert.equal(b.body.data.revision, a.body.data.revision);
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "PATCH",
          path,
          { ...body, name: "Different" },
          { "idempotency-key": key },
        )
      ).status,
      409,
    );
    assert.equal(
      (await api.request(h.staff, h.orgA.id, "PATCH", path, body)).status,
      403,
    );
    assert.equal(
      (await api.request(h.alice, h.orgA.id, "PATCH", path, body)).status,
      409,
    );
  } finally {
    await api.close();
    await h.close();
  }
});
