import test from "node:test";
import assert from "node:assert/strict";
import { phoneFixture } from "../helpers/phone.ts";

test("first run: a new workspace has nothing done", async () => {
  const p = await phoneFixture({ entitled: false });
  try {
    const r = await p.req("GET", "/first-run");
    assert.equal(r.status, 200);
    const v = r.body.data;
    assert.equal(v.published, false);
    assert.equal(v.tested, false);
    assert.equal(v.setupApplied, false);
    assert.equal(v.plan.chosen, false);
    assert.equal(v.phone.active, false);
    assert.equal(v.phone.activeE164, null);
    assert.equal(v.firstCall, null);
  } finally {
    await p.close();
  }
});

test("first run: an answered real call is the first call; refused and unanswered are not", async () => {
  const p = await phoneFixture();
  try {
    await p.publish();
    const dialled = await p.addNumber();
    const left = await p.ring(dialled);
    const taken = await p.ring(dialled);
    const set = (id: string, outcome: string, answered: boolean) =>
      p.h.cleanup.query(
        "update app.call set state='ended',outcome=$2,answered_at=case when $3 then started_at end where id=$1",
        [id, outcome, answered],
      );
    // Dropped before the answer: not a first call.
    await set(left.result.callId as string, "abandoned", false);
    let v = (await p.req("GET", "/first-run")).body.data;
    assert.equal(v.published, true);
    assert.equal(v.plan.chosen, true);
    assert.equal(v.phone.active, true);
    assert.equal(v.phone.activeE164, dialled);
    assert.equal(v.firstCall, null);
    // Answered, then ended by a worker crash as abandoned: it still counts.
    await set(taken.result.callId as string, "abandoned", true);
    v = (await p.req("GET", "/first-run")).body.data;
    assert.equal(v.firstCall.id, taken.result.callId);
    assert.ok(!Number.isNaN(Date.parse(v.firstCall.startedAt)));
    await set(taken.result.callId as string, "refused", false);
    assert.equal((await p.req("GET", "/first-run")).body.data.firstCall, null);
  } finally {
    await p.close();
  }
});

test("first run: staff are refused and another business sees none of it", async () => {
  const p = await phoneFixture();
  const { h, api } = p;
  try {
    await p.publish();
    const c = await p.ring(await p.addNumber());
    await h.cleanup.query("update app.call set state='ended',outcome='answered',answered_at=started_at where id=$1", [c.result.callId]);
    const staff = await api.request(h.staff, h.orgA.id, "GET", "/api/v1/first-run");
    assert.equal(staff.status, 403);
    const other = await api.request(h.bob, h.orgB.id, "GET", "/api/v1/first-run");
    assert.equal(other.status, 200);
    assert.equal(other.body.data.firstCall, null);
    assert.equal(other.body.data.published, false);
  } finally {
    await p.close();
  }
});
