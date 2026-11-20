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

test("first run: an answered real call is the first call; refused and abandoned are not", async () => {
  const p = await phoneFixture();
  try {
    await p.publish();
    const dialled = await p.addNumber();
    const left = await p.ring(dialled);
    const taken = await p.ring(dialled);
    const set = (id: string, outcome: string) =>
      p.h.cleanup.query("update app.call set state='ended',outcome=$2 where id=$1", [id, outcome]);
    await set(left.result.callId as string, "abandoned");
    let v = (await p.req("GET", "/first-run")).body.data;
    assert.equal(v.published, true);
    assert.equal(v.plan.chosen, true);
    assert.equal(v.phone.active, true);
    assert.equal(v.phone.activeE164, dialled);
    assert.equal(v.firstCall, null);
    await set(taken.result.callId as string, "answered");
    v = (await p.req("GET", "/first-run")).body.data;
    assert.equal(v.firstCall.id, taken.result.callId);
    assert.ok(!Number.isNaN(Date.parse(v.firstCall.startedAt)));
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
    await h.cleanup.query("update app.call set state='ended',outcome='answered' where id=$1", [c.result.callId]);
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
