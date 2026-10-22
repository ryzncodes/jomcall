import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("missing or forged browser mutation protection fails", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    for (const headers of [
      { "x-csrf-token": "" },
      { origin: "" },
      { origin: "https://example.invalid" },
    ] as Record<string, string>[])
      assert.equal(
        (
          await api.request(
            h.alice,
            null,
            "POST",
            "/api/auth/logout",
            {},
            headers,
          )
        ).status,
        403,
      );
    assert.equal(
      (
        await api.request(null, null, "POST", "/api/auth/login", {
          email: h.alice.confirmedEmail,
          password: h.alice.password,
          role: "owner",
        })
      ).status,
      422,
    );
    const fresh = await api.request(
      h.alice,
      null,
      "POST",
      "/api/auth/refresh",
      {},
    );
    assert.equal(fresh.status, 200);
    for (const c of fresh.headers.getSetCookie()) assert.match(c, /HttpOnly/);
  } finally {
    await api.close();
    await h.close();
  }
});
