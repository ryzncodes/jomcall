// Process-scoped adapter: the pinned CLI omits HostIp and Docker Desktop ignores
// bridge default binding. Never listens on TCP, logs request bodies, or persists keys.
import http from "node:http";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function pinLoopback(payload) {
  if (payload.Labels?.["com.supabase.cli.project"] !== "jomcall-local")
    throw Error("FOREIGN_PROJECT");
  for (const entries of Object.values(payload.HostConfig?.PortBindings ?? {}))
    for (const port of entries) port.HostIp = "127.0.0.1";
  return payload;
}
export async function dockerLoopback(socketPath) {
  const dir = mkdtempSync(join(tmpdir(), "ca-docker-"));
  chmodSync(dir, 0o700);
  const path = join(dir, "api.sock");
  const server = http.createServer(async (req, res) => {
    try {
      let body;
      if (
        req.method === "POST" &&
        /\/containers\/create(?:\?|$)/.test(req.url ?? "")
      ) {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024) throw Error("BODY_LIMIT");
          chunks.push(chunk);
        }
        body = Buffer.from(
          JSON.stringify(
            pinLoopback(JSON.parse(Buffer.concat(chunks).toString())),
          ),
        );
      }
      const headers = { ...req.headers };
      if (body) {
        headers["content-length"] = String(body.length);
        delete headers["transfer-encoding"];
      }
      const upstream = http.request(
        { socketPath, path: req.url, method: req.method, headers },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end("Docker unavailable");
      });
      if (body) upstream.end(body);
      else req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end("Local Docker request rejected");
    }
  });
  server.on("upgrade", (req, socket, head) => {
    const upstream = http.request({
      socketPath,
      path: req.url,
      method: req.method,
      headers: req.headers,
    });
    upstream.on("upgrade", (response, remote, extra) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` +
          Object.entries(response.headers)
            .map(([k, v]) => `${k}: ${v}\r\n`)
            .join("") +
          "\r\n",
      );
      if (extra.length) socket.write(extra);
      remote.pipe(socket);
      socket.pipe(remote);
      socket.on("error", () => remote.destroy());
      remote.on("error", () => socket.destroy());
    });
    upstream.on("error", () => socket.destroy());
    upstream.end(head);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  chmodSync(path, 0o600);
  return {
    host: `unix://${path}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
