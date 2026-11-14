import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  isPrivateAddress,
  SERVICE_KEY_HEADER,
} from "../../../packages/contracts/src/hosting.ts";
import { z } from "zod";
import { runVoiceTurn, type VoiceTurnDeps, type VoiceTurnEvent } from "./voice-turn.ts";
import { phonePolicy, startPhoneCall, PhoneError, type PhoneDeps } from "./phone-call.ts";

// Loopback-only listener for real phone calls, kept apart from the browser
// voice endpoint (54633). The worker starts a call with the room and the SIP
// participant identity only; after that every request carries the per-call
// token. Nothing here may log a token, its hash, a transcript or an answer.
export const PHONE_PORT = 54635;
const MAX_BODY_BYTES = 8 * 1024;
const BODY_TIMEOUT_MS = 15_000;
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]{1,512}=*)$/;

const startBody = z.strictObject({
  room: z.string().min(1).max(200),
  identity: z.string().min(1).max(200),
});
const turnBody = z.strictObject({
  callId: z.uuid(),
  transcript: z.string().max(4000),
  clientTurnId: z.uuid(),
  heardAtMs: z.number().finite().nonnegative(),
});
const endBody = z.strictObject({
  reason: z.string().regex(/^[A-Za-z_]{1,40}$/),
  language: z.enum(["ms", "en", "manglish", "zh"]).optional(),
});

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

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return resolve(null);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.pause();
        resolve(null);
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startPhoneServer(
  deps: PhoneDeps & { model: VoiceTurnDeps["model"] },
  options: {
    host: string;
    port: number;
    maintainMs?: number;
    // The same rules as the browser voice endpoint (voice-server.ts): local
    // mode binds 127.0.0.1 with no second key; hosted mode binds a private
    // address and requires the worker's service secret on every request,
    // in addition to the per-call token.
    mode?: "local" | "hosted";
    serviceSecret?: string;
  },
): Promise<{ port: number; close(): Promise<void> }> {
  const hosted = options.mode === "hosted";
  if (!hosted && options.host !== "127.0.0.1") throw Error("LOOPBACK_REQUIRED");
  if (hosted && !isPrivateAddress(options.host)) throw Error("PRIVATE_BIND_REQUIRED");
  const serviceSecret = hosted ? (options.serviceSecret ?? "") : null;
  if (serviceSecret !== null && serviceSecret.length < 32)
    throw Error("VOICE_SERVICE_SECRET_REQUIRED");
  // Compares digests, so neither the length nor a prefix leaks through timing.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const serviceOk = (req: http.IncomingMessage) => {
    if (serviceSecret === null) return true;
    const supplied = req.headers[SERVICE_KEY_HEADER];
    return typeof supplied === "string" && timingSafeEqual(digest(supplied), digest(serviceSecret));
  };
  const inflight = new Set<Promise<void>>();
  const policy = phonePolicy(deps);

  async function parse<T>(req: http.IncomingMessage, schema: z.ZodType<T>): Promise<T | number> {
    let raw: string | null;
    try {
      raw = await readBody(req);
    } catch {
      return 400;
    }
    if (raw === null) return 413;
    try {
      return schema.parse(JSON.parse(raw));
    } catch {
      return 400;
    }
  }

  async function handleTurn(req: http.IncomingMessage, res: http.ServerResponse, token: string) {
    const parsed = await parse(req, turnBody);
    if (typeof parsed === "number") return json(res, parsed, { error: "BAD_REQUEST" });
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const emit = (event: VoiceTurnEvent) => {
      if (controller.signal.aborted || res.destroyed) return;
      if (!res.headersSent) {
        if (event.type === "error" && event.code === "VOICE_UNAUTHORIZED")
          return json(res, 401, { error: "VOICE_UNAUTHORIZED" });
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
        });
      }
      if (!res.writableEnded) res.write(JSON.stringify(event) + "\n");
    };
    try {
      await runVoiceTurn(
        { repository: deps.calls, model: deps.model, now: deps.now, policy },
        {
          sessionId: parsed.callId,
          tokenHash: hashOf(token),
          transcript: parsed.transcript,
          clientTurnId: parsed.clientTurnId,
          heardAtMs: parsed.heardAtMs,
        },
        emit,
        controller.signal,
      );
    } catch {
      if (!res.headersSent && !res.destroyed) return json(res, 500, { error: "TURN_FAILED" });
    }
    if (res.destroyed) return;
    if (!res.headersSent) return json(res, 500, { error: "TURN_FAILED" });
    res.end();
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/phone/health" && req.method === "GET") return json(res, 200, { ok: true });
    if (req.method !== "POST") return json(res, 405, { error: "METHOD" });
    // Hosted mode: the service key first, on call start too (it has no token yet).
    if (!serviceOk(req)) return json(res, 401, { error: "VOICE_UNAUTHORIZED" });
    if (path === "/phone/calls") {
      const parsed = await parse(req, startBody);
      if (typeof parsed === "number") return json(res, parsed, { error: "BAD_REQUEST" });
      try {
        return json(res, 200, await startPhoneCall(deps, parsed));
      } catch (error) {
        if (error instanceof PhoneError) return json(res, error.status, { error: error.code });
        return json(res, 500, { error: "CALL_START_FAILED" });
      }
    }
    const bearer = BEARER.exec(req.headers.authorization ?? "");
    if (!bearer) return json(res, 401, { error: "VOICE_UNAUTHORIZED" });
    if (path === "/phone/turns") return handleTurn(req, res, bearer[1]);
    const action = path.match(/^\/phone\/calls\/([0-9a-f-]{36})\/(answered|end)$/);
    if (!action) return json(res, 404, { error: "NOT_FOUND" });
    const callId = action[1];
    try {
      if (action[2] === "answered") {
        await deps.calls.answered(callId, hashOf(bearer[1]));
        return json(res, 200, {});
      }
      const parsed = await parse(req, endBody);
      if (typeof parsed === "number") return json(res, parsed, { error: "BAD_REQUEST" });
      await deps.calls.end(callId, hashOf(bearer[1]), parsed);
      return json(res, 200, {});
    } catch (error) {
      const code = (error as Error).message;
      if (code === "VOICE_UNAUTHORIZED" || code === "VOICE_EXPIRED")
        return json(res, 401, { error: code });
      return json(res, 500, { error: "CALL_UPDATE_FAILED" });
    }
  }

  const server = http.createServer((req, res) => {
    const work = handle(req, res).catch(() => {
      if (!res.headersSent && !res.destroyed) json(res, 500, { error: "FAILED" });
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
  server.on("error", () => console.error("PHONE_SERVER_ERROR"));
  // Calls whose worker vanished stop counting against the line limit.
  const timer = setInterval(() => {
    deps.calls.maintain().catch(() => console.error("PHONE_MAINTAIN_FAILED"));
  }, options.maintainMs ?? 30_000);
  timer.unref();
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | null = null;
  return {
    port,
    close() {
      closing ??= (async () => {
        clearInterval(timer);
        server.close();
        server.closeAllConnections();
        await Promise.allSettled([...inflight]);
      })();
      return closing;
    },
  };
}
