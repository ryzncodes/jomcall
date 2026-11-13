import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

// Needs no database and no free port: the process must stop before it opens
// either. No env file is loaded, so no real key can reach the child.
function start(extra: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    JOMCALL_MODE: "local",
    ...extra,
  };
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "engine/src/agent/index.ts"],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  return once(child, "exit").then(([code]) => {
    clearTimeout(timer);
    return { code: code as number | null, stderr };
  });
}

test("the agent process refuses to start hosted voice without the model key", async () => {
  const { code, stderr } = await start({ JOMCALL_VOICE_PROVIDER: "hosted" });
  assert.equal(code, 1);
  assert.match(stderr, /VOICE_MODEL_KEY_MISSING/);
});

test("the agent process rejects an unknown voice provider", async () => {
  const { code, stderr } = await start({ JOMCALL_VOICE_PROVIDER: "local" });
  assert.equal(code, 1);
  assert.match(stderr, /VOICE_PROVIDER_INVALID/);
});

test("an empty voice provider is not a voice configuration error", async () => {
  // With no database settings the process still stops, but not for voice.
  const { stderr } = await start({ JOMCALL_VOICE_PROVIDER: "" });
  assert.doesNotMatch(stderr, /VOICE_PROVIDER_INVALID|VOICE_MODEL_KEY_MISSING/);
});
