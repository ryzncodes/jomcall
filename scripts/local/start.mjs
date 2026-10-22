import { spawn } from "node:child_process";
import { statfsSync } from "node:fs";
import {
  checkLocal,
  checkBindings,
  projectContainers,
  config,
  run,
} from "./check.mjs";
import { stopArguments, validateCapacity } from "./guard.mjs";
import { dockerLoopback } from "./docker-loopback.mjs";
import { writeEnvironment } from "./env.mjs";
try {
  console.log(await checkLocal());
  const existing = projectContainers().length > 0;
  let network;
  try {
    network = JSON.parse(
      run("docker", ["network", "inspect", config.network]),
    )[0];
  } catch {
    run("docker", [
      "network",
      "create",
      "--driver",
      "bridge",
      "--opt",
      "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      config.network,
    ]);
  }
  if (
    network?.Options?.["com.docker.network.bridge.host_binding_ipv4"] !==
      "127.0.0.1" &&
    network
  )
    throw Error("NETWORK_BINDING_MISMATCH");
  const endpoint = JSON.parse(run("docker", ["context", "inspect"]))[0]
    .Endpoints.docker.Host;
  if (!endpoint.startsWith("unix://"))
    throw Error("LOCAL_DOCKER_SOCKET_REQUIRED");
  const proxy = await dockerLoopback(endpoint.slice(7));
  const child = spawn(
    "supabase",
    ["start", "--network-id", config.network, "--exclude", config.exclude],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DOCKER_HOST: proxy.host, DOCKER_CONTEXT: "" },
    },
  );
  // CLI prints local keys on success. Drain both streams without forwarding them.
  let bytes = 0;
  child.stdout.on("data", (x) => (bytes += x.length));
  child.stderr.on("data", (x) => (bytes += x.length));
  let diskFailure = false;
  const timer = setInterval(() => {
    const d = statfsSync(".");
    try {
      validateCapacity({
        freeGiB: (d.bavail * d.bsize) / 1024 ** 3,
        needsPull: false,
      });
    } catch {
      diskFailure = true;
      child.kill("SIGTERM");
    }
    console.log("Preparing local services; CLI output redacted.");
  }, 15000);
  const code = await new Promise((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  clearInterval(timer);
  await proxy.close();
  if (code !== 0) {
    if (!existing) run("supabase", stopArguments(config.project));
    throw Error(
      diskFailure
        ? "DISK_SPACE"
        : "LOCAL_START_FAILED (CLI output withheld because it may contain secrets)",
    );
  }
  try {
    checkBindings();
  } catch (e) {
    if (!existing) run("supabase", stopArguments(config.project));
    throw e;
  }
  writeEnvironment();
  console.log("Local Auth/DB/Mail ready; all published ports bind loopback.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
