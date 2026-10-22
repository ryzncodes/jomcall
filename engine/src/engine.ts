import pg from "pg";
import { PgBoss } from "pg-boss";
import nodemailer from "nodemailer";
import { z } from "zod";
import { decryptInvitationToken } from "../../packages/domain/src/invitation-crypto.ts";
const payload = z
  .object({
    outboxId: z.uuid(),
    resourceId: z.uuid(),
    kind: z.enum(["privacy.process", "invitation.deliver"]),
  })
  .strict();
function localDsn(value: string | undefined) {
  const u = new URL(value ?? "");
  if (u.hostname !== "127.0.0.1" || u.port !== "54622")
    throw Error("LOCAL_ONLY");
  return u.toString();
}
export class Engine {
  private pool: pg.Pool;
  private boss: PgBoss;
  private queue: string;
  private smtp: ReturnType<typeof nodemailer.createTransport>;
  private closed = false;
  private reconciliationCursor: string | null = null;
  private constructor(readonly namespace: string) {
    if (
      namespace !== "local" &&
      !(
        process.env.NODE_ENV === "test" &&
        /^test_[a-f0-9-]{36}$/.test(namespace)
      )
    )
      throw Error("INVALID_QUEUE_NAMESPACE");
    if (
      process.env.SMTP_HOST !== "127.0.0.1" ||
      process.env.SMTP_PORT !== "54625"
    )
      throw Error("LOCAL_SMTP_REQUIRED");
    this.pool = new pg.Pool({
      connectionString: localDsn(process.env.WORKER_DATABASE_URL),
      max: 3,
    });
    this.pool.on("error", () => console.error("WORKER_DATABASE_POOL_ERROR"));
    this.boss = new PgBoss({
      connectionString: localDsn(process.env.QUEUE_DATABASE_URL),
      schema: "pgboss",
      createSchema: false,
    });
    this.boss.on("error", () => console.error("QUEUE_ERROR"));
    this.queue = "core_" + namespace;
    this.smtp = nodemailer.createTransport({
      host: "127.0.0.1",
      port: 54625,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 5000,
      socketTimeout: 5000,
    });
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
              await this.smtp.sendMail({
                from: "JomCall <workspace@example.invalid>",
                to: p.email,
                subject: "Your local workspace invitation",
                text: `Join your workspace: http://127.0.0.1:4182/invite?token=${token}`,
                messageId: `${p.operationId}@jomcall.local`,
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
    return outbox.rowCount! + jobs.length;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.smtp.close();
    await this.boss.stop({ graceful: true, timeout: 5000 });
    await this.pool.end();
  }
}
