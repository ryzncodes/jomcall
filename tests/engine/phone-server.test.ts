import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { phoneFixture, fakeNumber } from "../helpers/phone.ts";
import { startPhoneServer } from "../../engine/src/agent/phone-server.ts";
import { end, sentence } from "../helpers/voice-turn.ts";

test("the phone server starts a call, streams a turn with the call token, and ends it", async () => {
  const f = await phoneFixture();
  const model = f.scripted([sentence("Hello there."), end("Hello there.")]);
  const server = await startPhoneServer({ ...f.deps, model: model.model }, { host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, body: unknown, token?: string) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: JSON.stringify(body),
    });
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const room = "call-" + dialled + "_x1";
    const identity = "sip_" + fakeNumber();
    f.telephony.addCaller(room, identity, {
      "sip.trunkPhoneNumber": dialled,
      "sip.callID": "SCL_" + randomUUID(),
      "sip.phoneNumber": fakeNumber(),
    });
    // The worker may only name a room and an identity.
    assert.equal((await post("/phone/calls", { room, identity, dialled: "+60300000000" })).status, 400);
    assert.equal((await post("/phone/calls", { room, identity: "sip_other" })).status, 403);
    const started = await (await post("/phone/calls", { room, identity })).json();
    assert.equal(started.refusal, null);
    const turn = { callId: started.callId, transcript: "Hello", clientTurnId: randomUUID(), heardAtMs: 1 };
    assert.equal((await post("/phone/turns", turn)).status, 401);
    assert.equal((await post("/phone/turns", turn, "f".repeat(64))).status, 401);
    const res = await post("/phone/turns", turn, started.token);
    assert.equal(res.status, 200);
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(events.map((e) => e.type), ["started", "sentence", "done"]);
    assert.equal((await post(`/phone/calls/${started.callId}/answered`, {}, started.token)).status, 200);
    assert.equal((await post(`/phone/calls/${started.callId}/end`, { reason: "hangup", language: "en" }, started.token)).status, 200);
    assert.equal((await post(`/phone/calls/${started.callId}/end`, { reason: "hangup" }, started.token)).status, 401);
    const row = await f.row(started.callId);
    assert.equal(row.state, "ended");
    assert.equal(row.outcome, "answered");
    assert.ok(row.disclosure_played_at);
  } finally {
    await server.close();
    await f.close();
  }
});
