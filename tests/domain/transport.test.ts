import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CoreError,
  HttpCoreClient,
  MockCoreClient,
} from "../../web/lib/core/client.ts";
import {
  parseMode,
  capabilitiesFor,
} from "../../packages/contracts/src/core.ts";
test("mode is explicit and HTTP failures never fall back to sample data", async () => {
  const storage = new Map<string, string>();
  storage.set(
    "jomcall-preview-crm-v1",
    JSON.stringify({ contacts: [{ id: "sample", name: "Sample" }] }),
  );
  let reads = 0;
  const mock = new MockCoreClient({
    handlers: {
      listContacts: async () => {
        reads++;
        return {
          items: JSON.parse(storage.get("jomcall-preview-crm-v1")!).contacts,
          nextCursor: null,
        };
      },
    },
  });
  assert.equal((await mock.execute("listContacts", {})).items.length, 1);
  const local = new HttpCoreClient({
    fetch: async () => {
      throw Error("offline");
    },
    orgId: "isolated",
  });
  await assert.rejects(local.execute("listContacts", {}), /offline/);
  assert.equal(reads, 1);
  assert.equal(capabilitiesFor("local").whatsappSend, false);
  assert.equal(parseMode(undefined), "mock");
  assert.throws(() => parseMode("production-ish"), /INVALID_MODE/);
});
test("transport invokes fetch without binding it to the client instance", async () => {
  const client = new HttpCoreClient({
    fetch: async function (this: unknown) {
      assert.equal(this, undefined);
      return Response.json({ ok: true, data: { items: [], nextCursor: null } });
    },
  });
  assert.deepEqual(await client.execute("listContacts", {}), {
    items: [],
    nextCursor: null,
  });
});
const agent = "00000000-0000-4000-8000-000000000001";
const upload = "00000000-0000-4000-8000-000000000002";
test("a setup upload chunk is sent as raw bytes and keeps its key when re-sent", async () => {
  const seen: { url: string; init: RequestInit; key: string | null }[] = [];
  let lose = true;
  const client = new HttpCoreClient({
    orgId: "org-1",
    fetch: async (url, init) => {
      if (url === "/api/auth/csrf")
        return Response.json({ ok: true, data: { token: "csrf-1" } });
      const headers = new Headers(init?.headers);
      seen.push({ url: String(url), init: init!, key: headers.get("idempotency-key") });
      assert.equal(headers.get("content-type"), "application/octet-stream");
      assert.equal(headers.get("x-csrf-token"), "csrf-1");
      assert.equal(headers.get("x-organization-id"), "org-1");
      assert.ok(init?.body instanceof Blob);
      if (lose) {
        lose = false;
        throw Error("LOST_RESPONSE");
      }
      return Response.json({ ok: true, data: { received: 3 } });
    },
  });
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const input = { id: agent, uploadId: upload, seq: 1 };
  await assert.rejects(client.putChunk(input, bytes), /LOST_RESPONSE/);
  assert.deepEqual(await client.putChunk(input, bytes), { received: 3 });
  assert.equal(seen[0].url, `/api/v1/agents/${agent}/setup/uploads/${upload}/chunks/1`);
  assert.equal(seen[0].init.method, "PUT");
  assert.match(seen[0].key!, /^[0-9a-f-]{36}$/);
  assert.equal(seen[0].key, seen[1].key, "a re-sent chunk keeps its key");
  // Another chunk, and the same chunk after it was acknowledged, get new keys.
  await client.putChunk({ ...input, seq: 2 }, bytes);
  await client.putChunk(input, bytes);
  assert.notEqual(seen[2].key, seen[1].key);
  assert.notEqual(seen[3].key, seen[1].key);
  await assert.rejects(
    client.putChunk({ ...input, seq: 10 }, bytes),
    /Too big|too_big|less than or equal/i,
  );
});
test("a setup upload chunk is read back as bytes; an error stays a CoreError", async () => {
  const client = new HttpCoreClient({
    orgId: "org-1",
    fetch: async (url, init) => {
      assert.equal(init?.method, undefined);
      assert.equal(new Headers(init?.headers).get("x-organization-id"), "org-1");
      if (String(url).endsWith("/chunks/0"))
        return new Response(new Uint8Array([7, 8, 9]), {
          headers: { "content-type": "application/octet-stream" },
        });
      return Response.json(
        { ok: false, error: { code: "NOT_FOUND" } },
        { status: 404 },
      );
    },
  });
  assert.deepEqual(
    [...(await client.getChunk({ id: agent, uploadId: upload, seq: 0 }))],
    [7, 8, 9],
  );
  await assert.rejects(
    client.getChunk({ id: agent, uploadId: upload, seq: 1 }),
    (e: unknown) => e instanceof CoreError && e.code === "NOT_FOUND" && e.status === 404,
  );
});
