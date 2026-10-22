import { z } from "zod";
import { page } from "../../db/src/pagination.ts";
import type { PoolClient } from "pg";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../contracts/src/index.ts";
import { agentSettings, knowledgeInput } from "../../contracts/src/agent.ts";
import { command, audit } from "../../db/src/receipts.ts";
import { manager } from "./authorization.ts";
export async function agentsRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
) {
  const m = path.match(
    /^\/agents\/([^/]+)\/(draft|knowledge|publish|versions|restore)(?:\/([^/]+))?$/,
  );
  if (!m) return;
  const id = uuid.parse(m[1]),
    action = m[2],
    child = m[3] ? uuid.parse(m[3]) : null;
  if (action === "versions" && method === "GET" && child) {
    const v = (
      await tx.query(
        "select * from app.agent_version where org_id=$1 and agent_id=$2 and id=$3",
        [ctx.orgId, id, child],
      )
    ).rows[0];
    if (!v) throw new AppError("NOT_FOUND", 404);
    return v;
  }
  manager(ctx);
  const load = async () => {
    const row = (
      await tx.query("select * from app.agent where org_id=$1 and id=$2", [
        ctx.orgId,
        id,
      ])
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return row;
  };
  if (method === "GET") {
    await load();
    if (action === "draft") return load();
    if (action === "knowledge")
      return (
        await tx.query(
          "select * from app.knowledge_item where org_id=$1 and agent_id=$2 order by created_at,id",
          [ctx.orgId, id],
        )
      ).rows;
    if (action === "versions")
      return page(tx, ctx.orgId, "versions", query, id);
    return;
  }
  let value: {
    expectedRevision?: number;
    expectedAgentRevision?: number;
    [key: string]: unknown;
  };
  if (action === "draft" && method === "PUT")
    value = z
      .object({
        expectedRevision: z.number().int().positive(),
        settings: agentSettings,
      })
      .strict()
      .parse(body);
  else if (action === "knowledge" && method === "POST")
    value = knowledgeInput.parse(body);
  else if (action === "knowledge" && method === "DELETE" && child)
    value = z
      .object({ expectedAgentRevision: z.number().int().positive() })
      .strict()
      .parse(body);
  else if (action === "publish" && method === "POST")
    value = z
      .object({ expectedRevision: z.number().int().positive() })
      .strict()
      .parse(body);
  else if (action === "restore" && method === "POST")
    value = z
      .object({
        versionId: uuid,
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(body);
  else return;
  return command(
    tx,
    ctx,
    key,
    action + "." + method,
    { id, child, ...value },
    async () => {
      const current = (
        await tx.query(
          "select * from app.agent where org_id=$1 and id=$2 for update",
          [ctx.orgId, id],
        )
      ).rows[0];
      if (!current) throw new AppError("NOT_FOUND", 404);
      if (
        current.revision !==
        (value.expectedRevision ?? value.expectedAgentRevision)
      )
        throw new AppError("CONFLICT", 409);
      if (action === "draft")
        await tx.query("update app.agent set draft=$1 where id=$2", [
          value.settings,
          id,
        ]);
      if (action === "knowledge") {
        if (method === "DELETE") {
          const r = await tx.query(
            "delete from app.knowledge_item where org_id=$1 and agent_id=$2 and id=$3",
            [ctx.orgId, id, child],
          );
          if (!r.rowCount) throw new AppError("NOT_FOUND", 404);
        } else {
          const v = knowledgeInput.parse(value);
          if (v.id) {
            const r = await tx.query(
              "update app.knowledge_item set name=$1,content=$2,kind=$3,revision=revision+1 where org_id=$4 and agent_id=$5 and id=$6",
              [v.name, v.content, v.kind, ctx.orgId, id, v.id],
            );
            if (!r.rowCount) throw new AppError("NOT_FOUND", 404);
          } else
            await tx.query(
              "insert into app.knowledge_item(org_id,agent_id,kind,name,content)values($1,$2,$3,$4,$5)",
              [ctx.orgId, id, v.kind, v.name, v.content],
            );
        }
        const totals = (
          await tx.query(
            "select count(*)::int as count,coalesce(sum(octet_length(content)),0)::int as bytes from app.knowledge_item where org_id=$1 and agent_id=$2",
            [ctx.orgId, id],
          )
        ).rows[0];
        if (totals.count > 100 || totals.bytes > 1048576)
          throw new AppError("KNOWLEDGE_LIMIT", 422);
      }
      let version;
      if (action === "publish") {
        const settings = agentSettings.parse(current.draft);
        if (
          !settings.aiDisclosure.trim() ||
          !settings.greeting.trim() ||
          (settings.recordingEnabled && !settings.recordingDisclosure.trim())
        )
          throw new AppError("DISCLOSURE_REQUIRED", 422);
        const knowledge = (
          await tx.query(
            "select kind,name,content from app.knowledge_item where org_id=$1 and agent_id=$2 order by created_at,id",
            [ctx.orgId, id],
          )
        ).rows;
        version = (
          await tx.query(
            "insert into app.agent_version(org_id,agent_id,sequence,snapshot,actor_id)select $1,$2,coalesce(max(sequence),0)+1,$3,$4 from app.agent_version where org_id=$1 and agent_id=$2 returning *",
            [ctx.orgId, id, { settings, knowledge }, ctx.identity.userId],
          )
        ).rows[0];
        await tx.query(
          "update app.agent set published_version_id=$1 where id=$2",
          [version.id, id],
        );
      }
      if (action === "restore") {
        const v = (
          await tx.query(
            "select snapshot from app.agent_version where org_id=$1 and agent_id=$2 and id=$3",
            [ctx.orgId, id, value.versionId],
          )
        ).rows[0];
        if (!v) throw new AppError("NOT_FOUND", 404);
        await tx.query("update app.agent set draft=$1 where id=$2", [
          v.snapshot.settings,
          id,
        ]);
        await tx.query(
          "delete from app.knowledge_item where org_id=$1 and agent_id=$2",
          [ctx.orgId, id],
        );
        for (const item of v.snapshot.knowledge)
          await tx.query(
            "insert into app.knowledge_item(org_id,agent_id,kind,name,content)values($1,$2,$3,$4,$5)",
            [ctx.orgId, id, item.kind, item.name, item.content],
          );
      }
      await tx.query(
        "update app.agent set revision=revision+1,updated_at=now() where id=$1",
        [id],
      );
      await audit(tx, ctx, "agent." + action, "agent", id);
      return {
        ref: { id, versionId: version?.id },
        data: version ?? (await load()),
      };
    },
    async (ref) =>
      ref.versionId
        ? (
            await tx.query(
              "select * from app.agent_version where org_id=$1 and id=$2",
              [ctx.orgId, ref.versionId],
            )
          ).rows[0]
        : await load(),
  );
}
