import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  runVoiceTurn,
  type VoiceTurnDeps,
  type VoiceTurnEvent,
} from "./voice-turn.ts";

const MAX_BODY_BYTES = 8 * 1024;
const BODY_TIMEOUT_MS = 15_000;
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]{1,512}=*)$/;

const turnBody = z.strictObject({
  sessionId: z.uuid(),
  transcript: z.string().max(4000),
  clientTurnId: z.uuid(),
  heardAtMs: z.number().finite().nonnegative(),
});

// Nothing here may log the token, its hash, the transcript or the answer.
function json(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

// Reads at most MAX_BODY_BYTES; null means the limit was passed and reading stopped.
function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_BODY_BYTES) return resolve(null);
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        cleanup();
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export async function startVoiceServer(
  deps: VoiceTurnDeps,
  options: { host: "127.0.0.1"; port: number },
): Promise<{ port: number; close(): Promise<void> }> {
  // The one place a voice token is exchanged for model and database access.
  if (options.host !== "127.0.0.1") throw Error("LOOPBACK_REQUIRED");
  const inflight = new Set<Promise<void>>();

  async function handleTurn(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    const bearer = BEARER.exec(req.headers.authorization ?? "");
    if (!bearer) return json(res, 401, { error: "VOICE_UNAUTHORIZED" });
    let raw: string | null;
    try {
      raw = await readBody(req);
    } catch {
      return json(res, 400, { error: "BAD_REQUEST" });
    }
    if (raw === null) {
      // Stop the upload once the answer is out instead of draining it.
      res.setHeader("connection", "close");
      res.once("finish", () => req.destroy());
      return json(res, 413, { error: "BODY_TOO_LARGE" });
    }
    let parsed: z.infer<typeof turnBody>;
    try {
      parsed = turnBody.parse(JSON.parse(raw));
    } catch {
      return json(res, 400, { error: "BAD_REQUEST" });
    }

    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const tokenHash = createHash("sha256").update(bearer[1]).digest("hex");
    const emit = (event: VoiceTurnEvent) => {
      if (controller.signal.aborted || res.destroyed) return;
      if (!res.headersSent) {
        // The database is the only judge of a well-formed but wrong token, so
        // headers wait for the first event.
        if (event.type === "error" && event.code === "VOICE_UNAUTHORIZED")
          return json(res, 401, { error: "VOICE_UNAUTHORIZED" });
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
      }
      if (res.writableEnded) return;
      res.write(JSON.stringify(event) + "\n");
    };
    try {
      await runVoiceTurn(
        deps,
        {
          sessionId: parsed.sessionId,
          tokenHash,
          transcript: parsed.transcript,
          clientTurnId: parsed.clientTurnId,
          heardAtMs: parsed.heardAtMs,
        },
        emit,
        controller.signal,
      );
    } catch {
      if (!res.headersSent && !res.destroyed)
        return json(res, 500, { error: "TURN_FAILED" });
    }
    if (res.destroyed) return;
    if (!res.headersSent) return json(res, 500, { error: "TURN_FAILED" });
    res.end();
  }

  const server = http.createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/voice/health") {
      if (req.method !== "GET") return json(res, 405, { error: "METHOD" });
      return json(res, 200, { ok: true });
    }
    if (path !== "/voice/turns") return json(res, 404, { error: "NOT_FOUND" });
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return json(res, 405, { error: "METHOD" });
    }
    const work = handleTurn(req, res).catch(() => {
      if (!res.headersSent && !res.destroyed)
        json(res, 500, { error: "TURN_FAILED" });
      else res.destroy();
    });
    inflight.add(work);
    void work.finally(() => inflight.delete(work));
  });
  server.requestTimeout = BODY_TIMEOUT_MS;
  server.headersTimeout = BODY_TIMEOUT_MS;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", () => console.error("VOICE_SERVER_ERROR"));
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | null = null;
  return {
    port,
    close() {
      closing ??= (async () => {
        server.close();
        server.closeAllConnections();
        await Promise.allSettled([...inflight]);
      })();
      return closing;
    },
  };
}
