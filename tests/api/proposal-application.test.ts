import test from "node:test";
import assert from "node:assert/strict";
import { agentFixture } from "../helpers/agent-test.ts";
import { Engine } from "../../engine/src/engine.ts";
test("reviewed application binds contact and creates one request across independent operation keys", async () => {
  const f = await agentFixture();
  let engine: Engine | undefined;
  try {
    const p = (
      await f.h.cleanup.query(
        "insert into app.test_proposal(org_id,session_id,turn_id,attempt,step,kind,details)values($1,$2,$3,1,0,'booking',$4)returning *",
        [
          f.h.orgA.id,
          f.session.id,
          f.turn.id,
          { resourceId: f.resource.id, startAt: f.slotStart, title: "Contoh" },
        ],
      )
    ).rows[0];
    const path = `/agent-tests/${f.session.id}/proposals/${p.id}/apply`;
    const input = { contactId: f.contact.id, expectedProposalRevision: 1 };
    assert.equal((await f.req("POST", path, input)).status, 409);
    await f.h.cleanup.query(
      "update app.test_turn set state='completed' where id=$1",
      [f.turn.id],
    );
    const both = await Promise.all([
      f.req("POST", path, input),
      f.req("POST", path, input),
    ]);
    assert.equal(both[0].status, 200, JSON.stringify(both[0].body));
    assert.equal(both[1].status, 200);
    assert.equal(both[0].body.data.id, both[1].body.data.id);
    assert.equal(both[0].body.data.status, "requested");
    assert.equal(
      (await f.req("GET", `/agent-tests/${f.session.id}`)).body.data.contact_id,
      f.contact.id,
    );
    assert.equal(
      (await f.req("POST", path, { ...input, contactId: crypto.randomUUID() }))
        .status,
      404,
    );
    await f.req("POST", `/contacts/${f.contact.id}/deletion`, {
      expectedRevision: 1,
    });
    engine = await Engine.create(f.h.namespace);
    await engine.tick();
    assert.equal((await f.req("POST", path, input)).status, 404);
  } finally {
    await engine?.close();
    await f.close();
  }
});
