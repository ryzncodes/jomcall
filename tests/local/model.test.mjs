import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBudget,
  validateModelManifest,
  ownedProcess,
} from "../../scripts/local/model-common.mjs";
test("model preparation refuses low disk, oversized weights and foreign process ownership", () => {
  assert.throws(() => assertBudget(9 * 1024 ** 3, "prepare"), /DISK_BUDGET/);
  assert.throws(() => assertBudget(4 * 1024 ** 3, "download"), /DISK_BUDGET/);
  assert.throws(
    () => validateModelManifest({ layers: [{ size: 5 * 1024 ** 3 }] }),
    /MODEL_BUDGET/,
  );
  assert.equal(
    ownedProcess("/foreign/ollama serve", "/project/.local/ollama/ollama"),
    false,
  );
  assert.equal(
    ownedProcess(
      "/project/.local/ollama/ollama serve",
      "/project/.local/ollama/ollama",
    ),
    true,
  );
});

test("runtime ownership requires saved PID, exact project executable and sole matching listener", async () => {
  const { mkdtemp, mkdir, writeFile, copyFile, rm, realpath } = await import(
    "node:fs/promises"
  );
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "jomcall-ownership-")),
  );
  try {
    await mkdir(join(dir, "packages/inference/src"), { recursive: true });
    await mkdir(join(dir, ".local"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "jomcall", private: true }),
    );
    await mkdir(join(dir, "tools"));
    await copyFile(
      new URL("../../packages/inference/src/runtime.mjs", import.meta.url),
      join(dir, "packages/inference/src/runtime.mjs"),
    );
    await writeFile(
      join(dir, ".local/model-process.json"),
      JSON.stringify({ pid: 12345 }),
    );
    await writeFile(
      join(dir, "tools/ps"),
      '#!/bin/sh\nprintf "%s\\n" "$QA_COMMAND"\n',
      { mode: 0o700 },
    );
    await writeFile(
      join(dir, "tools/lsof"),
      '#!/bin/sh\nprintf "%s\\n" "$QA_LISTENERS"\n',
      { mode: 0o700 },
    );
    const run = (command, listeners) =>
      spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {verifyProjectRuntime} from ${JSON.stringify(join(dir, "packages/inference/src/runtime.mjs"))}; await verifyProjectRuntime();`,
        ],
        {
          encoding: "utf8",
          cwd: dir,
          env: {
            ...process.env,
            PATH: join(dir, "tools"),
            QA_COMMAND: command,
            QA_LISTENERS: listeners,
          },
        },
      );
    const owned = join(dir, ".local/ollama/ollama") + " serve";
    assert.equal(run(owned, "12345").status, 0);
    for (const [command, listeners] of [
      [owned, "999"],
      ["/foreign/ollama serve", "12345"],
      [owned, "12345\n999"],
    ]) {
      assert.match(run(command, listeners).stderr, /MODEL_PROCESS_UNOWNED/);
    }
    await rm(join(dir, ".local/model-process.json"));
    assert.match(run(owned, "12345").stderr, /MODEL_PROCESS_UNOWNED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
