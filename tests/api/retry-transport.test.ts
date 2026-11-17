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

test("keepalive reuses the last CSRF token and sets keepalive on the request", async () => {
  let csrfFetches = 0;
  const inits: (RequestInit | undefined)[] = [];
  const client = new HttpCoreClient({
    orgId: "org",
    fetch: async (url, init) => {
      if (url === "/api/auth/csrf") {
        csrfFetches++;
        return Response.json({ ok: true, data: { token: "tok" } });
      }
      inits.push(init);
      return Response.json({ ok: true, data: { id: "c1" } });
    },
  });
  const input = {
    name: "Contoh Keepalive",
    phone: null,
    preferredLanguage: "en" as const,
  };
  // No token fetched yet: keepalive fetches one normally.
  await client.execute("createContact", input, "key-1", undefined, {
    keepalive: true,
  });
  assert.equal(csrfFetches, 1);
  // Token reused now.
  await client.execute("createContact", input, "key-2", undefined, {
    keepalive: true,
  });
  assert.equal(csrfFetches, 1);
  assert.equal(inits[0]?.keepalive, true);
  assert.equal(
    new Headers(inits[1]?.headers).get("x-csrf-token"),
    "tok",
  );
  // Without the option nothing changes: token fetched, no keepalive.
  await client.execute("createContact", input, "key-3");
  assert.equal(csrfFetches, 2);
  assert.equal(inits[2]?.keepalive, undefined);
});
