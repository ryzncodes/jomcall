import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { agentFixture } from "../helpers/agent-test.ts";
import { AgentRunner } from "../../engine/src/agent/runner.ts";
import { submitTurn } from "../../packages/domain/src/agent-test/turns.ts";
import { Engine } from "../../engine/src/engine.ts";
test("agent work rechecks auth at finalization while privacy stays independent; worker cannot read arbitrary tenant tables", async () => {
  const f = await agentFixture();
  let runner: AgentRunner | undefined;
  let core: Engine | undefined;
  try {
    await f.h.cleanup.query("delete from app.test_turn where id=$1", [
      f.turn.id,
    ]);
    await f.h.db.withUserTransaction(f.h.alice, f.h.orgA.id, (tx, ctx) =>
      submitTurn(
        tx,
        ctx,
        f.session.id,
        {
          text: "Hello",
          expectedSessionRevision: 1,
          clientTurnId: randomUUID(),
        },
        randomUUID(),
        {
          configured: true,
          available: true,
          modelDigest: "a".repeat(64),
          reason: null,
        },
      ),
    );
    let release!: (v: any) => void;
    let claimed!: () => void;
    const barrier = new Promise<void>((r) => (claimed = r));
    runner = await AgentRunner.create(f.h.namespace, {
      generate: async () => {
        claimed();
        return new Promise((r) => (release = r));
      },
    });
    const pending = runner.tick();
    await Promise.race([
      barrier,
      pending.then(() => {
        throw Error("MODEL_NOT_INVOKED");
      }),
    ]);
    const ex = (
      await f.req("POST", `/contacts/${f.contact.id}/export`, {
        expectedRevision: 1,
      })
    ).body.data;
    core = await Engine.create(f.h.namespace);
    await core.tick();
    assert.equal(
      (await f.req("GET", `/jobs/${ex.id}`)).body.data.state,
      "completed",
    );
    await f.h.cleanup.query("delete from auth.sessions where id=$1", [
      f.h.alice.sessionId,
    ]);
    release({ kind: "answer", text: "Revoked", citations: [] });
    await pending;
    const row = (
      await f.h.cleanup.query(
        "select * from app.test_turn where session_id=$1",
        [f.session.id],
      )
    ).rows[0];
    assert.notEqual(row.state, "completed");
    assert.equal(row.answer, null);
    const pool = new pg.Pool({
      connectionString: process.env.AGENT_DATABASE_URL,
    });
    try {
      await assert.rejects(
        pool.query("select * from app.contact"),
        /permission denied/,
      );
      await assert.rejects(
        pool.query("update app.booking set status='confirmed'"),
        /permission denied/,
      );
    } finally {
      await pool.end();
    }
  } finally {
    await runner?.close();
    await core?.close();
    await f.close();
  }
});
test("contact erasure during model execution removes linked session and rejects stale output", async () => {
  const f = await agentFixture();
  let runner: AgentRunner | undefined;
  let core: Engine | undefined;
  try {
    await f.h.cleanup.query("delete from app.test_turn where id=$1", [
      f.turn.id,
    ]);
    await f.h.cleanup.query(
      "update app.test_session set contact_id=$2 where id=$1",
      [f.session.id, f.contact.id],
    );
    await f.h.db.withUserTransaction(f.h.alice, f.h.orgA.id, (tx, ctx) =>
      submitTurn(
        tx,
        ctx,
        f.session.id,
        {
          text: "Hello",
          expectedSessionRevision: 1,
          clientTurnId: randomUUID(),
        },
        randomUUID(),
        {
          configured: true,
          available: true,
          modelDigest: "a".repeat(64),
          reason: null,
        },
      ),
    );
    let release!: (v: any) => void;
    let claimed!: () => void;
    const barrier = new Promise<void>((r) => (claimed = r));
    runner = await AgentRunner.create(f.h.namespace, {
      generate: async () => {
        claimed();
        return new Promise((r) => (release = r));
      },
    });
    const pending = runner.tick();
    await Promise.race([
      barrier,
      pending.then(() => {
        throw Error("MODEL_NOT_INVOKED");
      }),
    ]);
    await f.req("POST", `/contacts/${f.contact.id}/deletion`, {
      expectedRevision: 1,
    });
    core = await Engine.create(f.h.namespace);
    await core.tick();
    release({ kind: "answer", text: "Deleted data", citations: [] });
    await pending;
    assert.equal(
      (await f.req("GET", `/agent-tests/${f.session.id}`)).status,
      404,
    );
    assert.equal(
      (
        await f.h.cleanup.query(
          "select count(*) from app.test_turn where session_id=$1",
          [f.session.id],
        )
      ).rows[0].count,
      "0",
    );
  } finally {
    await runner?.close();
    await core?.close();
    await f.close();
  }
});
test('agent maintenance bounds terminal reconciliation work per tick',async()=>{
 const {AgentRepository}=await import('../../engine/src/agent/repository.ts');const f=await agentFixture();const repo=new AgentRepository(f.h.namespace);
 try{
 const sessions=(await f.h.cleanup.query("insert into app.test_session(org_id,agent_id,location_id,creator_id,auth_session_id,snapshot,snapshot_hash,source,namespace)select org_id,agent_id,location_id,creator_id,auth_session_id,snapshot,snapshot_hash,source,namespace from app.test_session cross join generate_series(1,110)where id=$1 returning id",[f.session.id])).rows;
 for(const s of sessions)await f.h.cleanup.query("insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,lease_until)values($1,$2,gen_random_uuid(),'fixture','Test','running',now()-interval '1 second')",[f.h.orgA.id,s.id]);
 await repo.op('maintain');const n=(await f.h.cleanup.query("select count(*)from app.test_turn where org_id=$1 and state='failed'",[f.h.orgA.id])).rows[0].count;assert.equal(n,'100');
 }finally{await repo.close();await f.close();}
});
