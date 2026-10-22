import type { PoolClient } from "pg";
import { z } from "zod";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../contracts/src/index.ts";
import { command, audit } from "../../db/src/receipts.ts";
import { manager, namespace } from "./authorization.ts";
export async function privacyRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
) {
  const create = path.match(/^\/contacts\/([^/]+)\/(export|deletion)$/),
    job = path.match(/^\/jobs\/([^/]+)(?:\/(download|retry))?$/);
  if (!create && !job && path !== "/jobs") return;
  manager(ctx);
  const load = async (id: string) => {
    const row = (
      await tx.query(
        "select * from app.privacy_job where org_id=$1 and id=$2",
        [ctx.orgId, id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return row;
  };
  if (path === "/jobs" && method === "GET")
    return (
      await tx.query(
        "select * from app.privacy_job where org_id=$1 order by created_at desc,id desc limit 100",
        [ctx.orgId],
      )
    ).rows;
  if (create && method === "POST") {
    const id = uuid.parse(create[1]),
      v = z
        .object({ expectedRevision: z.number().int().positive() })
        .strict()
        .parse(body);
    return command(
      tx,
      ctx,
      key,
      "privacy." + create[2],
      { id, ...v },
      async () => {
        const data = (
          await tx.query(
            "select app_private.request_privacy($1,$2,$3,$4,$5) as result",
            [ctx.orgId, id, v.expectedRevision, create[2], namespace()],
          )
        ).rows[0].result;
        await audit(tx, ctx, "privacy.requested", "privacy_job", data.id, {
          kind: create[2],
        });
        return { ref: { id: data.id }, data };
      },
      (ref) => load(String(ref.id)),
    );
  }
  if (!job) return;
  const id = uuid.parse(job[1]);
  if (job[2] === "retry" && method === "POST") {
    z.object({}).strict().parse(body);
    return command(
      tx,
      ctx,
      key,
      "privacy.retry",
      { id },
      async () => {
        const data = (
          await tx.query(
            "select app_private.retry_privacy($1,$2,$3) as result",
            [ctx.orgId, id, namespace()],
          )
        ).rows[0].result;
        await audit(tx, ctx, "privacy.retried", "privacy_job", id);
        return { ref: { id }, data };
      },
      () => load(id),
    );
  }
  if (method !== "GET") return;
  const j = await load(id);
  if (!job[2]) return j;
  if (job[2] !== "download") return;
  if (!j.contact_id) throw new AppError("NOT_FOUND", 404);
  if (j.kind !== "export" || j.state === "pending" || j.state === "failed")
    throw new AppError("NOT_READY", 409);
  if (j.state === "expired" || new Date(j.expires_at).getTime() <= Date.now())
    throw new AppError("EXPORT_EXPIRED", 410);
  // Lock target across all reads so concurrent edits/deletion cannot produce a mixed export.
  const c = (
    await tx.query(
      "select * from app.contact where org_id=$1 and id=$2 for share",
      [ctx.orgId, j.contact_id],
    )
  ).rows[0];
  if (!c || c.deletion_pending) throw new AppError("NOT_FOUND", 404);
  const notes = (
      await tx.query(
        "select * from app.contact_note where org_id=$1 and contact_id=$2 order by created_at,id",
        [ctx.orgId, c.id],
      )
    ).rows,
    consents = (
      await tx.query(
        "select * from app.consent_record where org_id=$1 and contact_id=$2 order by created_at,id",
        [ctx.orgId, c.id],
      )
    ).rows;
  await audit(tx, ctx, "privacy.downloaded", "privacy_job", id);
  return Response.json(
    {
      manifestVersion: j.manifest_version,
      preparedAt: j.completed_at,
      generatedAt: new Date().toISOString(),
      contact: c,
      notes,
      consents,
      agentTests: (
        await tx.query(
          "select s.*,coalesce((select jsonb_agg(t) from app.test_turn t where t.org_id=s.org_id and t.session_id=s.id),'[]')as turns,coalesce((select jsonb_agg(p) from app.test_proposal p where p.org_id=s.org_id and p.session_id=s.id),'[]')as proposals from app.test_session s where s.org_id=$1 and s.contact_id=$2",
          [ctx.orgId, c.id],
        )
      ).rows.map(({ auth_session_id, ...row }) => row),
      bookings: (
        await tx.query(
          "select * from app.booking where org_id=$1 and contact_id=$2 order by start_at,id",
          [ctx.orgId, c.id],
        )
      ).rows,
    },
    {
      headers: {
        "content-disposition": `attachment; filename="contact-${c.id}.json"`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
