import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

test("fresh checkout installs from committed lock and refuses registry drift before download", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jomcall-model-"));
  try {
    const manifest = JSON.stringify({ layers: [{ size: 123 }] });
    const lock = JSON.parse(
      await readFile(
        new URL("../../infra/local/model-lock.json", import.meta.url),
        "utf8",
      ),
    );
    lock.modelDigest = createHash("sha256").update(manifest).digest("hex");
    await writeFile(join(dir, "lock.json"), JSON.stringify(lock));
    await writeFile(
      join(dir, "model-prepare.mjs"),
      await readFile(
        new URL("../../scripts/local/model-prepare.mjs", import.meta.url),
      ),
    );
    await writeFile(
      join(dir, "model-common.mjs"),
      `export const root=${JSON.stringify(dir + "/")},bin=root+'missing-binary',lockPath=root+'lock.json'; export const disk=async()=>{}; export const validateModelManifest=()=>123; export const readLock=async()=>JSON.parse(await (await import('node:fs/promises')).readFile(lockPath)); export const startModel=async()=>{throw Error('UNEXPECTED_START')}; export const stopModel=async()=>{};`,
    );
    await writeFile(
      join(dir, "transport.mjs"),
      `globalThis.fetch=async(url)=> { if(String(url).includes('/manifests/')) return new Response(process.env.DRIFT?'{}':${JSON.stringify(manifest)}); process.stdout.write('RUNTIME_DOWNLOAD_ATTEMPT\\n'); return new Response('',{status:503}); };`,
    );
    const run = (drift) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          join(dir, "transport.mjs"),
          join(dir, "model-prepare.mjs"),
          "--download",
        ],
        { encoding: "utf8", env: { ...process.env, DRIFT: drift ? "1" : "" } },
      );
    const fresh = run(false);
    assert.match(fresh.stderr, /RUNTIME_DOWNLOAD_FAILED/);
    assert.match(fresh.stdout, /RUNTIME_DOWNLOAD_ATTEMPT/);
    const changed = run(true);
    assert.match(changed.stderr, /MODEL_LOCK_MISMATCH/);
    assert.doesNotMatch(changed.stdout, /RUNTIME_DOWNLOAD_ATTEMPT/);
    assert.deepEqual(
      JSON.parse(await readFile(join(dir, "lock.json"), "utf8")),
      lock,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
