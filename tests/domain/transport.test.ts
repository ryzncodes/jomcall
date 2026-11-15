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
import { chooseCopy, errorKey, proxyKey } from "../../web/components/core/error-copy.ts";
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
// A piece of the shared table in state.tsx, as errorText passes it.
const table: Record<string, [string, string]> = {
  FORBIDDEN: ["Your role cannot make this change.", "Peranan anda tidak dibenarkan membuat perubahan ini."],
  CONFLICT: [
    "This record changed. Reload and review before saving again. Your input is preserved.",
    "Rekod telah berubah. Muat semula dan semak sebelum menyimpan. Input anda dikekalkan.",
  ],
  OFFLINE: ["Connection interrupted. Your input is preserved.", "Sambungan terputus. Input anda dikekalkan."],
};
// errorText's choice before this branch: its own code, then the table, then
// the code's words.
const before = (e: CoreError): [string, string] =>
  table[e.code] ?? [e.code.replaceAll("_", " "), e.code.replaceAll("_", " ")];
const copyOf = (e: unknown) => chooseCopy(e, errorKey(e), table);
test("an app error keeps the shared text it had before: an unknown code is never reworded by status", () => {
  for (const e of [
    new CoreError("NUMBER_IN_USE", 409),
    new CoreError("BOOKING_CANCELLED", 409),
    new CoreError("PROPOSAL_NOT_READY", 409),
    new CoreError("CSRF_REJECTED", 403),
    new CoreError("WHATSAPP_NOT_CONFIGURED", 503),
    new CoreError("REQUEST_FAILED", 502),
    new CoreError("REQUEST_BLOCKED", 400),
    new CoreError("CONFLICT", 409),
    new CoreError("FORBIDDEN", 403),
  ]) {
    assert.deepEqual(copyOf(e), before(e), e.code);
  }
  assert.deepEqual(copyOf(new CoreError("NUMBER_IN_USE", 409)), ["NUMBER IN USE", "NUMBER IN USE"]);
  assert.deepEqual(copyOf(new CoreError("CSRF_REJECTED", 403)), ["CSRF REJECTED", "CSRF REJECTED"]);
  // No answer at all: the connection sentence, as before.
  assert.deepEqual(copyOf(new TypeError("Failed to fetch")), table.OFFLINE);
});
test("a proxy's HTML 502 reads as the old connection sentence, retryable, in both languages", () => {
  const e = new ProxyError(502);
  assert.deepEqual(copyOf(e), table.OFFLINE);
  for (const status of [0, 200, 408, 429, 500, 503, 504])
    assert.equal(proxyKey(status), "OFFLINE", String(status));
  assert.equal(retryOffered(502, failureOf(e).code), true);
  assert.equal(
    sendFailureText(502, "PROXY", "chunk", en),
    "Sending stopped. Check your connection, then try again.",
  );
  assert.equal(
    sendFailureText(502, "PROXY", "chunk", ms),
    "Muat naik terhenti. Semak sambungan internet anda, kemudian cuba lagi.",
  );
});
test("a proxy's HTML 403 is not 'signed out' or 'record gone': a plain sentence, no Retry", () => {
  for (const status of [401, 403, 404, 410]) {
    assert.equal(proxyKey(status), "REQUEST_BLOCKED", String(status));
    const [enText, msText] = copyOf(new ProxyError(status));
    assert.equal(enText, "The request did not go through. Reload the page and try again.");
    assert.equal(msText, "Permintaan tidak berjaya dihantar. Muat semula halaman dan cuba lagi.");
  }
  assert.equal(retryOffered(403, "PROXY"), false);
  assert.equal(
    sendFailureText(403, "PROXY", "chunk", en),
    "Something went wrong sending this file. Remove it and add it again.",
  );
});
test("a proxy's HTML 413 says too large for the connection, naming no size", () => {
  const enText = "This file could not be sent because it is too large for the connection. Try a smaller file.";
  const msText = "Fail ini tidak dapat dihantar kerana terlalu besar untuk sambungan ini. Cuba fail yang lebih kecil.";
  assert.equal(sendFailureText(413, "PROXY", "chunk", en), enText);
  assert.equal(sendFailureText(413, "PROXY", "create", en), enText);
  assert.equal(sendFailureText(413, "PROXY", "finish", ms), msText);
  assert.doesNotMatch(enText, /\d/);
  assert.equal(retryOffered(413, "PROXY"), false);
  // The app's own refusal still names the 10 MB limit.
  assert.match(sendFailureText(413, "UPLOAD_TOO_LARGE", "create", en), /10 MB/);
  // Elsewhere: a plain sentence by status.
  assert.equal(proxyKey(413), "REQUEST_TOO_LARGE");
  assert.deepEqual(copyOf(new ProxyError(413)), [
    "This is too large to send. Make it smaller and try again.",
    "Ini terlalu besar untuk dihantar. Kurangkan saiznya dan cuba lagi.",
  ]);
});
test("on upload calls the role sentence is only for code FORBIDDEN; any other 403 is the general sentence", () => {
  assert.equal(sendFailureText(403, "FORBIDDEN", "create", en), "Only an owner or admin can add documents.");
  for (const step of ["create", "chunk", "finish"] as const)
    assert.equal(
      sendFailureText(403, "CSRF_REJECTED", step, en),
      "Something went wrong sending this file. Remove it and add it again.",
      step,
    );
  assert.equal(sendFailureText(403, "CSRF_REJECTED", "remove", en), "Could not remove this file. Try again.");
  assert.equal(sendFailureText(403, "CSRF_REJECTED", "paste", en), "Could not add the pasted text. Try again.");
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
