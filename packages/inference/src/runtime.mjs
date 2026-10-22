import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
// Lifecycle/worker commands run from the repository; Next runs from web/.
// Resolve at runtime so the bundler does not turn a directory URL into an asset.
async function projectRoot() {
  let dir = await realpath(process.cwd());
  for (let n = 0; n < 2; n++, dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      if (pkg.name === "jomcall" && pkg.private === true) return dir + "/";
    } catch {}
  }
  throw Error("MODEL_PROJECT_ROOT_REQUIRED");
}
export const ownedProcess = (command, binary) =>
  command.trim() === binary + " serve";
// Self-reported HTTP metadata does not establish the local runtime boundary.
export async function verifyProjectRuntime(port = 11434) {
  try {
    if (port !== 11434) throw Error("WRONG_PORT");
    const root = await projectRoot();
    const saved = JSON.parse(
      await readFile(root + ".local/model-process.json", "utf8"),
    );
    if (!Number.isSafeInteger(saved.pid) || saved.pid <= 0)
      throw Error("INVALID_PID");
    const { stdout: command } = await exec(
      "ps",
      ["-p", String(saved.pid), "-o", "command="],
      { timeout: 1500 },
    );
    if (!ownedProcess(command, root + ".local/ollama/ollama"))
      throw Error("FOREIGN_PROCESS");
    const { stdout: listeners } = await exec(
      "lsof",
      ["-nP", "-iTCP:11434", "-sTCP:LISTEN", "-t"],
      { timeout: 1500 },
    );
    const pids = [...new Set(listeners.trim().split(/\s+/))];
    if (pids.length !== 1 || pids[0] !== String(saved.pid))
      throw Error("FOREIGN_LISTENER");
  } catch {
    throw Error("MODEL_PROCESS_UNOWNED");
  }
}
