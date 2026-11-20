import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { phoneFixture, fakeNumber } from "../helpers/phone.ts";
import { entitle } from "../helpers/billing.ts";
import { Engine } from "../../engine/src/engine.ts";
import { phoneRoute } from "../../packages/domain/src/phone/routes.ts";
import { FakeSender } from "../../engine/src/mail.ts";
import {
  nationalNumber,
  openRequestMail,
  readyRequestMail,
  type PhoneRequestNotices,
} from "../../engine/src/phone-request.ts";

process.env.NODE_ENV = "test";
const ENV = [
  "JOMCALL_TELEPHONY_PROVIDER",
  "JOMCALL_VOICE_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
];

// The worker login role, as the engine uses it.
async function notices(): Promise<PhoneRequestNotices> {
  const c = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL });
  await c.connect();
  try {
    return (await c.query("select app_private.phone_request_notices() as value")).rows[0].value;
  } finally {
    await c.end();
  }
}

test("a number request: needs a plan with a number, one at a time, managers only, and a new number answers it", async () => {
  const p = await phoneFixture({ entitled: false });
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const { h, api, req } = p;
  try {
    Object.assign(process.env, {
      JOMCALL_TELEPHONY_PROVIDER: "livekit_sip",
      JOMCALL_VOICE_PROVIDER: "hosted",
      LIVEKIT_URL: "ws://127.0.0.1:1",
      LIVEKIT_API_KEY: "test-key",
      LIVEKIT_API_SECRET: "test-secret",
    });
    const channels = async () =>
      (await api.request(h.alice, h.orgA.id, "GET", "/api/v1/channels")).body.data;
    // No plan: nothing to ask for, and the page stays hidden.
    let list = (await req("GET", "/phone-numbers")).body.data;
    assert.equal(list.request, null);
    assert.equal(list.planIncludesNumber, false);
    assert.equal((await channels()).phone, false);
    const refused = await req("POST", "/phone-number-requests", { area: "penang" });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, "PLAN_REQUIRED");

    await entitle(h.cleanup, h.orgA.id, { plan: "starter" });
    list = (await req("GET", "/phone-numbers")).body.data;
    assert.equal(list.planIncludesNumber, true);
    assert.equal((await channels()).phone, true);

    // Bad input, and staff may not ask.
    assert.equal((await req("POST", "/phone-number-requests", { area: "mars" })).status, 422);
    assert.equal(
      (await req("POST", "/phone-number-requests", { area: "penang", forwardFrom: "0312345678" })).status,
      422,
    );
    assert.equal(
      (await api.request(h.staff, h.orgA.id, "POST", "/api/v1/phone-number-requests", { area: "penang" })).status,
      403,
    );

    const own = fakeNumber();
    const made = await req("POST", "/phone-number-requests", { area: "penang", forwardFrom: own });
    assert.equal(made.status, 200);
    assert.equal(made.body.data.state, "open");
    assert.equal(made.body.data.area, "penang");
    assert.equal(made.body.data.forward_from, own);
    const again = await req("POST", "/phone-number-requests", { area: "johor" });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "REQUEST_OPEN");
    // Staff see the request; another business does not.
    assert.equal(
      (await api.request(h.staff, h.orgA.id, "GET", "/api/v1/phone-numbers")).body.data.request.state,
      "open",
    );
    assert.equal(
      (await api.request(h.bob, h.orgB.id, "GET", "/api/v1/phone-numbers")).body.data.request,
      null,
    );

    // The engine's read, as the worker role: the operator is told once, and
    // not again inside four hours.
    // (Every engine on this database reads the same function, so the row is
    // reset first in case another one has just claimed it.)
    await h.cleanup.query("update app.phone_number_request set operator_noticed_at=null where id=$1", [made.body.data.id]);
    const first = await notices();
    const mine = first.open.find((r) => r.id === made.body.data.id);
    assert.ok(mine);
    assert.equal(mine.orgId, h.orgA.id);
    assert.equal(mine.area, "penang");
    assert.equal(mine.forwardFrom, own);
    assert.ok(mine.requestedBy?.includes("@"));
    assert.equal((await notices()).open.some((r) => r.id === made.body.data.id), false);
    await h.cleanup.query(
      "update app.phone_number_request set operator_noticed_at=now()-interval '5 hours' where id=$1",
      [made.body.data.id],
    );
    assert.equal((await notices()).open.some((r) => r.id === made.body.data.id), true);

    // A number that is off answers nothing.
    const off = fakeNumber();
    await h.cleanup.query(
      "insert into app.phone_number(org_id,location_id,agent_id,e164,active)values($1,$2,$3,$4,false)",
      [h.orgA.id, h.orgA.locationId, h.orgA.agentId, off],
    );
    assert.equal((await req("GET", "/phone-numbers")).body.data.request.state, "open");
    await h.cleanup.query("delete from app.phone_number where e164=$1", [off]);

    // The operator adds the number: the request is answered and the owners
    // are told, again until the engine confirms the send, three times at most.
    const e164 = await p.addNumber();
    list = (await req("GET", "/phone-numbers")).body.data;
    assert.equal(list.request.state, "ready");
    assert.ok(list.request.ready_at);
    const ready = await notices();
    const told = ready.ready.find((r) => r.id === made.body.data.id);
    assert.ok(told);
    assert.equal(told.e164, e164);
    assert.equal(told.emails.length, 1);
    assert.equal(told.lastTry, false);
    assert.equal(ready.open.some((r) => r.id === made.body.data.id), false);
    assert.equal((await notices()).ready.some((r) => r.id === made.body.data.id), true);
    const third = (await notices()).ready.find((r) => r.id === made.body.data.id);
    assert.equal(third?.lastTry, true);
    assert.equal((await notices()).ready.some((r) => r.id === made.body.data.id), false);
    // Confirmed: never returned again.
    await h.cleanup.query("update app.phone_number_request set owner_attempts=0 where id=$1", [made.body.data.id]);
    const c = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL });
    await c.connect();
    try {
      await c.query("select app_private.phone_request_sent($1)", [made.body.data.id]);
    } finally {
      await c.end();
    }
    assert.equal((await notices()).ready.some((r) => r.id === made.body.data.id), false);

    // With a number, there is nothing more to ask for.
    const more = await req("POST", "/phone-number-requests", { area: "any" });
    assert.equal(more.status, 409);
    assert.equal(more.body.error.code, "NUMBER_EXISTS");
  } finally {
    for (const k of ENV)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    await p.close();
  }
});

test("request emails: the operator gets the workspace and area, owners get their number in English and BM", () => {
  const open = openRequestMail({
    id: "r1",
    orgId: "o1",
    orgName: "Kedai\nContoh",
    area: "penang",
    forwardFrom: "+60312345678",
    requestedAt: "2026-11-20T03:00:00Z",
    requestedBy: "owner@example.test",
  });
  assert.equal(open.subject, "JomCall: phone number requested (Kedai Contoh)");
  assert.match(open.text, /Area wanted: penang/);
  assert.match(open.text, /Their existing number: \+60312345678/);
  assert.equal(nationalNumber("+60412345678"), "0412345678");
  const ready = readyRequestMail({ id: "r1", e164: "+60412345678", emails: [] }, "https://app.example.test/");
  assert.match(ready.text, /Your JomCall phone number is ready: \+60412345678/);
  assert.match(ready.text, /Nombor telefon JomCall anda sudah sedia: \+60412345678/);
  assert.match(ready.text, /call forwarding on that line to 0412345678/);
  assert.match(ready.text, /https:\/\/app\.example\.test\/app\/phone-numbers/);
});

test("the engine mails the operator for an open request and each owner for a ready one, and logs a count", async () => {
  const p = await phoneFixture({ entitled: false });
  let engine: Engine | undefined;
  const lines: string[] = [];
  const original = console.error;
  try {
    let t = 1_000_000;
    let answer: PhoneRequestNotices = {
      open: [{ id: "r1", orgId: "o1", orgName: "Kedai Contoh", area: "any", forwardFrom: null, requestedAt: "2026-11-20T03:00:00Z", requestedBy: null }],
      ready: [
        { id: "r2", e164: "+60412345678", emails: ["a@example.test", "b@example.test"] },
        { id: "r3", e164: null, emails: ["c@example.test"], lastTry: true },
      ],
    };
    let checks = 0;
    const confirmed: string[] = [];
    const mail = new FakeSender();
    engine = await Engine.create(p.h.namespace, {
      mail,
      phoneRequests: {
        firstAfterMs: 60_000,
        everyMs: 300_000,
        now: () => t,
        operatorEmail: "ops@example.test",
        sent: async (_pool, id) => {
          confirmed.push(id);
        },
        notices: async () => {
          checks++;
          const a = answer;
          answer = { open: [], ready: [] };
          return a;
        },
      },
    });
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    await engine.tick();
    assert.equal(checks, 0);
    t += 60_000;
    await engine.tick();
    await engine.tick();
    assert.equal(checks, 1);
    const sent = mail.sent.filter((m) => /phone/i.test(m.operationId));
    assert.deepEqual(sent.map((m) => m.to).sort(), ["a@example.test", "b@example.test", "ops@example.test"]);
    assert.ok(lines.includes("PHONE_NUMBER_REQUESTED open=1"));
    // Only the request whose owners were all written to is confirmed; the
    // one with no number is logged on its last try.
    assert.deepEqual(confirmed, ["r2"]);
    assert.ok(lines.includes("PHONE_REQUEST_READY_UNSENT id=r3"));
    assert.ok(sent.every((m) => !m.operationId.includes("@")));
    t += 300_000;
    await engine.tick();
    assert.equal(checks, 2);
    assert.equal(mail.sent.filter((m) => /phone/i.test(m.operationId)).length, 3);
  } finally {
    console.error = original;
    await engine?.close();
    await p.close();
  }
});

test("hosted mode: a number cannot be added from the app, whoever asks", async () => {
  // The guard sits before any database use, so no connection is needed.
  const saved = process.env.JOMCALL_MODE;
  const ctx = {
    identity: { userId: "00000000-0000-4000-8000-000000000001", sessionId: "s", confirmedEmail: "owner@example.test" },
    orgId: "00000000-0000-4000-8000-000000000002",
    role: "owner",
  } as never;
  const body = {
    e164: fakeNumber(),
    locationId: "00000000-0000-4000-8000-000000000003",
    agentId: "00000000-0000-4000-8000-000000000004",
  };
  try {
    process.env.JOMCALL_MODE = "hosted";
    await assert.rejects(
      () => phoneRoute({} as never, ctx, "POST", "/phone-numbers", body, "k", new URLSearchParams()),
      (e: any) => e.code === "FORBIDDEN" && e.status === 403,
    );
  } finally {
    if (saved === undefined) delete process.env.JOMCALL_MODE;
    else process.env.JOMCALL_MODE = saved;
  }
});
