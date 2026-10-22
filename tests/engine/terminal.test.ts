import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { failJobsByTimeout } from "../../node_modules/pg-boss/dist/plans.js";
import { Engine } from "../../engine/src/engine.ts";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";

test("exhausted claimed attempts become retryable; stale terminal operations cannot fail a new retry", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  const q = new pg.Pool({ connectionString: process.env.QUEUE_DATABASE_URL });
  let engine: Engine | undefined;
  try {
    const req = (method: string, path: string, body?: unknown) =>
      api.request(h.alice, h.orgA.id, method, "/api/v1" + path, body);
    const c = (
      await req("POST", "/contacts", {
        name: "Contoh Interrupted",
        phone: null,
        preferredLanguage: "en",
      })
    ).body.data;
    const j = (
      await req("POST", `/contacts/${c.id}/deletion`, { expectedRevision: 1 })
    ).body.data;
    engine = await Engine.create(h.namespace);
    await assert.rejects(engine.tick("after-enqueue"), /INJECTED_CRASH/);
    const boss = (engine as unknown as { boss: PgBoss }).boss,
      name = "core_" + h.namespace;
    const queue = await boss.getQueue(name);
    for (let i = 0; i < 5; i++) {
      const [claimed] = await boss.fetch(name, { includeMetadata: true });
      assert.ok(claimed);
      await q.query(
        "update pgboss.job set started_on=now()-interval '2 minutes' where name=$1 and id=$2",
        [name, claimed.id],
      );
      await q.query(failJobsByTimeout("pgboss", queue!.table, [name], true));
      await q.query("update pgboss.job set start_after=now() where name=$1", [
        name,
      ]);
    }
    const old = (
      await h.cleanup.query(
        "update app.outbox set delivered_at=now(),lease_until=null where namespace=$1 returning id",
        [h.namespace],
      )
    ).rows[0].id;
    await engine.tick();
    assert.equal((await req("GET", `/jobs/${j.id}`)).body.data.state, "failed");
    assert.equal(
      (await req("GET", `/contacts/${c.id}`)).body.data.deletion_pending,
      true,
    );
    assert.equal((await req("POST", `/jobs/${j.id}/retry`, {})).status, 200);
    // A stale reconciliation result must not fail the newly requested operation.
    const worker = new pg.Pool({
      connectionString: process.env.WORKER_DATABASE_URL,
    });
    try {
      await worker.query("select app_private.fail_terminal_outbox($1,$2)", [
        old,
        h.namespace,
      ]);
    } finally {
      await worker.end();
    }
    assert.equal(
      (await req("GET", `/jobs/${j.id}`)).body.data.state,
      "pending",
    );
    await engine.tick();
    await engine.tick();
    assert.equal(
      (await req("GET", `/jobs/${j.id}`)).body.data.state,
      "completed",
    );
    assert.equal((await req("GET", `/contacts/${c.id}`)).status, 404);
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
    await q.end();
    await api.close();
    await h.close();
  }
});
