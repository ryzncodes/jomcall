import test from "node:test";
import assert from "node:assert/strict";
import { phoneFixture, fakeNumber } from "../helpers/phone.ts";
import { end, sentence } from "../helpers/voice-turn.ts";

const ENV = ["JOMCALL_TELEPHONY_PROVIDER", "JOMCALL_VOICE_PROVIDER"];

test("owners add and edit numbers; staff read only; one number belongs to one business", async () => {
  const p = await phoneFixture();
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const { h, api, req } = p;
  try {
    for (const k of ENV) delete process.env[k];
    const e164 = fakeNumber();
    const created = await req("POST", "/phone-numbers", {
      e164,
      label: "Kaunter utama",
      locationId: h.orgA.locationId,
      agentId: h.orgA.agentId,
      transferE164: fakeNumber(),
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.e164, e164);
    const list = (await req("GET", "/phone-numbers")).body.data;
    assert.equal(list.items.length, 1);
    // No provider configured: shown as not connected, with the reason by name only.
    assert.equal(list.provider.configured, false);
    assert.match(list.provider.reason, /JOMCALL_TELEPHONY_PROVIDER/);

    assert.equal(
      (
        await req("POST", "/phone-numbers", {
          e164: "0312345678",
          locationId: h.orgA.locationId,
          agentId: h.orgA.agentId,
        })
      ).status,
      422,
    );
    // Another business cannot take a number that is active here.
    const taken = await api.request(h.bob, h.orgB.id, "POST", "/api/v1/phone-numbers", {
      e164,
      locationId: h.orgB.locationId,
      agentId: h.orgB.agentId,
    });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, "NUMBER_IN_USE");
    // Nor point a number at another business's location.
    assert.equal(
      (
        await req("POST", "/phone-numbers", {
          e164: fakeNumber(),
          locationId: h.orgB.locationId,
          agentId: h.orgA.agentId,
        })
      ).status,
      404,
    );
    assert.equal(
      (await api.request(h.bob, h.orgB.id, "GET", "/api/v1/phone-numbers")).body.data.items.length,
      0,
    );

    const staffAdd = await api.request(h.staff, h.orgA.id, "POST", "/api/v1/phone-numbers", {
      e164: fakeNumber(),
      locationId: h.orgA.locationId,
      agentId: h.orgA.agentId,
    });
    assert.equal(staffAdd.status, 403);
    assert.equal(
      (await api.request(h.staff, h.orgA.id, "GET", "/api/v1/phone-numbers")).body.data.items.length,
      1,
    );

    const id = created.body.data.id;
    const off = await req("PATCH", `/phone-numbers/${id}`, {
      label: "Kaunter utama",
      locationId: h.orgA.locationId,
      agentId: h.orgA.agentId,
      transferE164: null,
      active: false,
      expectedRevision: 1,
    });
    assert.equal(off.status, 200);
    assert.equal(off.body.data.active, false);
    const stale = await req("PATCH", `/phone-numbers/${id}`, {
      label: "x",
      locationId: h.orgA.locationId,
      agentId: h.orgA.agentId,
      transferE164: null,
      active: true,
      expectedRevision: 1,
    });
    assert.equal(stale.status, 409);
    // Once switched off here, the other business may use it.
    const freed = await api.request(h.bob, h.orgB.id, "POST", "/api/v1/phone-numbers", {
      e164,
      locationId: h.orgB.locationId,
      agentId: h.orgB.agentId,
    });
    assert.equal(freed.status, 200);
  } finally {
    for (const k of ENV)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    await p.close();
  }
});

test("the call log reads real rows; staff get no words; other businesses see nothing", async () => {
  const p = await phoneFixture();
  const { h, api, req } = p;
  try {
    await p.publish();
    const dialled = await p.addNumber();
    const call = await p.ring(dialled);
    assert.equal(call.result.refusal, null);
    const model = p.scripted([sentence("Kami buka pukul sembilan."), end("Kami buka pukul sembilan.")]);
    await p.turn(call.result as any, "Pukul berapa buka?", model.model);

    const list = (await req("GET", "/calls")).body.data;
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].dialled_e164, dialled);
    assert.equal("token_hash" in list.items[0], false);
    const detail = (await req("GET", `/calls/${list.items[0].id}`)).body.data;
    assert.equal(detail.turns.length, 1);
    assert.equal(detail.turns[0].answer, "Kami buka pukul sembilan.");

    const staff = await api.request(h.staff, h.orgA.id, "GET", `/api/v1/calls/${list.items[0].id}`);
    assert.equal(staff.status, 200);
    assert.equal(staff.body.data.turns, null);
    assert.equal(
      (await api.request(h.bob, h.orgB.id, "GET", `/api/v1/calls/${list.items[0].id}`)).status,
      404,
    );
    assert.equal(
      (await api.request(h.bob, h.orgB.id, "GET", "/api/v1/calls")).body.data.items.length,
      0,
    );
    // Paging: a page of one hands back a cursor that reaches the end.
    await p.addNumber().then((n) => p.ring(n)).then((c) => p.h.cleanup.query(
      "update app.call set state='ended' where id=$1", [c.result.callId]));
    const first = (await req("GET", "/calls?limit=1")).body.data;
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    const second = (await req("GET", `/calls?limit=1&cursor=${first.nextCursor}`)).body.data;
    assert.equal(second.items.length, 1);
    assert.notEqual(second.items[0].id, first.items[0].id);
  } finally {
    await p.close();
  }
});
