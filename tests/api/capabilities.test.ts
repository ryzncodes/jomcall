import { dispatchCore } from "../../web/lib/server/api.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("disabled provider families fail closed; unknown paths and wrong methods are distinct", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    for (const path of [
      "/calls",
      "/inbox/send",
      "/whatsapp/send",
      "/integrations/google",
      "/phone-numbers",
      "/billing/top-up",
      "/payments",
      "/outbound",
      "/admin",
      "/self-host",
      "/test-call",
    ]) {
      const r = await api.request(
        h.alice,
        h.orgA.id,
        "POST",
        "/api/v1" + path,
        {},
      );
      assert.equal(r.status, 503, path);
      assert.equal(r.body.error.code, "CAPABILITY_UNAVAILABLE");
    }
    assert.equal(
      (await api.request(h.alice, h.orgA.id, "GET", "/api/v1/nothing-here"))
        .status,
      404,
    );
    assert.equal(
      (await api.request(h.alice, h.orgA.id, "DELETE", "/api/v1/contacts", {}))
        .status,
      405,
    );
    process.env.JOMCALL_MODE = "mock";
    assert.equal(
      (await dispatchCore(new Request("http://127.0.0.1:4182/api/v1/contacts")))
        .status,
      503,
    );
  } finally {
    process.env.JOMCALL_MODE = "local";
    await api.close();
    await h.close();
  }
});
