import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpCoreClient } from "../../web/lib/core/client.ts";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";

test("lost mutation responses reuse the same operation; acknowledged new saves get new keys", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  const keys: string[] = [];
  let loseResponse = true;
  const client = new HttpCoreClient({
    orgId: h.orgA.id,
    fetch: async (url, init) => {
      if (url === "/api/auth/csrf")
        return Response.json({ ok: true, data: { token: "test" } });
      const headers = new Headers(init?.headers);
      keys.push(headers.get("idempotency-key")!);
      const result = await api.request(
        h.alice,
        h.orgA.id,
        init!.method!,
        String(url),
        JSON.parse(String(init!.body)),
        { "idempotency-key": keys.at(-1)! },
      );
      assert.equal(result.status, 200);
      if (loseResponse) {
        loseResponse = false;
        throw Error("LOST_RESPONSE_AFTER_COMMIT");
      }
      return Response.json(result.body, { status: result.status });
    },
  });
  try {
    const input = {
      name: "Contoh Retry Network",
      phone: null,
      preferredLanguage: "en" as const,
    };
    await assert.rejects(
      client.execute("createContact", input),
      /LOST_RESPONSE/,
    );
    await client.execute("createContact", input);
    assert.equal(keys[0], keys[1], "uncertain command must retain its key");
    assert.equal(
      (await api.request(h.alice, h.orgA.id, "GET", "/api/v1/contacts")).body
        .data.items.length,
      1,
    );
    await client.execute("createContact", input);
    assert.notEqual(
      keys[1],
      keys[2],
      "acknowledged later save is a new command",
    );
    assert.equal(
      (await api.request(h.alice, h.orgA.id, "GET", "/api/v1/contacts")).body
        .data.items.length,
      2,
    );
  } finally {
    await api.close();
    await h.close();
  }
});
