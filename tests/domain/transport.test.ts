import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpCoreClient, MockCoreClient } from "../../web/lib/core/client.ts";
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
