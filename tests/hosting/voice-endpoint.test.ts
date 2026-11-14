import { test } from "node:test";
import assert from "node:assert/strict";
import { startVoiceServer } from "../../engine/src/agent/voice-server.ts";
import { startHealthServer } from "../../engine/src/health.ts";
import type { VoiceTurnDeps } from "../../engine/src/agent/voice-turn.ts";

const SECRET = "k".repeat(40);
// Reaching the repository proves a request passed every gate before it.
let reached = 0;
const deps = {
  repository: new Proxy(
    {},
    {
      get() {
        return async () => {
          reached++;
          throw Error("FAKE_REPOSITORY");
        };
      },
    },
  ),
  model: async function* () {},
  now: Date.now,
} as unknown as VoiceTurnDeps;
const body = JSON.stringify({
  sessionId: "00000000-0000-4000-8000-000000000001",
  transcript: "hello",
  clientTurnId: "00000000-0000-4000-8000-000000000002",
  heardAtMs: 1,
});
const turn = (port: number, headers: Record<string, string>) =>
  fetch(`http://127.0.0.1:${port}/voice/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

test("local mode refuses every bind address except 127.0.0.1", async () => {
  for (const host of [
    "0.0.0.0",
    "::1",
    "localhost",
    "10.0.0.1",
    "172.30.0.10",
  ]) {
    await assert.rejects(
      startVoiceServer(deps, { host, port: 0 }),
      /LOOPBACK_REQUIRED/,
    );
    await assert.rejects(
      startVoiceServer(deps, {
        host,
        port: 0,
        mode: "local",
        serviceSecret: SECRET,
      }),
      /LOOPBACK_REQUIRED/,
    );
  }
});

test("local mode asks for no service key", async () => {
  const server = await startVoiceServer(deps, { host: "127.0.0.1", port: 0 });
  try {
    reached = 0;
    const response = await turn(server.port, {
      authorization: "Bearer " + "a".repeat(64),
    });
    assert.notEqual(response.status, 401);
    assert.ok(reached > 0);
  } finally {
    await server.close();
  }
});

test("hosted mode refuses a public or wildcard bind address", async () => {
  for (const host of ["0.0.0.0", "::", "8.8.8.8", "agent", "203.0.113.4"])
    await assert.rejects(
      startVoiceServer(deps, {
        host,
        port: 0,
        mode: "hosted",
        serviceSecret: SECRET,
      }),
      /PRIVATE_BIND_REQUIRED/,
    );
});

test("hosted mode will not start without a service secret", async () => {
  for (const serviceSecret of [undefined, "", "short"])
    await assert.rejects(
      startVoiceServer(deps, {
        host: "127.0.0.1",
        port: 0,
        mode: "hosted",
        serviceSecret,
      }),
      /VOICE_SERVICE_SECRET_REQUIRED/,
    );
});

test("hosted mode needs the service key as well as the call token", async () => {
  const server = await startVoiceServer(deps, {
    host: "127.0.0.1",
    port: 0,
    mode: "hosted",
    serviceSecret: SECRET,
  });
  const bearer = { authorization: "Bearer " + "a".repeat(64) };
  try {
    reached = 0;
    for (const headers of [
      bearer,
      { ...bearer, "x-jomcall-service-key": "" },
      { ...bearer, "x-jomcall-service-key": "k".repeat(39) },
      { ...bearer, "x-jomcall-service-key": "k".repeat(41) },
      { ...bearer, "x-jomcall-service-key": "x".repeat(40) },
    ]) {
      const response = await turn(server.port, headers);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "VOICE_UNAUTHORIZED" });
    }
    assert.equal(reached, 0, "a request without the key reached the database");
    // The key alone is not enough either.
    assert.equal(
      (await turn(server.port, { "x-jomcall-service-key": SECRET })).status,
      401,
    );
    assert.equal(reached, 0);
    const accepted = await turn(server.port, {
      ...bearer,
      "x-jomcall-service-key": SECRET,
    });
    assert.notEqual(accepted.status, 401);
    assert.ok(reached > 0);
  } finally {
    await server.close();
  }
});

test("the voice health path needs no key and reports a failed dependency", async () => {
  let healthy = true;
  const server = await startVoiceServer(deps, {
    host: "127.0.0.1",
    port: 0,
    mode: "hosted",
    serviceSecret: SECRET,
    health: async () => {
      if (!healthy) throw Error("DOWN");
      return true;
    },
  });
  try {
    const url = `http://127.0.0.1:${server.port}/voice/health`;
    const up = await fetch(url);
    assert.equal(up.status, 200);
    assert.deepEqual(await up.json(), { ok: true });
    healthy = false;
    const down = await fetch(url);
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { ok: false });
  } finally {
    await server.close();
  }
});

test("the worker health listener answers on loopback with a boolean only", async () => {
  let ok = true;
  const server = await startHealthServer({
    service: "engine",
    port: 0,
    check: () => ok,
  });
  try {
    const url = `http://127.0.0.1:${server.port}/health`;
    const up = await fetch(url);
    assert.equal(up.status, 200);
    assert.deepEqual(await up.json(), { ok: true, service: "engine" });
    ok = false;
    assert.equal((await fetch(url)).status, 503);
    assert.equal((await fetch(url + "x")).status, 404);
    assert.equal((await fetch(url, { method: "POST" })).status, 404);
  } finally {
    await server.close();
  }
});
