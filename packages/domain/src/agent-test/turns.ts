import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import {
  turnInput,
  revisionInput,
  type Readiness,
  type TestTurn,
} from "../../../contracts/src/agent-test.ts";
import { command } from "../../../db/src/receipts.ts";
import { loadSession } from "./sessions.ts";
import { namespace } from "../authorization.ts";
export function publicTurn(row: Record<string, any>): TestTurn {
  const {
    id,
    session_id,
    revision,
    attempt,
    state,
    input,
    answer,
    citations,
    error_code,
    created_at,
  } = row;
  return {
    id,
    session_id,
    revision,
    attempt,
    state,
    input,
    answer,
    citations,
    error_code,
    created_at,
  };
}
function requireModel(ready: Readiness) {
  if (!ready.available || !ready.modelDigest)
    throw new AppError(ready.reason ?? "MODEL_UNAVAILABLE", 503);
  return ready.modelDigest;
}
export async function submitTurn(
  tx: PoolClient,
  ctx: TenantContext,
  sessionId: string,
  body: unknown,
  key: string,
  ready: Readiness,
) {
  const v = turnInput.parse(body);
  const digest = requireModel(ready);
  return command(
    tx,
    ctx,
    key,
    "submitTestTurn",
    { sessionId, ...v },
    async () => {
      const s = await loadSession(tx, ctx, sessionId, true);
      if (
        s.creator_id !== ctx.identity.userId ||
        s.auth_session_id !== ctx.identity.sessionId
      )
        throw new AppError("TEST_SESSION_OWNER", 403);
      if (s.model_digest && s.model_digest !== digest)
        throw new AppError("MODEL_CHANGED", 409);
      const hash = createHash("sha256").update(v.text).digest("hex");
      const prior = (
        await tx.query(
          "select * from app.test_turn where org_id=$1 and session_id=$2 and client_turn_id=$3",
          [ctx.orgId, sessionId, v.clientTurnId],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new AppError("CONFLICT", 409);
        return { ref: { id: prior.id }, data: publicTurn(prior) };
      }
      if (s.revision !== v.expectedSessionRevision)
        throw new AppError("CONFLICT", 409);
      const turns = (
        await tx.query(
          "select state from app.test_turn where org_id=$1 and session_id=$2",
          [ctx.orgId, sessionId],
        )
      ).rows;
      if (turns.length >= 20) throw new AppError("TEST_TURN_LIMIT", 429);
      if (turns.some((t) => ["queued", "running"].includes(t.state)))
        throw new AppError("TURN_ACTIVE", 409);
      const row = (
        await tx.query(
          "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input)values($1,$2,$3,$4,$5)returning *",
          [ctx.orgId, sessionId, v.clientTurnId, hash, v.text],
        )
      ).rows[0];
      await tx.query(
        "update app.test_session set revision=revision+1,model_digest=$3 where org_id=$1 and id=$2",
        [ctx.orgId, sessionId, digest],
      );
      await tx.query(
        "insert into app.outbox(org_id,namespace,kind,resource_id,operation_id)values($1,$2,'agent.turn',$3,$4)",
        [ctx.orgId, namespace(), row.id, row.operation_id],
      );
      return { ref: { id: row.id }, data: publicTurn(row) };
    },
    async (ref) => {
      await loadSession(tx, ctx, sessionId);
      const row = (
        await tx.query(
          "select * from app.test_turn where org_id=$1 and session_id=$2 and id=$3",
          [ctx.orgId, sessionId, ref.id],
        )
      ).rows[0];
      if (!row) throw new AppError("NOT_FOUND", 404);
      return publicTurn(row);
    },
  );
}
export async function controlTurn(
  tx: PoolClient,
  ctx: TenantContext,
  sessionId: string,
  id: string,
  action: "cancel" | "retry",
  body: unknown,
  key: string,
  ready?: Readiness,
) {
  const v = revisionInput.parse(body);
  return command(
    tx,
    ctx,
    key,
    "testTurn." + action,
    { sessionId, id, ...v },
    async () => {
      const s = await loadSession(tx, ctx, sessionId, true);
      const t = (
        await tx.query(
          "select * from app.test_turn where org_id=$1 and session_id=$2 and id=$3 for update",
          [ctx.orgId, sessionId, id],
        )
      ).rows[0];
      if (!t) throw new AppError("NOT_FOUND", 404);
      if (t.revision !== v.expectedRevision)
        throw new AppError("CONFLICT", 409);
      if (action === "cancel") {
        if (!["queued", "running"].includes(t.state))
          throw new AppError("CONFLICT", 409);
        await tx.query(
          "update app.test_turn set state='cancelled',revision=revision+1,lease_token=null,lease_until=null where id=$1",
          [id],
        );
      } else {
        const digest = requireModel(ready!);
        if (
          s.creator_id !== ctx.identity.userId ||
          s.auth_session_id !== ctx.identity.sessionId
        )
          throw new AppError("TEST_SESSION_OWNER", 403);
        if (s.model_digest !== digest) throw new AppError("MODEL_CHANGED", 409);
        if (t.state !== "failed") throw new AppError("CONFLICT", 409);
        if (
          (
            await tx.query(
              "select id from app.test_turn where org_id=$1 and session_id=$2 and state in('queued','running')",
              [ctx.orgId, sessionId],
            )
          ).rowCount
        )
          throw new AppError("TURN_ACTIVE", 409);
        await tx.query(
          "delete from app.test_proposal where org_id=$1 and turn_id=$2 and applied_booking_id is null",
          [ctx.orgId, id],
        );
        await tx.query(
          "delete from app.test_tool_step where org_id=$1 and turn_id=$2",
          [ctx.orgId, id],
        );
        const updated = (
          await tx.query(
            "update app.test_turn set state='queued',attempt=attempt+1,revision=revision+1,operation_id=gen_random_uuid(),lease_token=null,lease_until=null,error_code=null,answer=null,citations='[]',usage='[]' where id=$1 returning *",
            [id],
          )
        ).rows[0];
        await tx.query(
          "insert into app.outbox(org_id,namespace,kind,resource_id,operation_id)values($1,$2,'agent.turn',$3,$4)",
          [ctx.orgId, namespace(), id, updated.operation_id],
        );
      }
      await tx.query(
        "update app.test_session set revision=revision+1 where org_id=$1 and id=$2",
        [ctx.orgId, sessionId],
      );
      return {
        ref: { id },
        data: publicTurn(
          (await tx.query("select * from app.test_turn where id=$1", [id]))
            .rows[0],
        ),
      };
    },
    async () => {
      await loadSession(tx, ctx, sessionId);
      const row = (
        await tx.query(
          "select * from app.test_turn where org_id=$1 and session_id=$2 and id=$3",
          [ctx.orgId, sessionId, id],
        )
      ).rows[0];
      if (!row) throw new AppError("NOT_FOUND", 404);
      return publicTurn(row);
    },
  );
}
