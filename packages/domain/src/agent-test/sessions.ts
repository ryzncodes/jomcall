import type { PoolClient } from "pg";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import {
  testStart,
  revisionInput,
  type TestSession,
} from "../../../contracts/src/agent-test.ts";
import { namespace, manager } from "../authorization.ts";
import { command, audit } from "../../../db/src/receipts.ts";
import {
  snapshotHash,
  buildKnowledgeIndex,
  type Snapshot,
} from "./knowledge.ts";
import { lockBookingContact } from "../booking/commands.ts";
export type StoredSession = TestSession & {
  snapshot: Snapshot;
  creator_id: string;
  auth_session_id: string;
  location_id: string;
};
export function publicSession(row: StoredSession) {
  const { snapshot, auth_session_id, creator_id, ...safe } = row;
  return safe;
}
export async function loadSession(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
  lock = false,
  allowExpired = false,
): Promise<StoredSession> {
  manager(ctx);
  const row = (
    await tx.query(
      `select * from app.test_session where org_id=$1 and id=$2${lock ? " for update" : ""}`,
      [ctx.orgId, id],
    )
  ).rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404);
  if (!allowExpired && new Date(row.expires_at).getTime() <= Date.now())
    throw new AppError("TEST_EXPIRED", 410);
  if (row.contact_id) {
    const c = (
      await tx.query(
        "select deletion_pending from app.contact where org_id=$1 and id=$2",
        [ctx.orgId, row.contact_id],
      )
    ).rows[0];
    if (!c || c.deletion_pending)
      throw new AppError("CONTACT_DELETION_PENDING", 409);
  }
  return row;
}
export async function startSession(
  tx: PoolClient,
  ctx: TenantContext,
  body: unknown,
  key: string,
) {
  manager(ctx);
  const v = testStart.parse(body);
  return command(
    tx,
    ctx,
    key,
    "startAgentTest",
    v,
    async () => {
      if (v.contactId) await lockBookingContact(tx, ctx, v.contactId);
      await tx.query("select id from app.organization where id=$1 for update", [
        ctx.orgId,
      ]);
      if (
        Number(
          (
            await tx.query(
              "select count(*) from app.test_session where org_id=$1 and expires_at>now()",
              [ctx.orgId],
            )
          ).rows[0].count,
        ) >= 20
      )
        throw new AppError("TEST_SESSION_LIMIT", 429);
      const agent = (
        await tx.query(
          "select * from app.agent where org_id=$1 and id=$2 and location_id=$3 for update",
          [ctx.orgId, v.agentId, v.locationId],
        )
      ).rows[0];
      if (!agent) throw new AppError("NOT_FOUND", 404);
      let snapshot: Snapshot;
      if (v.source.kind === "draft") {
        if (v.source.expectedRevision !== agent.revision)
          throw new AppError("CONFLICT", 409);
        snapshot = {
          settings: agent.draft,
          knowledge: (
            await tx.query(
              "select kind,name,content from app.knowledge_item where org_id=$1 and agent_id=$2 order by created_at,id",
              [ctx.orgId, agent.id],
            )
          ).rows,
        };
      } else {
        const version = (
          await tx.query(
            "select snapshot from app.agent_version where org_id=$1 and agent_id=$2 and id=$3",
            [ctx.orgId, agent.id, v.source.versionId],
          )
        ).rows[0];
        if (!version) throw new AppError("NOT_FOUND", 404);
        snapshot = version.snapshot;
      }
      const row = (
        await tx.query(
          "insert into app.test_session(org_id,agent_id,location_id,contact_id,creator_id,auth_session_id,snapshot,snapshot_hash,source,agent_version_id,namespace)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)returning *",
          [
            ctx.orgId,
            agent.id,
            v.locationId,
            v.contactId ?? null,
            ctx.identity.userId,
            ctx.identity.sessionId,
            JSON.stringify(snapshot),
            snapshotHash(snapshot),
            v.source.kind,
            v.source.kind === "published" ? v.source.versionId : null,
            namespace(),
          ],
        )
      ).rows[0];
      await audit(tx, ctx, "agent_test.started", "test_session", row.id);
      return { ref: { id: row.id }, data: publicSession(row) };
    },
    async (ref) => publicSession(await loadSession(tx, ctx, String(ref.id))),
  );
}
export async function deleteSession(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
  body: unknown,
  key: string,
) {
  const v = revisionInput.parse(body);
  manager(ctx);
  return command(
    tx,
    ctx,
    key,
    "deleteAgentTest",
    { id, ...v },
    async () => {
      const row = await loadSession(tx, ctx, id, true, true);
      if (row.revision !== v.expectedRevision)
        throw new AppError("CONFLICT", 409);
      await tx.query("delete from app.test_session where org_id=$1 and id=$2", [
        ctx.orgId,
        id,
      ]);
      await audit(tx, ctx, "agent_test.deleted", "test_session", id);
      return { ref: { id }, data: { id } };
    },
    async () => ({ id }),
  );
}
export async function sessionDetail(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
) {
  const row = await loadSession(tx, ctx, id);
  const turns = (
    await tx.query(
      "select id,session_id,revision,attempt,state,input,answer,citations,error_code,created_at from app.test_turn where org_id=$1 and session_id=$2 order by created_at,id limit 20",
      [ctx.orgId, id],
    )
  ).rows;
  const cited = new Set<string>(turns.flatMap((t) => t.citations));
  return {
    ...publicSession(row),
    turns,
    sources: buildKnowledgeIndex(row.snapshot).filter((h) =>
      cited.has(h.sourceId),
    ),
    proposals: (
      await tx.query(
        "select * from app.test_proposal where org_id=$1 and session_id=$2 order by turn_id,step",
        [ctx.orgId, id],
      )
    ).rows,
    steps: (
      await tx.query(
        "select id,turn_id,attempt,step,tool,result from app.test_tool_step where org_id=$1 and session_id=$2 order by turn_id,step",
        [ctx.orgId, id],
      )
    ).rows,
  };
}
