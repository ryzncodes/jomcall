import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CoreError,
  HttpCoreClient,
  MockCoreClient,
  ProxyError,
  failureOf,
  isResourceUnavailable,
} from "../../web/lib/core/client.ts";
import { statusKey, statusText } from "../../web/components/core/error-copy.ts";
import { retryOffered, sendFailureText } from "../../web/components/core/setup/rules.ts";

const en = (e: string) => e;
const ms = (_e: string, m: string) => m;
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
const htmlClient = (status: number) =>
  new HttpCoreClient({
    orgId: "org-1",
    fetch: async (url) =>
      String(url) === "/api/auth/csrf"
        ? Response.json({ ok: true, data: { token: "csrf-1" } })
        : new Response("<html><body>Error</body></html>", {
            status,
            headers: { "content-type": "text/html" },
          }),
  });
const callsOf = (client: HttpCoreClient) => {
  const input = { id: agent, uploadId: upload, seq: 0 };
  return [
    () => client.putChunk(input, new Blob([new Uint8Array([1])])),
    () => client.getChunk(input),
    () => client.execute("setup", { id: agent }),
    () => client.execute("removeSetupUpload", { id: agent, uploadId: upload }),
  ];
};
test("a non-JSON error body (a proxy's HTML page) is a ProxyError: never a CoreError, never a record that is gone", async () => {
  for (const status of [502, 403, 413, 401, 404, 410]) {
    for (const call of callsOf(htmlClient(status)))
      await assert.rejects(call(), (e: unknown) => {
        assert.ok(e instanceof ProxyError, String(status));
        assert.ok(!(e instanceof CoreError), "not an app error");
        assert.equal(e.status, status);
        assert.equal(isResourceUnavailable(e), false, "records are kept");
        assert.deepEqual(failureOf(e), { status, code: "PROXY" });
        return true;
      });
  }
  // A JSON error from the app itself still may say a record is gone.
  assert.equal(isResourceUnavailable(new CoreError("NOT_FOUND", 404)), true);
});
test("a proxy's HTML 502 reads as the old connection sentence, retryable, in both languages", () => {
  const e = new ProxyError(502);
  assert.equal(statusKey(e.status, true), "OFFLINE");
  for (const status of [0, 200, 408, 429, 500, 503, 504])
    assert.equal(statusKey(status, true), "OFFLINE", String(status));
  assert.equal(retryOffered(502, failureOf(e).code), true);
  assert.equal(
    sendFailureText(502, "PROXY", "chunk", en),
    "Sending stopped. Check your connection, then try again.",
  );
  assert.equal(
    sendFailureText(502, "PROXY", "chunk", ms),
    "Penghantaran terhenti. Semak sambungan anda, kemudian cuba lagi.",
  );
});
test("a proxy's HTML 403 is not 'signed out' or 'record gone': a plain sentence, no Retry", () => {
  assert.equal(statusKey(403, true), "REQUEST_BLOCKED");
  assert.equal(statusKey(401, true), "REQUEST_BLOCKED");
  assert.equal(statusKey(404, true), "REQUEST_BLOCKED");
  const [enText, msText] = statusText("REQUEST_BLOCKED")!;
  assert.match(enText, /did not go through/);
  assert.match(msText, /Permintaan tidak sampai/);
  assert.equal(retryOffered(403, "PROXY"), false);
  assert.equal(
    sendFailureText(403, "PROXY", "chunk", en),
    "Something went wrong sending this file. Remove it and add it again.",
  );
});
test("a proxy's HTML 413 on an upload says the file is too large; elsewhere a plain sentence", () => {
  assert.equal(
    sendFailureText(413, "PROXY", "chunk", en),
    "This file is larger than 10 MB. Split it into smaller files and add them one at a time.",
  );
  assert.equal(
    sendFailureText(413, "PROXY", "create", ms),
    "Fail ini lebih besar daripada 10 MB. Bahagikan kepada fail yang lebih kecil dan tambah satu demi satu.",
  );
  assert.equal(retryOffered(413, "PROXY"), false);
  assert.equal(statusKey(413, true), "REQUEST_TOO_LARGE");
  assert.ok(statusText("REQUEST_TOO_LARGE"));
});
test("an app code no table names is worded by its status, never shown raw", () => {
  const cases: [number | null, string][] = [
    [null, "OFFLINE"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [410, "NOT_FOUND"],
    [409, "CONFLICT"],
    [422, "VALIDATION_ERROR"],
    [413, "REQUEST_TOO_LARGE"],
    [429, "TRY_LATER"],
    [500, "SERVICE_ERROR"],
    [418, "REQUEST_REFUSED"],
  ];
  for (const [status, key] of cases) assert.equal(statusKey(status, false), key, String(status));
  for (const key of ["REQUEST_BLOCKED", "REQUEST_TOO_LARGE", "TRY_LATER", "SERVICE_ERROR", "REQUEST_REFUSED"]) {
    const copy = statusText(key);
    assert.ok(copy, key);
    for (const text of copy) assert.doesNotMatch(text, /[A-Z]{2,}_[A-Z]/, "no raw code");
  }
});
test("create and finish pass their abort signal to the request and the CSRF read", async () => {
  const controller = new AbortController();
  const seen: (AbortSignal | null | undefined)[] = [];
  const client = new HttpCoreClient({
    fetch: async (url, init) => {
      seen.push(init?.signal);
      if (String(url) === "/api/auth/csrf")
        return Response.json({ ok: true, data: { token: "csrf-1" } });
      return Response.json({ ok: true, data: { id: upload } });
    },
  });
  await client.execute("finishSetupUpload", { id: agent, uploadId: upload }, undefined, controller.signal);
  assert.deepEqual(seen, [controller.signal, controller.signal]);
});
test("a chunk PUT passes its abort signal to the request", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | null | undefined;
  const client = new HttpCoreClient({
    fetch: async (url, init) => {
      if (String(url) === "/api/auth/csrf")
        return Response.json({ ok: true, data: { token: "csrf-1" } });
      seen = init?.signal;
      return Response.json({ ok: true, data: { received: 1 } });
    },
  });
  await client.putChunk(
    { id: agent, uploadId: upload, seq: 0 },
    new Blob([new Uint8Array([1])]),
    controller.signal,
  );
  assert.equal(seen, controller.signal);
});
