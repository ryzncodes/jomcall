import test from "node:test";
import assert from "node:assert/strict";
import { bookingFixture } from "../helpers/booking.ts";
import { Engine } from "../../engine/src/engine.ts";
test("contact-linked test snapshots export and delete with contact", async () => {
  const f = await bookingFixture();
  let engine: Engine | undefined;
  try {
    const made = await f.req("POST", "/agent-tests", {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      contactId: f.contact.id,
      source: { kind: "draft", expectedRevision: 1 },
    });
    assert.equal(made.status, 200);
    const ex = (
      await f.req("POST", `/contacts/${f.contact.id}/export`, {
        expectedRevision: 1,
      })
    ).body.data;
    engine = await Engine.create(f.h.namespace);
    await engine.tick();
    assert.equal(
      (await f.req("GET", `/jobs/${ex.id}/download`)).body.agentTests.length,
      1,
    );
    await f.req("POST", `/contacts/${f.contact.id}/deletion`, {
      expectedRevision: 1,
    });
    await engine.tick();
    assert.equal(
      (await f.req("GET", `/agent-tests/${made.body.data.id}`)).status,
      404,
    );
    assert.equal(
      (
        await f.h.cleanup.query(
          "select count(*) from app.test_session where id=$1",
          [made.body.data.id],
        )
      ).rows[0].count,
      "0",
    );
  } finally {
    await engine?.close();
    await f.close();
  }
});
