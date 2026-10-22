import { mkdir, open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  root,
  readLock,
  disk,
  validateModelManifest,
  startModel,
  stopModel,
} from "./model-common.mjs";
const version = "0.40.5";
const archiveURL = `https://github.com/ollama/ollama/releases/download/v${version}/ollama-darwin.tgz`;
const runtimeSha256 =
  "75f9907dafa2fd4c61b5967de2ebb81ccc17eb28da9172edbad0dbc717474dcf";
async function main() {
  if (!process.argv.includes("--download"))
    throw Error("EXPLICIT_DOWNLOAD_REQUIRED");
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("MODEL_RUNTIME_PLATFORM_UNSUPPORTED");
  await disk("prepare");
  await mkdir(root + ".local/ollama", { recursive: true });
  const lock = await readLock();
  if (
    lock.runtimeVersion !== version ||
    lock.runtimeSha256 !== runtimeSha256 ||
    lock.runtimeSource !== archiveURL ||
    lock.model !== "qwen3:4b" ||
    !/^[a-f0-9]{64}$/.test(lock.modelDigest)
  )
    throw Error("MODEL_LOCK_INVALID");
  const manifestResponse = await fetch(
    "https://registry.ollama.ai/v2/library/qwen3/manifests/4b",
  );
  if (!manifestResponse.ok) throw Error("MODEL_MANIFEST_UNAVAILABLE");
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  const modelDigest = createHash("sha256").update(manifestBytes).digest("hex");
  if (modelDigest !== lock.modelDigest) throw Error("MODEL_LOCK_MISMATCH");
  const manifest = JSON.parse(manifestBytes.toString());
  const modelBytes = validateModelManifest(manifest);
  const file = root + ".local/ollama-runtime.tgz";
  const out = await open(file, "w", 0o600);
  const hash = createHash("sha256");
  let runtimeBytes = 0;
  try {
    const r = await fetch(archiveURL);
    if (!r.ok) throw Error("RUNTIME_DOWNLOAD_FAILED");
    for await (const chunk of r.body) {
      await disk("download");
      runtimeBytes += chunk.length;
      if (runtimeBytes > 512 * 1024 ** 2) throw Error("RUNTIME_BUDGET");
      hash.update(chunk);
      await out.write(chunk);
    }
  } finally {
    await out.close();
  }
  if (hash.digest("hex") !== runtimeSha256)
    throw Error("RUNTIME_CHECKSUM_MISMATCH");
  const entries = execFileSync("tar", ["-tzf", file], { encoding: "utf8" })
    .trim()
    .split("\n");
  if (entries.some((p) => p.startsWith("/") || p.split("/").includes("..")))
    throw Error("UNSAFE_RUNTIME_ARCHIVE");
  await stopModel();
  execFileSync("tar", ["-xzf", file, "-C", root + ".local/ollama"]);
  await unlink(file);
  console.log("Runtime verified. Preparing one model:", modelBytes, "bytes.");
  await startModel(true);
  try {
    const r = await fetch("http://127.0.0.1:11434/api/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen3:4b", stream: true }),
    });
    if (!r.ok) throw Error("MODEL_PULL_FAILED");
    let text = "";
    for await (const chunk of r.body) {
      await disk("download");
      text += Buffer.from(chunk).toString();
      let at;
      while ((at = text.indexOf("\n")) >= 0) {
        const event = JSON.parse(text.slice(0, at));
        text = text.slice(at + 1);
        if (event.error) throw Error("MODEL_PULL_FAILED");
      }
    }
    const tags = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
    const installed = tags.models?.find((m) => m.name === "qwen3:4b");
    if (!installed || installed.digest !== modelDigest)
      throw Error("MODEL_CHANGED_DURING_PREPARATION");
    const versionData = await (
      await fetch("http://127.0.0.1:11434/api/version")
    ).json();
    if (versionData.version !== version) throw Error("MODEL_RUNTIME_CHANGED");
    console.log(
      "Pinned model installed; lock unchanged. No cloud features enabled.",
    );
  } finally {
    await stopModel();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
