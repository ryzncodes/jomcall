import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { Engine } from "../../engine/src/engine.ts";
test("auth, core commands and SMTP use only loopback HTTP and TCP destinations", async () => {
  const http = new Set<string>(),
    tcp = new Set<string>(),
    originalFetch = globalThis.fetch,
    originalConnect = net.Socket.prototype.connect;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    http.add(url.hostname);
    return originalFetch(input, init);
  };
  net.Socket.prototype.connect = function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    this.once("connect", () => {
      if (this.remoteAddress) tcp.add(this.remoteAddress);
    });
    return Reflect.apply(originalConnect, this, args);
  } as typeof originalConnect;
  let h: Awaited<ReturnType<typeof createHarness>> | undefined,
    api: Awaited<ReturnType<typeof createApiHarness>> | undefined,
    e: Engine | undefined;
  try {
    h = await createHarness();
    api = await createApiHarness(h);
    await api.request(h.alice, h.orgA.id, "POST", "/api/v1/invitations", {
      email: h.bob.confirmedEmail,
      role: "staff",
    });
    e = await Engine.create(h.namespace);
    await e.tick();
    assert.ok(http.size > 0);
    assert.ok(tcp.size > 0);
    for (const host of [...http, ...tcp])
      assert.ok(["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(host), host);
  } finally {
    await e?.close();
    await api?.close();
    await h?.close();
    globalThis.fetch = originalFetch;
    net.Socket.prototype.connect = originalConnect;
  }
});
