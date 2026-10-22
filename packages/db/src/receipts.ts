import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { AppError, type TenantContext } from "../../contracts/src/index.ts";
export async function command<T>(
  tx: PoolClient,
  ctx: TenantContext,
  key: string,
  kind: string,
  input: unknown,
  execute: () => Promise<{ ref: Record<string, unknown>; data: T }>,
  load: (ref: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    ctx.orgId + ctx.identity.userId + kind + key,
  ]);
  const prior = (
    await tx.query(
      "select request_hash,result_ref from app.command_receipt where scope=$1 and actor_id=$2 and command=$3 and idempotency_key=$4",
      [ctx.orgId, ctx.identity.userId, kind, key],
    )
  ).rows[0];
  if (prior) {
    if (prior.request_hash !== hash) throw new AppError("CONFLICT", 409);
    return load(prior.result_ref);
  }
  const result = await execute();
  await tx.query(
    "insert into app.command_receipt(org_id,scope,actor_id,command,idempotency_key,request_hash,result_ref) values($1::uuid,$1::text,$2,$3,$4,$5,$6)",
    [ctx.orgId, ctx.identity.userId, kind, key, hash, result.ref],
  );
  return result.data;
}
export async function audit(
  tx: PoolClient,
  ctx: TenantContext,
  action: string,
  target: string,
  id: string,
  metadata: Record<string, unknown> = {},
) {
  await tx.query(
    "insert into app.audit_log(org_id,actor_id,action,target_type,target_id,metadata) values($1,$2,$3,$4,$5,$6)",
    [ctx.orgId, ctx.identity.userId, action, target, id, metadata],
  );
}
