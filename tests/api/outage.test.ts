import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { dispatchCore } from "../../web/lib/server/api.ts";
import { closeServices } from "../../web/lib/server/services.ts";
test("auth transport outage is service unavailable, not a revoked session", async () => {
  const h = await createHarness(),
    original = globalThis.fetch;
  process.env.JOMCALL_MODE = "local";
  try {
    globalThis.fetch = async () => {
      throw new TypeError("LOCAL_TEST_OFFLINE");
    };
    const r = await dispatchCore(
      new Request("http://127.0.0.1:4182/api/v1/session", {
        headers: { cookie: "ca_local_access=" + h.alice.token },
      }),
    );
    assert.equal(r.status, 503);
  } finally {
    globalThis.fetch = original;
    await closeServices();
    await h.close();
  }
});
