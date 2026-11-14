import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { startVoiceServer } from "../../engine/src/agent/voice-server.ts";
import type { VoiceTurnEvent } from "../../engine/src/agent/voice-turn.ts";
import { fixture, sentence, end } from "../helpers/voice-turn.ts";

type Session = { id: string; hash: string; token: string };

async function harness() {
  const f = await fixture();
  const servers: { close(): Promise<void> }[] = [];
  const serve = async (model: any) => {
    const server = await startVoiceServer(
      // A pass-through proxy is the fixture's real repository.
      { repository: f.wrapped({}) as any, model, now: Date.now },
      { host: "127.0.0.1", port: 0 },
    );
    servers.push(server);
    return server;
  };
  return {
    ...f,
    serve,
    async close() {
      for (const s of servers) await s.close();
      await f.close();
    },
  };
}

const post = (
  port: number,
  session: Session | { id: string },
  over: {
    token?: string | null;
    body?: unknown;
    raw?: string;
    path?: string;
    method?: string;
  } = {},
) =>
  new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const payload =
      over.raw ??
      JSON.stringify(
        over.body ?? {
          sessionId: session.id,
          transcript: "What time are you open on weekdays?",
          clientTurnId: randomUUID(),
          heardAtMs: Date.now(),
        },
      );
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
    };
    const token =
      over.token === undefined ? (session as Session).token : over.token;
    if (token !== null) headers.authorization = "Bearer " + token;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: over.path ?? "/voice/turns",
        method: over.method ?? "POST",
        headers,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, text }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
const lines = (text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as VoiceTurnEvent);
const portOf = (server: { port: number }) => server.port;

test("a posted turn streams the same events as a direct run", async () => {
  const f = await harness();
  try {
    const s = (await f.makeSession()) as Session;
    const { model } = f.scripted([
      sentence("We open at nine."),
      sentence("We close at six."),
      end("We open at nine. We close at six."),
    ]);
    const server = await f.serve(model);
    const res = await post(portOf(server), s);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"] ?? "", /^application\/x-ndjson/);
    const events = lines(res.text);
    assert.deepEqual(
      events.map((e) => e.type),
      ["started", "sentence", "sentence", "done"],
    );
    const [turn] = await f.turns(s.id);
    assert.equal(turn.state, "completed");
    assert.equal(turn.answer, "We open at nine. We close at six.");
  } finally {
    await f.close();
  }
});

test("a missing or wrong bearer token is 401 and starts no turn", async () => {
  const f = await harness();
  try {
    const s = (await f.makeSession()) as Session;
    const { model, seen } = f.scripted();
    const server = await f.serve(model);
    const port = portOf(server);
    for (const token of [null, randomUUID()]) {
      const res = await post(port, s, { token });
      assert.equal(res.status, 401);
      assert.ok(!res.headers["content-type"]?.includes("ndjson"));
      assert.deepEqual(JSON.parse(res.text), { error: "VOICE_UNAUTHORIZED" });
    }
    // A header that is not a bearer token is rejected the same way.
    const odd = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/voice/turns",
          method: "POST",
          headers: { authorization: "Basic abc", "content-length": "2" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    assert.equal(odd, 401);
    assert.deepEqual(await f.turns(s.id), []);
    assert.equal(seen.length, 0);
  } finally {
    await f.close();
  }
});

test("destroying the client socket mid-stream cancels the turn", async () => {
  const f = await harness();
  try {
    const s = (await f.makeSession()) as Session;
    const model = async function* (_input: any, signal: AbortSignal) {
      yield sentence("We open at nine.");
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    const server = await f.serve(model);
    const body = JSON.stringify({
      sessionId: s.id,
      transcript: "What time are you open on weekdays?",
      clientTurnId: randomUUID(),
      heardAtMs: Date.now(),
    });
    const req = http.request({
      host: "127.0.0.1",
      port: portOf(server),
      path: "/voice/turns",
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        "content-length": String(Buffer.byteLength(body)),
      },
    });
    req.end(body);
    const [res] = (await once(req, "response")) as [http.IncomingMessage];
    // Wait for the first sentence to arrive, then drop the connection.
    let seen = "";
    for await (const chunk of res) {
      seen += chunk;
      if (seen.includes('"sentence"')) break;
    }
    req.destroy();
    res.destroy();
    let state = "";
    for (let i = 0; i < 100 && state !== "cancelled"; i++) {
      state = (await f.turns(s.id))[0]?.state ?? "";
      if (state !== "cancelled") await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(state, "cancelled");
  } finally {
    await f.close();
  }
});

test("a host other than 127.0.0.1 is refused", async () => {
  const f = await harness();
  try {
    for (const host of ["0.0.0.0", "::", "localhost", "::1"]) {
      await assert.rejects(
        startVoiceServer(
          {
            repository: f.wrapped({}) as any,
            model: f.scripted().model,
            now: Date.now,
          },
          { host: host as "127.0.0.1", port: 0 },
        ),
        /LOOPBACK_REQUIRED/,
      );
    }
  } finally {
    await f.close();
  }
});

test("a body over 8 KiB is 413 and is not read in full", async () => {
  const f = await harness();
  try {
    const s = (await f.makeSession()) as Session;
    const { model, seen } = f.scripted();
    const server = await f.serve(model);
    const port = portOf(server);
    // Declared too large.
    const declared = await post(port, s, { raw: "x".repeat(8193) });
    assert.equal(declared.status, 413);
    // Chunked, with no declared length: the limit is enforced while reading.
    const chunked = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/voice/turns",
          method: "POST",
          headers: { authorization: "Bearer " + s.token },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", () => {});
      req.write("x".repeat(4096));
      req.write("x".repeat(4096));
      req.write("x".repeat(4096));
      req.end();
      void reject;
    });
    assert.equal(chunked, 413);
    assert.deepEqual(await f.turns(s.id), []);
    assert.equal(seen.length, 0);
  } finally {
    await f.close();
  }
});

test("bad bodies, methods and paths are rejected", async () => {
  const f = await harness();
  try {
    const s = (await f.makeSession()) as Session;
    const { model, seen } = f.scripted();
    const server = await f.serve(model);
    const port = portOf(server);
    assert.equal((await post(port, s, { raw: "not json" })).status, 400);
    assert.equal(
      (await post(port, s, { body: { sessionId: "nope", transcript: "hi" } }))
        .status,
      400,
    );
    assert.equal(
      (
        await post(port, s, {
          body: {
            sessionId: s.id,
            transcript: "hi",
            clientTurnId: randomUUID(),
            heardAtMs: 1,
            extra: true,
          },
        })
      ).status,
      400,
    );
    assert.equal((await post(port, s, { path: "/voice/other" })).status, 404);
    assert.equal((await post(port, s, { method: "PUT" })).status, 405);
    assert.equal(
      (await post(port, s, { method: "GET", path: "/voice/turns", raw: "" }))
        .status,
      405,
    );
    assert.deepEqual(await f.turns(s.id), []);
    assert.equal(seen.length, 0);
  } finally {
    await f.close();
  }
});

test("health answers ok", async () => {
  const f = await harness();
  try {
    const server = await f.serve(f.scripted().model);
    const res = await post(
      portOf(server),
      { id: "x" },
      {
        method: "GET",
        path: "/voice/health",
        raw: "",
        token: null,
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { ok: true });
  } finally {
    await f.close();
  }
});

test("an expired session streams one VOICE_EXPIRED line; a deleted one is 401", async () => {
  const f = await harness();
  try {
    const expired = (await f.makeSession(-5)) as Session;
    const gone = (await f.makeSession()) as Session;
    await f.h.cleanup.query("delete from app.test_session where id=$1", [
      gone.id,
    ]);
    const { model, seen } = f.scripted();
    const server = await f.serve(model);
    const port = portOf(server);
    const a = await post(port, expired);
    assert.equal(a.status, 200);
    assert.deepEqual(lines(a.text), [{ type: "error", code: "VOICE_EXPIRED" }]);
    // Wrong token and unknown session are the same failure by design.
    const b = await post(port, gone);
    assert.equal(b.status, 401);
    assert.deepEqual(JSON.parse(b.text), { error: "VOICE_UNAUTHORIZED" });
    assert.equal(seen.length, 0);
  } finally {
    await f.close();
  }
});

// The two tests below spawn the real agent process, which binds the fixed port
// 54633. When a developer's own agent process already holds it they cannot run.
const PORT_BUSY =
  "port 54633 is busy (an agent process is already running); stop it to run this test";

test("the agent process opens no voice port unless the provider is hosted", async (t) => {
  const probe = () =>
    new Promise<boolean>((resolve) => {
      const s = net.connect(54633, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    });
  if (await probe()) return t.skip(PORT_BUSY);
  const env: NodeJS.ProcessEnv = { ...process.env, JOMCALL_MODE: "local" };
  delete env.JOMCALL_VOICE_PROVIDER;
  const child = spawn(
    process.execPath,
    [
      "--env-file-if-exists=.env.local",
      "--import",
      "tsx",
      "engine/src/agent/index.ts",
    ],
    { env, stdio: "ignore" },
  );
  try {
    // Long enough for the process to boot and run a tick.
    await new Promise((r) => setTimeout(r, 4000));
    assert.equal(child.exitCode, null, "agent process exited early");
    assert.equal(await probe(), false);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});

test("the agent process serves voice turns on 54633 when the provider is hosted", async (t) => {
  // Any listener counts as busy, not only one that answers the health path.
  const listening = () =>
    new Promise<boolean>((resolve) => {
      const s = net.connect(54633, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    });
  const health = () =>
    new Promise<boolean>((resolve) => {
      http
        .get("http://127.0.0.1:54633/voice/health", (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        })
        .on("error", () => resolve(false));
    });
  if (await listening()) return t.skip(PORT_BUSY);
  const child = spawn(
    process.execPath,
    [
      "--env-file-if-exists=.env.local",
      "--import",
      "tsx",
      "engine/src/agent/index.ts",
    ],
    {
      env: {
        ...process.env,
        JOMCALL_MODE: "local",
        JOMCALL_VOICE_PROVIDER: "hosted",
        // The agent refuses to start hosted voice without a model key; the
        // health check below never calls the model.
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "not-a-real-key",
      },
      stdio: "ignore",
    },
  );
  try {
    let up = false;
    for (let i = 0; i < 60 && !up && child.exitCode === null; i++) {
      up = await health();
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(up, true);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  assert.equal(await health(), false);
});
