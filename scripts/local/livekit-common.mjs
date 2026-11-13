import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const lockPath = root + "infra/local/livekit-lock.json",
  templatePath = root + "infra/local/livekit.yaml",
  stateDir = root + ".local/livekit/";
export const containerName = "jomcall-livekit-local",
  labelKey = "com.jomcall.project",
  labelValue = "jomcall-livekit-local";
export const ports = { signal: 54630, tcp: 54631, udp: 54632 };

// The only place that talks to Docker. Tests inject a fake with the same shape.
export const dockerRunner = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

export async function readLock(path = lockPath) {
  const lock = JSON.parse(await readFile(path, "utf8"));
  if (
    lock.image !== "docker.io/livekit/livekit-server" ||
    !/^v\d+\.\d+\.\d+$/.test(lock.version) ||
    !/^sha256:[a-f0-9]{64}$/.test(lock.digest)
  )
    throw Error("LIVEKIT_LOCK_INVALID");
  return lock;
}
// Never a floating tag: always name@sha256:digest.
export const imageRef = (lock) => `${lock.image}@${lock.digest}`;

export function renderConfig(template, key, secret) {
  if (!/^[A-Za-z0-9]+$/.test(key) || !/^[A-Za-z0-9]+$/.test(secret))
    throw Error("LIVEKIT_KEY_INVALID");
  const out = template
    .replace("__LIVEKIT_API_KEY__", key)
    .replace("__LIVEKIT_API_SECRET__", secret);
  if (out.includes("0.0.0.0") || out.includes("__LIVEKIT"))
    throw Error("LIVEKIT_CONFIG_INVALID");
  return out;
}

export function runArgs(lock, configPath) {
  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "--label",
    `${labelKey}=${labelValue}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "-p",
    `127.0.0.1:${ports.signal}:${ports.signal}/tcp`,
    "-p",
    `127.0.0.1:${ports.tcp}:${ports.tcp}/tcp`,
    "-p",
    `127.0.0.1:${ports.udp}:${ports.udp}/udp`,
    "-v",
    `${configPath}:/etc/livekit.yaml:ro`,
    imageRef(lock),
    "--config",
    "/etc/livekit.yaml",
  ];
  assertLoopbackPublishes(args);
  return args;
}
export function assertLoopbackPublishes(args) {
  args.forEach((a, i) => {
    if (a === "-p" && !args[i + 1]?.startsWith("127.0.0.1:"))
      throw Error("LIVEKIT_PUBLISH_NOT_LOOPBACK");
    if (/^(-p|--publish)/.test(a) && a !== "-p")
      throw Error("LIVEKIT_PUBLISH_FORM");
  });
  if (
    args.some((a) =>
      /^--(network|privileged|pid|publish-all|net)\b|^-P$/.test(a),
    ) ||
    args.join(" ").includes("0.0.0.0")
  )
    throw Error("LIVEKIT_ARGS_UNSAFE");
}

export function verifyImage(docker, lock) {
  const ref = imageRef(lock);
  let info;
  try {
    info = JSON.parse(docker(["image", "inspect", ref]))[0];
  } catch {
    throw Error("LIVEKIT_IMAGE_MISSING");
  }
  if (!info || !(info.RepoDigests?.includes(ref) || info.Id === lock.digest))
    throw Error("LIVEKIT_IMAGE_MISMATCH");
  return info;
}

export async function prepareLivekit({
  download,
  docker = dockerRunner,
  log = console.log,
}) {
  const lock = await readLock();
  assertDocker(docker);
  if (download) docker(["pull", imageRef(lock)]);
  try {
    const info = verifyImage(docker, lock);
    log(`Pinned LiveKit image present: ${lock.version}, ${info.Size} bytes.`);
    return true;
  } catch (e) {
    if (e.message !== "LIVEKIT_IMAGE_MISSING" || download) throw e;
    log("Pinned LiveKit image not present. Run with --download to pull it.");
    return false;
  }
}

async function readState(dir) {
  try {
    return JSON.parse(await readFile(dir + "container.json", "utf8"));
  } catch {
    return undefined;
  }
}
// Only a confirmed "No such container" counts as absent. Any other Docker
// failure (daemon down, wrong context, timeout) must not look like absence.
function inspectContainer(docker, id) {
  try {
    return JSON.parse(docker(["inspect", "--type", "container", id]))[0];
  } catch (e) {
    if (/no such (container|object)/i.test(`${e.stderr ?? ""}${e.message}`))
      return undefined;
    throw Error("DOCKER_UNAVAILABLE");
  }
}
export function assertDocker(docker) {
  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw Error("DOCKER_UNAVAILABLE");
  }
}
// Host ports published by the LiveKit container this project started, if any.
export async function livekitOwnedPorts({
  docker = dockerRunner,
  dir = stateDir,
} = {}) {
  const saved = await readState(dir);
  if (!saved) return [];
  const c = inspectContainer(docker, saved.id);
  if (!owned(c, saved.id)) return [];
  return Object.values(c.NetworkSettings?.Ports ?? {})
    .flatMap((v) => v ?? [])
    .map((v) => Number(v.HostPort));
}
const owned = (c, id) =>
  c &&
  c.Id === id &&
  c.Name === "/" + containerName &&
  c.Config?.Labels?.[labelKey] === labelValue;

export async function stopLivekit({
  docker = dockerRunner,
  dir = stateDir,
} = {}) {
  const saved = await readState(dir);
  if (!saved) {
    if (inspectContainer(docker, containerName))
      throw Error("FOREIGN_LIVEKIT_CONTAINER");
    return false;
  }
  const c = inspectContainer(docker, saved.id);
  if (c) {
    if (!owned(c, saved.id)) throw Error("FOREIGN_LIVEKIT_CONTAINER");
    docker(["rm", "-f", saved.id]);
  }
  await unlink(dir + "container.json");
  return true;
}

export async function startLivekit({
  docker = dockerRunner,
  dir = stateDir,
  env = process.env,
  template,
  ready = waitReady,
} = {}) {
  const key = env.LIVEKIT_API_KEY,
    secret = env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw Error("LIVEKIT_KEYS_MISSING");
  const lock = await readLock();
  assertDocker(docker);
  verifyImage(docker, lock);
  const saved = await readState(dir);
  if (saved) {
    const c = inspectContainer(docker, saved.id);
    if (owned(c, saved.id) && c.State?.Running) return saved.id;
    throw Error("LIVEKIT_PROCESS_STATE_CONFLICT");
  }
  if (inspectContainer(docker, containerName))
    throw Error("FOREIGN_LIVEKIT_CONTAINER");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const configPath = dir + "livekit.yaml";
  await writeFile(
    configPath,
    renderConfig(
      template ?? (await readFile(templatePath, "utf8")),
      key,
      secret,
    ),
    { mode: 0o600 },
  );
  const id = docker(runArgs(lock, configPath)).trim();
  await writeFile(dir + "container.json", JSON.stringify({ id }), {
    mode: 0o600,
  });
  try {
    await ready();
  } catch (e) {
    await stopLivekit({ docker, dir });
    throw e;
  }
  return id;
}
export async function waitReady() {
  for (let n = 0; n < 50; n++) {
    try {
      const r = await fetch(`http://127.0.0.1:${ports.signal}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("LIVEKIT_START_FAILED");
}
