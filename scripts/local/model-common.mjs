import {
  ownedProcess,
  verifyProjectRuntime,
} from "../../packages/inference/src/runtime.mjs";
export { ownedProcess };
import {
  statfs,
  readFile,
  mkdir,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const bin = root + ".local/ollama/ollama",
  state = root + ".local/model-process.json",
  lockPath = root + "infra/local/model-lock.json";
export function assertBudget(free, phase) {
  if (free < (phase === "prepare" ? 10 : 5) * 1024 ** 3)
    throw Error("DISK_BUDGET");
}
export async function disk(phase) {
  const fs = await statfs(root);
  assertBudget(fs.bavail * fs.bsize, phase);
}
export function validateModelManifest(m) {
  const bytes = m.layers.reduce((n, l) => {
    if (!Number.isSafeInteger(l.size) || l.size < 0)
      throw Error("MODEL_BUDGET");
    return n + l.size;
  }, 0);
  if (bytes > 4 * 1024 ** 3) throw Error("MODEL_BUDGET");
  return bytes;
}
export async function readLock() {
  return JSON.parse(await readFile(lockPath, "utf8"));
}
export async function stopModel() {
  let saved;
  try {
    saved = JSON.parse(await readFile(state, "utf8"));
  } catch {
    return;
  }
  let command;
  try {
    command = execFileSync("ps", ["-p", String(saved.pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
  } catch {
    await unlink(state);
    return;
  }
  if (!ownedProcess(command, bin)) throw Error("FOREIGN_MODEL_PROCESS");
  process.kill(saved.pid, "SIGTERM");
  await unlink(state);
}
async function verifyRunningModel(pid, preparing) {
  await verifyProjectRuntime();
  if (preparing) return;
  const lock = await readLock();
  const version = await (
    await fetch("http://127.0.0.1:11434/api/version", {
      signal: AbortSignal.timeout(2000),
    })
  ).json();
  const tags = await (
    await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    })
  ).json();
  if (version.version !== lock.runtimeVersion)
    throw Error("MODEL_RUNTIME_CHANGED");
  if (
    !tags.models?.some(
      (m) => m.name === lock.model && m.digest === lock.modelDigest,
    )
  )
    throw Error("MODEL_CHANGED");
}
export async function startModel(preparing = false) {
  await disk("download");
  let saved;
  try {
    saved = JSON.parse(await readFile(state, "utf8"));
  } catch {}
  if (saved) {
    try {
      const command = execFileSync(
        "ps",
        ["-p", String(saved.pid), "-o", "command="],
        { encoding: "utf8" },
      );
      if (ownedProcess(command, bin)) {
        const v = await fetch("http://127.0.0.1:11434/api/version", {
          signal: AbortSignal.timeout(2000),
        });
        if (v.ok) {
          await verifyRunningModel(saved.pid, preparing);
          return saved.pid;
        }
      }
    } catch {}
    throw Error("MODEL_PROCESS_STATE_CONFLICT");
  }
  await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", () => reject(Error("MODEL_PORT_OCCUPIED")));
    s.listen(11434, "127.0.0.1", () => s.close(resolve));
  });
  if (!preparing) {
    const lock = await readLock();
    const version = execFileSync(bin, ["--version"], {
      encoding: "utf8",
      env: { ...process.env, OLLAMA_HOST: "127.0.0.1:11434" },
    });
    if (!version.includes(lock.runtimeVersion))
      throw Error("MODEL_RUNTIME_CHANGED");
  }
  await mkdir(root + ".local/models", { recursive: true });
  const log = await open(root + ".local/model.log", "a", 0o600);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    OLLAMA_HOST: "127.0.0.1:11434",
    OLLAMA_MODELS: root + ".local/models",
    OLLAMA_NO_CLOUD: "1",
    OLLAMA_MAX_LOADED_MODELS: "1",
    OLLAMA_NUM_PARALLEL: "1",
    OLLAMA_MAX_QUEUE: "1",
    OLLAMA_CONTEXT_LENGTH: "8192",
    OLLAMA_KEEP_ALIVE: "30s",
    OLLAMA_DEBUG: "false",
  };
  const child = spawn(bin, ["serve"], {
    env,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    cwd: root,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  await log.close();
  await writeFile(state, JSON.stringify({ pid: child.pid }), { mode: 0o600 });
  for (let n = 0; n < 50; n++) {
    try {
      const r = await fetch("http://127.0.0.1:11434/api/version", {
        signal: AbortSignal.timeout(500),
      });
      if (r.ok) {
        await verifyRunningModel(child.pid, preparing);
        return child.pid;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await stopModel();
  throw Error("MODEL_START_FAILED");
}
