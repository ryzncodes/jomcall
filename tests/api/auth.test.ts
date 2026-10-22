import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("verified identity, CSRF, local auth logout and no-store", async () => {
  const h = await createHarness();
  const api = await createApiHarness(h);
  try {
    const session = await api.request(h.alice, null, "GET", "/api/v1/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.data.userId, h.alice.userId);
    assert.match(session.headers.get("cache-control") ?? "", /no-store/);
    const denied = await api.request(
      h.alice,
      h.orgA.id,
      "PATCH",
      `/api/v1/organizations/${h.orgA.id}`,
      { name: "Changed", businessType: "other", expectedRevision: 1 },
      { Origin: "https://example.invalid" },
    );
    assert.equal(denied.status, 403);
    const hidden = await api.request(
      h.bob,
      h.orgA.id,
      "GET",
      `/api/v1/organizations/${h.orgA.id}/bootstrap`,
    );
    assert.equal(hidden.status, 404);
    const logout = await api.request(
      h.alice,
      null,
      "POST",
      "/api/auth/logout",
      {},
    );
    assert.equal(logout.status, 200);
    const stale = await api.request(
      h.alice,
      h.orgA.id,
      "GET",
      `/api/v1/organizations/${h.orgA.id}/bootstrap`,
    );
    assert.equal(stale.status, 401);
  } finally {
    await api.close();
    await h.close();
  }
});
