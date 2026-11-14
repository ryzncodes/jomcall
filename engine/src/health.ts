import http from "node:http";

// A cheap health listener for a long-running worker. It answers only on
// loopback, so only a check running beside the process (the container health
// check) can reach it. It reports a boolean and the service name, nothing else.
export async function startHealthServer(options: {
  service: string;
  port: number;
  check: () => boolean | Promise<boolean>;
}): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
        "cache-control": "no-store",
      });
      res.end(text);
    };
    if ((req.url ?? "").split("?")[0] !== "/health" || req.method !== "GET")
      return send(404, { error: "NOT_FOUND" });
    void Promise.resolve()
      .then(options.check)
      .catch(() => false)
      .then((ok) => send(ok ? 200 : 503, { ok, service: options.service }));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", () => console.error("HEALTH_SERVER_ERROR"));
  return {
    port: (server.address() as { port: number }).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export const ENGINE_HEALTH_PORT = 54635;
export const AGENT_HEALTH_PORT = 54636;
// A worker whose last finished loop is older than this is not healthy.
export const STALE_AFTER_MS = 60_000;
