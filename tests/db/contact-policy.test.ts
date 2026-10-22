import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("cursor preserves microsecond ties and cannot cross tenants or search scope", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    await h.cleanup.query(
      "insert into app.contact(org_id,name,created_at)select $1,'Sample '||n,'2026-01-01T00:00:00.123456Z' from generate_series(1,3)n",
      [h.orgA.id],
    );
    const a = (
      await api.request(h.alice, h.orgA.id, "GET", "/api/v1/contacts?limit=1")
    ).body.data;
    assert.equal(a.items.length, 1);
    assert.ok(a.nextCursor);
    const b = (
      await api.request(
        h.alice,
        h.orgA.id,
        "GET",
        "/api/v1/contacts?limit=1&cursor=" + a.nextCursor,
      )
    ).body.data;
    assert.equal(b.items.length, 1);
    assert.notEqual(b.items[0].id, a.items[0].id);
    assert.equal(
      (
        await api.request(
          h.bob,
          h.orgB.id,
          "GET",
          "/api/v1/contacts?cursor=" + a.nextCursor,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "GET",
          "/api/v1/contacts?search=changed&cursor=" + a.nextCursor,
        )
      ).status,
      422,
    );
    await assert.rejects(
      h.sqlAsApp(h.staff, h.orgA.id, (tx) =>
        tx.query("delete from app.consent_record"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query("update app.consent_record set granted=false"),
      ),
      /permission denied/,
    );
  } finally {
    await api.close();
    await h.close();
  }
});
