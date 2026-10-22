import { closeServices } from "../../web/lib/server/services.ts";
import { createServer } from "node:http";
import type { createHarness } from "./local.ts";
import { handleAuth } from "../../web/lib/server/auth.ts";
import { dispatchCore } from "../../web/lib/server/api.ts";
export async function createApiHarness(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  process.env.JOMCALL_MODE = "local";
  process.env.NODE_ENV = "test";
  process.env.JOMCALL_QUEUE_NAMESPACE = h.namespace;
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const request = new Request("http://127.0.0.1:4182" + req.url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: ["GET", "HEAD"].includes(req.method!) ? undefined : body,
      });
      const response = await (req.url!.startsWith("/api/auth/")
        ? handleAuth(request)
        : dispatchCore(request));
      res.statusCode = response.status;
      response.headers.forEach((v, k) => {
        if (k !== "set-cookie") res.setHeader(k, v);
      });
      res.setHeader("set-cookie", response.headers.getSetCookie());
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 500;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  async function request(
    actor: { token: string; refreshToken: string } | null,
    orgId: string | null,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const csrf = await fetch(`http://127.0.0.1:${port}/api/auth/csrf`);
    const token = (await csrf.json()).data.token;
    const challenge = csrf.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
    const cookies = [
      challenge,
      actor
        ? `ca_local_access=${actor.token}; ca_local_refresh=${actor.refreshToken}`
        : "",
    ].join("; ");
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: cookies,
        origin: "http://127.0.0.1:4182",
        "x-csrf-token": token,
        ...(orgId ? { "x-organization-id": orgId } : {}),
        ...(method !== "GET" ? { "idempotency-key": crypto.randomUUID() } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  }
  return {
    request,
    close: async () => {
      await closeServices();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
