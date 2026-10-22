import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { agentFixture } from "../helpers/agent-test.ts";
import { AgentRunner } from "../../engine/src/agent/runner.ts";
import { submitTurn } from "../../packages/domain/src/agent-test/turns.ts";
const ready = {
  configured: true,
  available: true,
  modelDigest: "a".repeat(64),
  reason: null,
};
test("durable agent queue deduplicates turns and ignores late answer after cancellation", async () => {
  const f = await agentFixture();
  let runner: AgentRunner | undefined;
  try {
    await f.h.cleanup.query("delete from app.test_turn where id=$1", [
      f.turn.id,
    ]);
    const input = {
      text: "Hello",
      expectedSessionRevision: 1,
      clientTurnId: randomUUID(),
    };
    const submit = () =>
      f.h.db.withUserTransaction(f.h.alice, f.h.orgA.id, (tx, ctx) =>
        submitTurn(tx, ctx, f.session.id, input, randomUUID(), ready),
      );
    const turn = await submit();
    assert.equal((await submit()).id, turn.id);
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
    const current = (await f.req("GET", `/agent-tests/${f.session.id}`)).body
      .data.turns[0];
    assert.equal(
      (
        await f.req(
          "POST",
          `/agent-tests/${f.session.id}/turns/${turn.id}/cancel`,
          { expectedRevision: current.revision },
        )
      ).status,
      200,
    );
    release({ kind: "answer", text: "Late answer", citations: [] });
    await pending;
    const saved = (await f.req("GET", `/agent-tests/${f.session.id}`)).body.data
      .turns[0];
    assert.equal(saved.state, "cancelled");
    assert.equal(saved.answer, null);
  } finally {
    await runner?.close();
    await f.close();
  }
});
test("enqueue crash resumes once; claimed crash reconciles to failure and explicit retry increments generation", async () => {
  const f = await agentFixture();
  let runner: AgentRunner | undefined;
  try {
    await f.h.cleanup.query("delete from app.test_turn where id=$1", [
      f.turn.id,
    ]);
    const turn = await f.h.db.withUserTransaction(
      f.h.alice,
      f.h.orgA.id,
      (tx, ctx) =>
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
          ready,
        ),
    );
    runner = await AgentRunner.create(f.h.namespace, {
      generate: async () => ({ kind: "answer", text: "Hello", citations: [] }),
    });
    await assert.rejects(runner.tick("after-enqueue"), /INJECTED_CRASH/);
    await runner.close();
    runner = await AgentRunner.create(f.h.namespace, {
      generate: async () => ({ kind: "answer", text: "Hello", citations: [] }),
    });
    await assert.rejects(runner.tick("after-claim"), /INJECTED_CRASH/);
    await f.h.cleanup.query(
      "update app.test_turn set lease_until=now()-interval '1 second' where id=$1",
      [turn.id],
    );
    await runner.tick();
    assert.equal(
      (await f.req("GET", `/agent-tests/${f.session.id}`)).body.data.turns[0]
        .state,
      "failed",
    );
  } finally {
    await runner?.close();
    await f.close();
  }
});
test("killed worker after claim becomes retryable; same turn succeeds with a new generation", async () => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { controlTurn } = await import(
    "../../packages/domain/src/agent-test/turns.ts"
  );
  const f = await agentFixture();
  let child: ReturnType<typeof spawn> | undefined;
  let runner: AgentRunner | undefined;
  try {
    await f.h.cleanup.query("delete from app.test_turn where id=$1", [
      f.turn.id,
    ]);
    const t = await f.h.db.withUserTransaction(
      f.h.alice,
      f.h.orgA.id,
      (tx, ctx) =>
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
          ready,
        ),
    );
    child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/helpers/agent-child.ts"],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          JOMCALL_QUEUE_NAMESPACE: f.h.namespace,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("CLAIM_TIMEOUT")), 10000);
      child!.stdout!.on("data", (b) => {
        if (String(b).includes("CLAIMED_TURN")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child!.once("exit", () => {
        clearTimeout(timer);
        reject(Error("EARLY_EXIT"));
      });
    });
    child.kill("SIGKILL");
    await once(child, "exit");
    child = undefined;
    await f.h.cleanup.query(
      "update app.test_turn set lease_until=now()-interval '1 second' where id=$1",
      [t.id],
    );
    runner = await AgentRunner.create(f.h.namespace, {
      generate: async () => ({ kind: "answer", text: "Hello", citations: [] }),
    });
    await runner.tick();
    const failed = (await f.req("GET", `/agent-tests/${f.session.id}`)).body
      .data.turns[0];
    assert.equal(failed.state, "failed");
    const retried = await f.h.db.withUserTransaction(
      f.h.alice,
      f.h.orgA.id,
      (tx, ctx) =>
        controlTurn(
          tx,
          ctx,
          f.session.id,
          t.id,
          "retry",
          { expectedRevision: failed.revision },
          randomUUID(),
          ready,
        ),
    );
    assert.equal(retried.attempt, 2);
    await runner.tick();
    const saved = (await f.req("GET", `/agent-tests/${f.session.id}`)).body.data
      .turns[0];
    assert.equal(saved.state, "completed");
    assert.equal(saved.answer, "Hello");
  } finally {
    if (child) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await runner?.close();
    await f.close();
  }
});

test("subsequent turn receives bounded completed dialogue in chronological order", async () => {
  const f = await agentFixture();
  let runner: AgentRunner | undefined;
  try {
    await f.h.cleanup.query("delete from app.test_turn where id=$1", [
      f.turn.id,
    ]);
    const seen: { role: string; content: string }[][] = [];
    runner = await AgentRunner.create(f.h.namespace, {
      generate: async ({ messages }) => {
        seen.push(messages);
        return {
          kind: "answer",
          text: "Which time would you like?",
          citations: [],
        };
      },
    });
    for (const text of [
      "I want a consultation on 2026-10-20.",
      "At 10 AM, please.",
    ]) {
      const detail = (await f.req("GET", `/agent-tests/${f.session.id}`)).body
        .data;
      await f.h.db.withUserTransaction(f.h.alice, f.h.orgA.id, (tx, ctx) =>
        submitTurn(
          tx,
          ctx,
          f.session.id,
          {
            text,
            expectedSessionRevision: detail.revision,
            clientTurnId: randomUUID(),
          },
          randomUUID(),
          ready,
        ),
      );
      await runner.tick();
    }
    const dialogue = seen[1].filter((m) => m.role !== "system");
    assert.deepEqual(dialogue.slice(0, 3), [
      { role: "user", content: "I want a consultation on 2026-10-20." },
      { role: "assistant", content: "Which time would you like?" },
      { role: "user", content: "At 10 AM, please." },
    ]);
  } finally {
    await runner?.close();
    await f.close();
  }
});
