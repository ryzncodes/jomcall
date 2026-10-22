import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { Engine } from "../../engine/src/engine.ts";
test("failed deletion remains locked; explicit retry completes same logical job", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  const worker = new pg.Pool({
    connectionString: process.env.WORKER_DATABASE_URL,
  });
  let engine: Engine | undefined;
  try {
    const req = (method: string, path: string, body?: unknown) =>
      api.request(h.alice, h.orgA.id, method, "/api/v1" + path, body);
    const c = (
      await req("POST", "/contacts", {
        name: "Contoh Retry",
        phone: null,
        preferredLanguage: "en",
      })
    ).body.data;
    const j = (
      await req("POST", `/contacts/${c.id}/deletion`, { expectedRevision: 1 })
    ).body.data;
    for (let n = 0; n < 5; n++)
      await worker.query("select app_private.fail_work($1,$2)", [
        j.id,
        h.namespace,
      ]);
    assert.equal((await req("GET", `/jobs/${j.id}`)).body.data.state, "failed");
    assert.equal(
      (await req("GET", `/contacts/${c.id}`)).body.data.deletion_pending,
      true,
    );
    assert.equal(
      (await req("POST", `/jobs/${j.id}/retry`, {})).body.data.id,
      j.id,
    );
    engine = await Engine.create(h.namespace);
    await engine.tick();
    await engine.tick();
    assert.equal(
      (await req("GET", `/jobs/${j.id}`)).body.data.state,
      "completed",
    );
    assert.equal(
      (
        await h.cleanup.query(
          "select count(*) from app.audit_log where org_id=$1 and action='privacy.deleted'",
          [h.orgA.id],
        )
      ).rows[0].count,
      "1",
    );
  } finally {
    await engine?.close();
    await worker.end();
    await api.close();
    await h.close();
  }
});
