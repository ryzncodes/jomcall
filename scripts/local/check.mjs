import { execFileSync } from "node:child_process";
import { readFileSync, statfsSync } from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { validateCapacity, validatePorts, validateBindings } from "./guard.mjs";
export const config = JSON.parse(
  readFileSync(new URL("../../infra/local/services.json", import.meta.url)),
);
export const run = (bin, args) =>
  execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
export function projectContainers() {
  const ids = run("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=com.supabase.cli.project=${config.project}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ids.length ? JSON.parse(run("docker", ["inspect", ...ids])) : [];
}
export function checkBindings() {
  const c = projectContainers();
  const bindings = c.flatMap((x) =>
    Object.values(x.NetworkSettings.Ports ?? {})
      .flatMap((v) => v ?? [])
      .map((v) => `${v.HostIp === "::1" ? "[::1]" : v.HostIp}:${v.HostPort}`),
  );
  try {
    validateBindings(bindings);
  } catch {
    throw Error("NON_LOOPBACK: " + bindings.join(", "));
  }
  if (!c.length) throw Error("STACK_NOT_RUNNING");
  return c;
}
export async function checkLocal() {
  if (run("supabase", ["--version"]).trim() !== config.cli)
    throw Error("CLI_VERSION: expected " + config.cli);
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  const disk = statfsSync(process.cwd());
  const freeGiB = (disk.bavail * disk.bsize) / 1024 ** 3;
  validateCapacity({ freeGiB, needsPull: true });
  const owned = new Set(
    projectContainers().flatMap((c) =>
      Object.values(c.NetworkSettings.Ports ?? {})
        .flatMap((v) => v ?? [])
        .map((v) => Number(v.HostPort)),
    ),
  );
  const occupied = [];
  for (const port of config.ports) {
    if (owned.has(port)) continue;
    await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => {
        occupied.push(port);
        resolve();
      });
      s.listen(port, "127.0.0.1", () => s.close(resolve));
    });
  }
  validatePorts({ occupied });
  return { freeGiB: Math.round(freeGiB * 10) / 10, project: config.project };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  checkLocal()
    .then(console.log)
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
