import pg from "pg";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import {
  databaseConnection,
  validNamespace,
} from "../../packages/contracts/src/hosting.ts";
import { createMailSender, type MailSender } from "./mail.ts";
import { decryptInvitationToken } from "../../packages/domain/src/invitation-crypto.ts";
const payload = z
  .object({
    outboxId: z.uuid(),
    resourceId: z.uuid(),
    kind: z.enum(["privacy.process", "invitation.deliver"]),
  })
  .strict();
function dsn(name: "WORKER_DATABASE_URL" | "QUEUE_DATABASE_URL") {
  return databaseConnection(process.env[name], name, process.env, "LOCAL_ONLY");
}
export class Engine {
  private pool: pg.Pool;
  private boss: PgBoss;
  private queue: string;
  private mail: MailSender;
  // Set by each tick that ran to the end; the health check reads it.
  lastTickAt = 0;
  private closed = false;
  private reconciliationCursor: string | null = null;
  private constructor(readonly namespace: string) {
    validNamespace(namespace);
    // Local mode: Mailpit on loopback. Hosted mode: SMTP with TLS, or
    // Cloudflare Email Service when JOMCALL_MAIL_PROVIDER=cloudflare.
    this.mail = createMailSender();
    this.pool = new pg.Pool({
      ...dsn("WORKER_DATABASE_URL"),
      max: 3,
    });
    this.pool.on("error", () => console.error("WORKER_DATABASE_POOL_ERROR"));
    this.boss = new PgBoss({
      ...dsn("QUEUE_DATABASE_URL"),
      schema: "pgboss",
      createSchema: false,
    });
    this.boss.on("error", () => console.error("QUEUE_ERROR"));
    this.queue = "core_" + namespace;
  }
  static async create(namespace = "local") {
    const e = new Engine(namespace);
    try {
      await e.boss.start();
      await e.boss.createQueue(e.queue, {
        retryLimit: 4,
        retryDelay: 1,
        retryBackoff: true,
        retryDelayMax: 60,
        expireInSeconds: 30,
      });
      return e;
    } catch (err) {
      await e.close();
      throw err;
    }
  }
  private async reconcileTerminalWork() {
    const pending = await this.pool.query(
      "select * from app_private.unsettled_outbox($1,$2,20)",
      [this.namespace, this.reconciliationCursor],
    );
    for (const operation of pending.rows) {
      const [job] = await this.boss.findJobs(this.queue, {
        id: operation.operation_id,
      });
      // Missing retained queue records are also recoverable via an explicit domain retry.
      if (!job || job.state === "failed" || job.state === "cancelled") {
        await this.pool.query(
          "select app_private.fail_terminal_outbox($1,$2)",
          [operation.id, this.namespace],
        );
      }
    }
    this.reconciliationCursor =
      pending.rows.length === 20 ? pending.rows.at(-1)!.id : null;
  }
  async tick(failAt?: "after-enqueue" | "before-commit") {
    if (failAt && process.env.NODE_ENV !== "test") throw Error("TEST_ONLY");
    await this.pool.query("select app_private.maintain_jobs($1)", [
      this.namespace,
    ]);
    await this.reconcileTerminalWork();
    const outbox = await this.pool.query(
      "select * from app_private.claim_outbox($1,20)",
      [this.namespace],
    );
    for (const o of outbox.rows) {
      await this.boss.send(
        this.queue,
        { outboxId: o.id, resourceId: o.resource_id, kind: o.kind },
        { id: o.operation_id },
      );
      if (failAt === "after-enqueue") throw Error("INJECTED_CRASH");
      await this.pool.query("select app_private.ack_outbox($1,$2)", [
        o.id,
        this.namespace,
      ]);
    }
    const jobs = await this.boss.fetch(this.queue, {
      batchSize: 2,
      includeMetadata: true,
    });
    await Promise.all(
      jobs.map(async (job) => {
        let parsed: z.infer<typeof payload> | undefined;
        try {
          parsed = payload.parse(job.data);
          if (parsed.kind === "privacy.process") {
            const tx = await this.pool.connect();
            try {
              await tx.query("begin");
              await tx.query("select app_private.process_privacy($1,$2)", [
                parsed.resourceId,
                this.namespace,
              ]);
              if (failAt === "before-commit") throw Error("INJECTED_CRASH");
              await tx.query("commit");
            } catch (e) {
              await tx.query("rollback");
              throw e;
            } finally {
              tx.release();
            }
          } else {
            const p = (
              await this.pool.query(
                "select app_private.invitation_payload($1,$2) as value",
                [parsed.outboxId, this.namespace],
              )
            ).rows[0].value;
            if (p) {
              const token = decryptInvitationToken(
                p.ciphertext,
                process.env.INVITATION_KEY!,
                p.orgId + p.id,
              );
              await this.mail.send({
                to: p.email,
                subject: this.mail.subject,
                text: `Join your workspace: ${this.mail.inviteBase}/invite?token=${token}`,
                operationId: p.operationId,
              });
              await this.pool.query(
                "select app_private.ack_invitation($1,$2,false)",
                [parsed.outboxId, this.namespace],
              );
            }
          }
          await this.boss.complete(this.queue, job.id);
        } catch (e) {
          if (e instanceof Error && e.message === "INJECTED_CRASH") {
            await this.boss.fail(this.queue, job.id, { code: "INTERRUPTED" });
            await this.boss.retry(this.queue, job.id);
            throw e;
          }
          if (parsed?.kind === "privacy.process")
            await this.pool.query("select app_private.fail_work($1,$2)", [
              parsed.resourceId,
              this.namespace,
            ]);
          if (parsed?.kind === "invitation.deliver" && job.retryCount >= 4)
            await this.pool.query(
              "select app_private.ack_invitation($1,$2,true)",
              [parsed.outboxId, this.namespace],
            );
          await this.boss.fail(this.queue, job.id, {
            code: "PROCESSING_FAILED",
          });
          console.error("WORK_FAILED", job.id);
        }
      }),
    );
    this.lastTickAt = Date.now();
    return outbox.rowCount! + jobs.length;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.mail.close?.();
    await this.boss.stop({ graceful: true, timeout: 5000 });
    await this.pool.end();
  }
}
