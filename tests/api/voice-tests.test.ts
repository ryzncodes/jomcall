import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { TokenVerifier } from "livekit-server-sdk";
import { createPhase2Harness } from "../helpers/phase2.ts";
import {
  setVoiceRooms,
  VOICE_PRESETS,
  type VoiceRooms,
} from "../../packages/domain/src/agent-test/voice-session.ts";

const KEY = "APItestkey0001";
const SECRET = "test-secret-".padEnd(48, "s");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const settings = (over: Record<string, unknown> = {}) => ({
  name: "Contoh Agent",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "Hello, Contoh Room.",
  instructions: "Answer politely.",
  aiDisclosure: "Anda bercakap dengan pembantu AI.",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "Leda",
  ...over,
});

const ENV_KEYS = [
  "JOMCALL_VOICE_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
];
async function voiceFixture(over: Record<string, unknown> = {}) {
  const f = await createPhase2Harness();
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const calls: { room: string; agentName: string; metadata: string }[] = [];
  const rooms: VoiceRooms = {
    async start(call) {
      calls.push(call);
    },
  };
  setVoiceRooms(rooms);
  Object.assign(process.env, {
    JOMCALL_VOICE_PROVIDER: "hosted",
    LIVEKIT_URL: "ws://127.0.0.1:54630",
    LIVEKIT_API_KEY: KEY,
    LIVEKIT_API_SECRET: SECRET,
  });
  const put = await f.req("PUT", `/agents/${f.h.orgA.agentId}/draft`, {
    expectedRevision: 1,
    settings: settings(over),
  });
  assert.equal(put.status, 200);
  const session = (
    await f.req("POST", "/agent-tests", {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      source: { kind: "draft", expectedRevision: put.body.data.revision },
    })
  ).body.data;
  const start = (id = session.id, rev = session.revision) =>
    f.req("POST", `/agent-tests/${id}/voice`, { expectedSessionRevision: rev });
  const row = async () =>
    (
      await f.h.cleanup.query(
        "select channel,voice_token_hash,voice_expires_at,revision from app.test_session where id=$1",
        [session.id],
      )
    ).rows[0];
  return {
    ...f,
    session,
    calls,
    start,
    row,
    close: async () => {
      setVoiceRooms(null);
      for (const k of ENV_KEYS)
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      await f.close();
    },
  };
}

test("owner starts a voice test: room-only token, hashed one-call token, 300 s expiry, dispatch metadata", async () => {
  const f = await voiceFixture();
  try {
    const res = await f.start();
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.url, "ws://127.0.0.1:54630");
    assert.equal(data.voice, "Leda");
    assert.match(data.room, /^voice-/);
    const claims = await new TokenVerifier(KEY, SECRET).verify(data.token);
    assert.equal(claims.video?.room, data.room);
    assert.equal(claims.video?.roomJoin, true);
    assert.equal(claims.video?.roomAdmin, undefined);
    assert.equal(claims.video?.roomCreate, undefined);
    assert.equal(claims.video?.canPublish, true);
    await assert.rejects(
      new TokenVerifier(KEY, "x".repeat(48)).verify(data.token),
    );
    const row = await f.row();
    assert.equal(row.channel, "voice");
    assert.match(row.voice_token_hash, /^[0-9a-f]{64}$/);
    const seconds =
      (new Date(row.voice_expires_at).getTime() - Date.now()) / 1000;
    assert.ok(Math.abs(seconds - 300) <= 5, "expiry " + seconds);
    assert.ok(
      Math.abs(
        new Date(data.expiresAt).getTime() -
          new Date(row.voice_expires_at).getTime(),
      ) < 1000,
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].room, data.room);
    assert.equal(f.calls[0].agentName, "jomcall-voice");
    const meta = JSON.parse(f.calls[0].metadata);
    assert.deepEqual(Object.keys(meta).sort(), [
      "disclosure",
      "greeting",
      "sessionId",
      "voice",
      "voiceToken",
    ]);
    assert.equal(meta.sessionId, f.session.id);
    assert.equal(meta.voice, "Leda");
    assert.equal(meta.greeting, "Hello, Contoh Room.");
    assert.equal(meta.disclosure, "Anda bercakap dengan pembantu AI.");
    // The worker hashes the token string it receives, exactly as voice-server.ts does.
    assert.equal(sha(meta.voiceToken), row.voice_token_hash);
    assert.match(meta.voiceToken, /^[A-Za-z0-9\-._~+/]{1,512}=*$/);
    assert.notEqual(meta.voiceToken, data.token);
    assert.equal(JSON.stringify(res.body).includes(SECRET), false);
    assert.equal(JSON.stringify(res.body).includes(meta.voiceToken), false);
  } finally {
    await f.close();
  }
});

test("staff get 403, another organization gets 404, stale revision gets 409", async () => {
  const f = await voiceFixture();
  try {
    const body = { expectedSessionRevision: f.session.revision };
    const path = `/api/v1/agent-tests/${f.session.id}/voice`;
    assert.equal(
      (await f.api.request(f.h.staff, f.h.orgA.id, "POST", path, body)).status,
      403,
    );
    assert.equal(
      (await f.api.request(f.h.bob, f.h.orgB.id, "POST", path, body)).status,
      404,
    );
    assert.equal(
      (await f.start(f.session.id, f.session.revision + 5)).status,
      409,
    );
    assert.equal(f.calls.length, 0);
    assert.equal((await f.row()).channel, "text");
  } finally {
    await f.close();
  }
});

test("a voice test needs the AI disclosure text", async () => {
  const f = await voiceFixture({ aiDisclosure: "  " });
  try {
    const res = await f.start();
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "DISCLOSURE_REQUIRED");
    assert.equal(f.calls.length, 0);
    assert.equal((await f.row()).channel, "text");
  } finally {
    await f.close();
  }
});

test("voice is disabled unless the provider and all LiveKit values are set", async () => {
  const f = await voiceFixture();
  try {
    delete process.env.JOMCALL_VOICE_PROVIDER;
    const res = await f.start();
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "VOICE_DISABLED");
    const ready = (await f.req("GET", "/agent-tests/readiness")).body.data;
    assert.equal(ready.voice.configured, false);
    assert.match(ready.voice.reason, /JOMCALL_VOICE_PROVIDER/);
    process.env.JOMCALL_VOICE_PROVIDER = "hosted";
    delete process.env.LIVEKIT_API_SECRET;
    const partial = (await f.req("GET", "/agent-tests/readiness")).body.data;
    assert.equal(partial.voice.configured, false);
    assert.match(partial.voice.reason, /LIVEKIT_API_SECRET/);
    assert.equal(partial.voice.reason.includes(KEY), false);
    assert.equal((await f.start()).body.error.code, "VOICE_DISABLED");
    process.env.LIVEKIT_API_SECRET = SECRET;
    const ok = (await f.req("GET", "/agent-tests/readiness")).body.data;
    assert.deepEqual(ok.voice, { configured: true, reason: null });
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});

test("voice presets: an unknown name falls back to Kore, a listed one is kept", async () => {
  assert.deepEqual(
    [...VOICE_PRESETS],
    ["Kore", "Sulafat", "Leda", "Achird", "Charon"],
  );
  const nova = await voiceFixture({ voicePreference: "Nova" });
  try {
    const res = await nova.start();
    assert.equal(res.body.data.voice, "Kore");
    assert.equal(JSON.parse(nova.calls[0].metadata).voice, "Kore");
  } finally {
    await nova.close();
  }
  const leda = await voiceFixture({ voicePreference: "Leda" });
  try {
    assert.equal((await leda.start()).body.data.voice, "Leda");
  } finally {
    await leda.close();
  }
});

test("a second voice test replaces the token hash; the first token is rejected", async () => {
  const f = await voiceFixture();
  const agent = new pg.Pool({
    connectionString: process.env.AGENT_DATABASE_URL,
    max: 2,
  });
  try {
    const begin = async (token: string) =>
      agent.query(
        "select app_private.agent_voice('voice_begin',$1,$2,$3,null,null,$4)as value",
        [
          f.h.namespace,
          f.session.id,
          sha(token),
          JSON.stringify({
            input: "Kedai buka pukul berapa?",
            clientTurnId: crypto.randomUUID(),
          }),
        ],
      );
    await f.start();
    const first = JSON.parse(f.calls[0].metadata).voiceToken;
    await f.start();
    const second = JSON.parse(f.calls[1].metadata).voiceToken;
    assert.notEqual(first, second);
    assert.equal((await f.row()).voice_token_hash, sha(second));
    await assert.rejects(begin(first), /VOICE_UNAUTHORIZED/);
    const ok = await begin(second);
    assert.equal(ok.rows[0].value.session.id, f.session.id);
  } finally {
    await agent.end();
    await f.close();
  }
});

test("the plain voice token is stored nowhere, not even in audit or receipts", async () => {
  const f = await voiceFixture();
  try {
    await f.start();
    const token = JSON.parse(f.calls[0].metadata).voiceToken;
    const tables = (
      await f.h.cleanup.query(
        "select table_name from information_schema.tables where table_schema='app' and table_type='BASE TABLE'",
      )
    ).rows;
    assert.ok(tables.length > 10);
    for (const { table_name } of tables) {
      const hit = await f.h.cleanup.query(
        `select count(*)::int as n from app."${table_name}" t where t::text like $1`,
        ["%" + token + "%"],
      );
      assert.equal(hit.rows[0].n, 0, table_name);
    }
    const audit = await f.h.cleanup.query(
      "select count(*)::int as n from app.audit_log where action='agent_test.voice_started' and target_id=$1",
      [f.session.id],
    );
    assert.equal(audit.rows[0].n, 1);
  } finally {
    await f.close();
  }
});
