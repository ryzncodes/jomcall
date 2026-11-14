import { PgBoss } from "pg-boss";
import {
  databaseConnection,
  validNamespace,
} from "../../../packages/contracts/src/hosting.ts";
import { z } from "zod";
import { AgentRepository } from "./repository.ts";
import { type ModelClient } from "../../../packages/inference/src/index.ts";
import {
  configuredProvider,
  createModelClient,
} from "../../../packages/inference/src/provider.ts";
import { agentRules } from "../../../packages/domain/src/agent-test/prompt.ts";
import { runTextBrain } from "./brain.ts";
const jobSchema = z
  .object({ turnId: z.uuid(), operationId: z.uuid() })
  .strict();
export class AgentRunner {
  private repository: AgentRepository;
  private boss: PgBoss;
  private queue: string;
  private model?: ModelClient;
  private closed = false;
  private constructor(
    readonly namespace: string,
    model?: ModelClient,
  ) {
    validNamespace(namespace);
    if (model && process.env.NODE_ENV !== "test") throw Error("TEST_ONLY");
    this.model = model;
    const queue = databaseConnection(
      process.env.QUEUE_DATABASE_URL,
      "QUEUE_DATABASE_URL",
    );
    this.repository = new AgentRepository(namespace);
    this.boss = new PgBoss({
      ...queue,
      schema: "pgboss",
      createSchema: false,
    });
    this.boss.on("error", () => console.error("AGENT_QUEUE_ERROR"));
    this.queue = "agent_" + namespace;
  }
  static async create(namespace = "local", model?: ModelClient) {
    const r = new AgentRunner(namespace, model);
    try {
      await r.boss.start();
      await r.boss.createQueue(r.queue, { retryLimit: 0, expireInSeconds: 90 });
      return r;
    } catch (e) {
      await r.close();
      throw e;
    }
  }
  async tick(failAt?: "after-enqueue" | "after-claim" | "before-finalize") {
    if (failAt && process.env.NODE_ENV !== "test") throw Error("TEST_ONLY");
    await this.repository.op("maintain");
    const pending = await this.repository.op("pending");
    for (const t of pending) {
      const [job] = await this.boss.findJobs(this.queue, {
        id: t.operation_id,
      });
      if (!job || ["failed", "cancelled"].includes(job.state))
        await this.repository.op("fail", t.id, t.operation_id, null, {
          code: "TURN_INTERRUPTED",
        });
    }
    const outbox = await this.repository.op("outbox");
    for (const o of outbox) {
      await this.boss.send(
        this.queue,
        { turnId: o.resource_id, operationId: o.operation_id },
        { id: o.operation_id },
      );
      if (failAt === "after-enqueue") throw Error("INJECTED_CRASH");
      await this.repository.op("ack", o.id);
    }
    const jobs = await this.boss.fetch(this.queue, { batchSize: 1 });
    for (const job of jobs) {
      const ids = jobSchema.parse(job.data);
      const envelope = await this.repository.op(
        "claim",
        ids.turnId,
        ids.operationId,
      );
      if (!envelope) {
        await this.boss.complete(this.queue, job.id);
        continue;
      }
      if (failAt === "after-claim") throw Error("INJECTED_CRASH");
      try {
        await this.run(envelope, failAt === "before-finalize");
      } catch (e) {
        if (e instanceof Error && e.message === "INJECTED_CRASH") throw e;
        const message = e instanceof Error ? e.message : "";
        const code = /^[A-Z_]{1,60}$/.test(message) ? message : "TURN_FAILED";
        await this.repository.op("fail", ids.turnId, ids.operationId, null, {
          code,
        });
      }
      await this.boss.complete(this.queue, job.id);
    }
  }
  private async run(e: any, failBefore = false) {
    // A session pins the model identity on its first turn. A different
    // provider or model must not silently answer later turns.
    const config = this.model ? null : await configuredProvider();
    if (!this.model && (!config || config.identity !== e.session.model_digest))
      throw Error("MODEL_CHANGED");
    const model = this.model ?? (await createModelClient(config!));
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(60000),
    ]);
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        if (
          !(await this.repository.op(
            "context",
            e.turn.id,
            e.turn.operation_id,
            e.turn.lease_token,
          ))
        )
          controller.abort();
      } catch {
        controller.abort();
      } finally {
        checking = false;
      }
    }, 1000);
    timer.unref();
    try {
      const answer = await runTextBrain({
        model,
        signal,
        rules: agentRules,
        snapshot: e.session.snapshot,
        text: e.turn.input,
        history: e.history ?? [],
        resources: e.resources,
        access: this.repository.access(e),
      });
      if (failBefore) throw Error("INJECTED_CRASH");
      await this.repository.op(
        "complete",
        e.turn.id,
        e.turn.operation_id,
        e.turn.lease_token,
        answer,
      );
    } finally {
      clearInterval(timer);
      controller.abort();
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.boss.stop({ graceful: false });
    await this.repository.close();
  }
}
