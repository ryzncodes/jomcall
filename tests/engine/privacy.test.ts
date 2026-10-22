import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { Engine } from "../../engine/src/engine.ts";
test("privacy jobs survive enqueue crash, export checks authority, deletion stays atomic and idempotent", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  let engine: Engine | undefined;
  try {
    const req = (method: string, path: string, body?: unknown) =>
      api.request(h.alice, h.orgA.id, method, "/api/v1" + path, body);
    const c = (
      await req("POST", "/contacts", {
        name: "Contoh Privasi",
        phone: null,
        preferredLanguage: "en",
      })
    ).body.data;
    assert.equal(
      (
        await api.request(
          h.staff,
          h.orgA.id,
          "POST",
          `/api/v1/contacts/${c.id}/export`,
          { expectedRevision: 1 },
        )
      ).status,
      403,
    );
    const exported = await req("POST", `/contacts/${c.id}/export`, {
      expectedRevision: 1,
    });
    assert.equal(exported.status, 200);
    const ex = exported.body.data;
    engine = await Engine.create(h.namespace);
    await engine.tick();
    let download = await req("GET", `/jobs/${ex.id}/download`);
    assert.equal(download.status, 200);
    assert.equal(download.body.contact.name, "Contoh Privasi");
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.equal(
      (
        await api.request(
          h.bob,
          h.orgB.id,
          "GET",
          `/api/v1/jobs/${ex.id}/download`,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await api.request(
          h.staff,
          h.orgA.id,
          "GET",
          `/api/v1/jobs/${ex.id}/download`,
        )
      ).status,
      403,
    );
    await h.cleanup.query(
      "update app.privacy_job set expires_at=now()-interval '1 second' where id=$1",
      [ex.id],
    );
    assert.equal((await req("GET", `/jobs/${ex.id}/download`)).status, 410);
    const deletion = await req("POST", `/contacts/${c.id}/deletion`, {
      expectedRevision: 1,
    });
    assert.equal(deletion.status, 200);
    const job = deletion.body.data;
    assert.equal(
      (
        await req("POST", `/contacts/${c.id}/notes`, {
          expectedRevision: 2,
          text: "Blocked",
        })
      ).status,
      409,
    );
    await assert.rejects(engine.tick("after-enqueue"), /INJECTED_CRASH/);
    await engine.close();
    engine = await Engine.create(h.namespace);
    await assert.rejects(engine.tick("before-commit"), /INJECTED_CRASH/);
    assert.equal((await req("GET", `/contacts/${c.id}`)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await engine.tick();
    await engine.tick();
    assert.equal(
      (await req("GET", `/jobs/${job.id}`)).body.data.state,
      "completed",
    );
    assert.equal((await req("GET", `/contacts/${c.id}`)).status, 404);
    assert.equal((await req("GET", `/jobs/${ex.id}/download`)).status, 404);
    assert.equal(
      (
        await h.cleanup.query(
          "select count(*) from app.audit_log where org_id=$1 and action='privacy.deleted'",
          [h.orgA.id],
        )
      ).rows[0].count,
      "1",
    );
    const worker = new pg.Pool({
      connectionString: process.env.WORKER_DATABASE_URL,
    });
    try {
      await assert.rejects(
        worker.query("select * from app.contact"),
        /permission denied/,
      );
      await assert.rejects(
        worker.query("update app.member set role='owner'"),
        /permission denied/,
      );
    } finally {
      await worker.end();
    }
  } finally {
    await engine?.close();
    await api.close();
    await h.close();
  }
});
