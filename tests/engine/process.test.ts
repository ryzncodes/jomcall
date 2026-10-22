import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("engine process restart resumes durable jobs without a browser", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  let child: ChildProcess | undefined;
  const boot = async () => {
    const c = spawn(
      process.execPath,
      ["--import", "tsx", "engine/src/index.ts"],
      {
        env: {
          ...process.env,
          JOMCALL_MODE: "local",
          NODE_ENV: "test",
          JOMCALL_QUEUE_NAMESPACE: h.namespace,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child = c;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("ENGINE_START_TIMEOUT")),
        10000,
      );
      c.stdout!.on("data", (b) => {
        if (String(b).includes("Local engine ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      c.once("exit", () => {
        clearTimeout(timer);
        reject(Error("ENGINE_EARLY_EXIT"));
      });
    });
  };
  try {
    await boot();
    child!.kill("SIGKILL");
    await once(child!, "exit");
    child = undefined;
    const c = (
      await api.request(h.alice, h.orgA.id, "POST", "/api/v1/contacts", {
        name: "Process fixture",
        phone: null,
        preferredLanguage: "en",
      })
    ).body.data;
    const job = (
      await api.request(
        h.alice,
        h.orgA.id,
        "POST",
        `/api/v1/contacts/${c.id}/deletion`,
        { expectedRevision: 1 },
      )
    ).body.data;
    assert.equal(job.state, "pending");
    await boot();
    let state = "pending";
    for (let i = 0; i < 30 && state === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      state = (
        await h.cleanup.query("select state from app.privacy_job where id=$1", [
          job.id,
        ])
      ).rows[0].state;
    }
    assert.equal(state, "completed");
    child!.kill("SIGTERM");
    await once(child!, "exit");
    child = undefined;
    assert.equal(
      (
        await h.cleanup.query("select count(*) from app.contact where id=$1", [
          c.id,
        ])
      ).rows[0].count,
      "0",
    );
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await api.close();
    await h.close();
  }
});
