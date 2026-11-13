import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { bookingFixture } from "../helpers/booking.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

// A voice session as the web API will create it: channel, token hash, expiry.
async function voiceFixture(seconds = 300) {
  const f = await bookingFixture();
  const session = (
    await f.req("POST", "/agent-tests", {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      source: { kind: "draft", expectedRevision: 1 },
    })
  ).body.data;
  const token = randomUUID();
  try {
    await f.h.cleanup.query(
      "update app.test_session set channel='voice',voice_token_hash=$2,voice_expires_at=now()+$3*interval '1 second' where id=$1",
      [session.id, sha(token), seconds],
    );
  } catch (error) {
    await f.close();
    throw error;
  }
  const agent = new pg.Pool({
    connectionString: process.env.AGENT_DATABASE_URL,
    max: 2,
  });
  const voice = async (
    action: string,
    data: unknown = {},
    turn: string | null = null,
    lease: string | null = null,
    hash = sha(token),
    sessionId: string = session.id,
  ) =>
    (
      await agent.query(
        "select app_private.agent_voice($1,$2,$3,$4,$5,$6,$7)as value",
        [
          action,
          f.h.namespace,
          sessionId,
          hash,
          turn,
          lease,
          JSON.stringify(data),
        ],
      )
    ).rows[0].value;
  const begin = (input = "Kedai buka pukul berapa?") =>
    voice("voice_begin", { input, clientTurnId: randomUUID() });
  return {
    ...f,
    session,
    voice,
    begin,
    async close() {
      await agent.end();
      await f.close();
    },
  };
}

test("voice_begin authorizes by token hash and expiry, and returns the claim envelope", async () => {
  const f = await voiceFixture();
  try {
    await assert.rejects(
      f.voice(
        "voice_begin",
        { input: "Hai", clientTurnId: randomUUID() },
        null,
        null,
        sha("wrong"),
      ),
      /VOICE_UNAUTHORIZED/,
    );
    const envelope = await f.begin();
    assert.equal(envelope.turn.state, "running");
    assert.equal(envelope.turn.channel, "voice");
    assert.equal(envelope.turn.input, "Kedai buka pukul berapa?");
    assert.match(envelope.turn.lease_token, /^[0-9a-f-]{36}$/);
    const stored = (
      await f.h.cleanup.query(
        "select snapshot from app.test_session where id=$1",
        [f.session.id],
      )
    ).rows[0].snapshot;
    assert.deepEqual(envelope.session.snapshot, stored);
    assert.deepEqual(envelope.history, []);
    assert.ok(Array.isArray(envelope.resources));
    await f.h.cleanup.query(
      "update app.test_session set voice_expires_at=now()-interval '1 second' where id=$1",
      [f.session.id],
    );
    await assert.rejects(f.begin(), /VOICE_EXPIRED/);
  } finally {
    await f.close();
  }
});

test("a new spoken turn cancels the running one and removes its proposal", async () => {
  const f = await voiceFixture();
  try {
    const first = await f.begin("Tolong ambil pesanan.");
    await f.h.cleanup.query(
      "insert into app.test_proposal(org_id,session_id,turn_id,attempt,step,kind,details)values($1,$2,$3,1,0,'message','{\"text\":\"x\"}')",
      [f.h.orgA.id, f.session.id, first.turn.id],
    );
    await f.h.cleanup.query(
      "insert into app.test_tool_step(org_id,session_id,turn_id,attempt,step,tool,input,result)values($1,$2,$3,1,0,'take_message','{}','{}')",
      [f.h.orgA.id, f.session.id, first.turn.id],
    );
    const second = await f.begin("Sebenarnya, tak apa.");
    assert.notEqual(second.turn.id, first.turn.id);
    const state = (
      await f.h.cleanup.query("select state from app.test_turn where id=$1", [
        first.turn.id,
      ])
    ).rows[0].state;
    assert.equal(state, "cancelled");
    for (const table of ["test_proposal", "test_tool_step"])
      assert.equal(
        (
          await f.h.cleanup.query(
            `select count(*)::int as n from app.${table} where turn_id=$1`,
            [first.turn.id],
          )
        ).rows[0].n,
        0,
      );
  } finally {
    await f.close();
  }
});

test("a voice session allows 60 turns and refuses the 61st", async () => {
  const f = await voiceFixture();
  try {
    await f.h.cleanup.query(
      "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,channel)select $1,$2,gen_random_uuid(),'fixture','x','completed','voice' from generate_series(1,60)",
      [f.h.orgA.id, f.session.id],
    );
    await assert.rejects(f.begin(), /TURN_LIMIT/);
  } finally {
    await f.close();
  }
});

test("voice_complete stores answer, timings and evidence; a stale lease changes nothing", async () => {
  const f = await voiceFixture();
  try {
    const { turn } = await f.begin();
    const done = {
      answer: "Kami buka 9 pagi hingga 6 petang.",
      timings: { transcriptMs: 540, firstSentenceMs: 1040, totalMs: 1500 },
      evidence: ["abc:2:0"],
      usage: [{ input: 900, output: 30, cacheRead: 700 }],
    };
    assert.equal(
      await f.voice("voice_complete", done, turn.id, randomUUID()),
      null,
    );
    assert.equal(
      (
        await f.h.cleanup.query("select state from app.test_turn where id=$1", [
          turn.id,
        ])
      ).rows[0].state,
      "running",
    );
    assert.deepEqual(
      await f.voice("voice_complete", done, turn.id, turn.lease_token),
      {},
    );
    const row = (
      await f.h.cleanup.query(
        "select state,answer,timings,evidence,usage,lease_token from app.test_turn where id=$1",
        [turn.id],
      )
    ).rows[0];
    assert.equal(row.state, "completed");
    assert.equal(row.answer, done.answer);
    assert.deepEqual(row.timings, done.timings);
    assert.deepEqual(row.evidence, done.evidence);
    assert.deepEqual(row.usage, done.usage);
    assert.equal(row.lease_token, null);
    const next = await f.begin("Dan alamat?");
    assert.deepEqual(next.history, [
      { input: "Kedai buka pukul berapa?", answer: done.answer },
    ]);
  } finally {
    await f.close();
  }
});

test("voice_fail and voice_cancel end a running turn; cancel removes its proposal", async () => {
  const f = await voiceFixture();
  try {
    const a = await f.begin();
    assert.deepEqual(
      await f.voice(
        "voice_fail",
        { code: "UNSAFE_REPLY" },
        a.turn.id,
        a.turn.lease_token,
      ),
      {},
    );
    const failed = (
      await f.h.cleanup.query(
        "select state,error_code from app.test_turn where id=$1",
        [a.turn.id],
      )
    ).rows[0];
    assert.deepEqual(failed, { state: "failed", error_code: "UNSAFE_REPLY" });
    const b = await f.begin("Tolong ambil pesanan.");
    await f.h.cleanup.query(
      "insert into app.test_proposal(org_id,session_id,turn_id,attempt,step,kind,details)values($1,$2,$3,1,0,'message','{\"text\":\"x\"}')",
      [f.h.orgA.id, f.session.id, b.turn.id],
    );
    assert.deepEqual(
      await f.voice("voice_cancel", {}, b.turn.id, b.turn.lease_token),
      {},
    );
    assert.equal(
      (
        await f.h.cleanup.query("select state from app.test_turn where id=$1", [
          b.turn.id,
        ])
      ).rows[0].state,
      "cancelled",
    );
    assert.equal(
      (
        await f.h.cleanup.query(
          "select count(*)::int as n from app.test_proposal where turn_id=$1",
          [b.turn.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await f.close();
  }
});

test("the answer cache is scoped to organization, snapshot and language", async () => {
  const f = await voiceFixture();
  try {
    const entry = {
      language: "ms",
      key: "kedai buka pukul berapa",
      answer: "Kami buka 9 pagi hingga 6 petang.",
      evidence: ["abc:2:0"],
    };
    assert.equal(await f.voice("voice_cache_get", entry), null);
    assert.deepEqual(await f.voice("voice_cache_put", entry), {});
    assert.deepEqual(await f.voice("voice_cache_get", entry), {
      answer: entry.answer,
      evidence: entry.evidence,
    });
    assert.equal(
      await f.voice("voice_cache_get", { ...entry, language: "en" }),
      null,
    );
    await f.h.cleanup.query(
      "update app.test_session set snapshot_hash='different' where id=$1",
      [f.session.id],
    );
    assert.equal(await f.voice("voice_cache_get", entry), null);
    // Row-level security: only an active manager of the owning organization
    // reads the cache. Acting user, session and org are all set, so the zero
    // for orgB is the policy at work and the one for orgA proves the setup.
    const visibleTo = async (
      actor: { userId: string; sessionId: string },
      orgId: string,
    ) => {
      const app = new pg.Client({
        connectionString: process.env.APP_DATABASE_URL,
      });
      await app.connect();
      try {
        await app.query("begin");
        await app.query("select set_config('app.org_id',$1,true)", [orgId]);
        await app.query("select set_config('app.user_id',$1,true)", [
          actor.userId,
        ]);
        await app.query("select set_config('app.session_id',$1,true)", [
          actor.sessionId,
        ]);
        const n = (
          await app.query(
            "select count(*)::int as n from app.voice_answer_cache",
          )
        ).rows[0].n;
        await app.query("rollback");
        return n;
      } finally {
        await app.end();
      }
    };
    assert.equal(await visibleTo(f.h.bob, f.h.orgB.id), 0);
    assert.equal(await visibleTo(f.h.bob, f.h.orgA.id), 0);
    assert.equal(await visibleTo(f.h.alice, f.h.orgB.id), 0);
    assert.equal(await visibleTo(f.h.alice, f.h.orgA.id), 1);
    assert.equal(
      (
        await f.h.cleanup.query(
          "select count(*)::int as n from app.voice_answer_cache where org_id=$1",
          [f.h.orgA.id],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      f.voice("voice_cache_put", { ...entry, language: "xx" }),
      /INVALID_CACHE_ENTRY/,
    );
  } finally {
    await f.close();
  }
});

test("an organization B voice session cannot read organization A's cached answers", async () => {
  const f = await voiceFixture();
  try {
    const entry = {
      language: "ms",
      key: "kedai buka pukul berapa",
      answer: "Kami buka 9 pagi hingga 6 petang.",
      evidence: ["abc:2:0"],
    };
    assert.deepEqual(await f.voice("voice_cache_put", entry), {});
    const sessionB = (
      await f.api.request(f.h.bob, f.h.orgB.id, "POST", "/api/v1/agent-tests", {
        agentId: f.h.orgB.agentId,
        locationId: f.h.orgB.locationId,
        source: { kind: "draft", expectedRevision: 1 },
      })
    ).body.data;
    const tokenB = randomUUID();
    // Same snapshot hash, same language and key: only the organization differs.
    await f.h.cleanup.query(
      "update app.test_session set channel='voice',voice_token_hash=$2,voice_expires_at=now()+interval '300 seconds',snapshot_hash=(select snapshot_hash from app.test_session where id=$3) where id=$1",
      [sessionB.id, sha(tokenB), f.session.id],
    );
    const hashes = (
      await f.h.cleanup.query(
        "select org_id,snapshot_hash from app.test_session where id in($1,$2)",
        [f.session.id, sessionB.id],
      )
    ).rows;
    assert.equal(hashes.length, 2);
    assert.equal(hashes[0].snapshot_hash, hashes[1].snapshot_hash);
    assert.notEqual(hashes[0].org_id, hashes[1].org_id);
    assert.equal(
      await f.voice(
        "voice_cache_get",
        entry,
        null,
        null,
        sha(tokenB),
        sessionB.id,
      ),
      null,
    );
    // Control: orgA's own session still hits.
    assert.deepEqual(await f.voice("voice_cache_get", entry), {
      answer: entry.answer,
      evidence: entry.evidence,
    });
  } finally {
    await f.close();
  }
});
