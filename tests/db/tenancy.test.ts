import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
test("tenant isolation, bootstrap idempotency and pool context cleanup", async () => {
  const h = await createHarness();
  try {
    await h.sqlAsApp(h.alice, h.orgA.id, async (tx) =>
      assert.deepEqual(
        (await tx.query("select id from app.organization")).rows.map(
          (x) => x.id,
        ),
        [h.orgA.id],
      ),
    );
    await assert.rejects(
      h.sqlAsApp(h.bob, h.orgA.id, async () => 1),
      /NOT_FOUND/,
    );
    await assert.rejects(
      h.sqlAsApp(
        { ...h.alice, sessionId: randomUUID() },
        h.orgA.id,
        async () => 1,
      ),
      /UNAUTHORIZED/,
    );
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, async (tx) => {
        await tx.query(
          "update app.organization set name='Rollback' where id=$1",
          [h.orgA.id],
        );
        throw Error("rollback");
      }),
      /rollback/,
    );
    await h.sqlAsApp(h.bob, h.orgB.id, async (tx) =>
      assert.deepEqual(
        (await tx.query("select id from app.organization")).rows.map(
          (x) => x.id,
        ),
        [h.orgB.id],
      ),
    );
    await assert.rejects(
      h.sqlAsApp(h.staff, h.orgA.id, (tx) =>
        tx.query("insert into app.location(org_id,name) values($1,'Illegal')", [
          h.orgB.id,
        ]),
      ),
      /row-level security/,
    );
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query("set role jomcall_bootstrap"),
      ),
      /permission denied/,
    );
    const key = randomUUID(),
      body = {
        name: "Idempotent Example",
        businessType: "other",
        primaryLocationName: "Primary",
      };
    const a = await h.db.bootstrap(h.alice, body, { idempotencyKey: key }),
      b = await h.db.bootstrap(h.alice, body, { idempotencyKey: key });
    assert.deepEqual(a, b);
    await assert.rejects(
      h.db.bootstrap(
        h.alice,
        { ...body, name: "Changed" },
        { idempotencyKey: key },
      ),
      /CONFLICT/,
    );
    await h.cleanup.query("delete from app.organization where id=$1", [
      a.orgId,
    ]);
  } finally {
    await h.close();
  }
});
