import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../contracts/src/index.ts";
import { command, audit } from "../../db/src/receipts.ts";
import { manager, namespace } from "./authorization.ts";
import { encryptInvitationToken, tokenHash } from "./invitation-crypto.ts";
const safeColumns =
  "id,org_id,email,role,state,expires_at,delivery_state,revision,created_at";
export async function membersRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
): Promise<unknown | undefined> {
  if (path === "/members" && method === "GET")
    return (
      await tx.query("select * from app_private.workspace_members($1)", [
        ctx.orgId,
      ])
    ).rows;
  const change = path.match(/^\/members\/([^/]+)(\/revoke)?$/);
  if (
    change &&
    ((method === "PATCH" && !change[2]) || (method === "POST" && change[2]))
  ) {
    manager(ctx);
    const id = uuid.parse(change[1]);
    const value = (
      change[2]
        ? z.object({ expectedRevision: z.number().int().positive() }).strict()
        : z
            .object({
              expectedRevision: z.number().int().positive(),
              role: z.enum(["staff", "admin"]),
            })
            .strict()
    ).parse(body);
    return command(
      tx,
      ctx,
      key,
      "changeMember",
      { id, ...value, revoke: !!change[2] },
      async () => {
        const result = (
          await tx.query(
            "select app_private.change_member($1,$2,$3,$4,$5) as result",
            [
              ctx.orgId,
              id,
              value.expectedRevision,
              "role" in value ? value.role : null,
              !change[2],
            ],
          )
        ).rows[0].result;
        await audit(tx, ctx, "member.changed", "member", id, {
          active: result.active,
          role: result.role,
        });
        return { ref: { id }, data: result };
      },
      async () => {
        const r = (
          await tx.query(
            "select id,org_id,user_id,role,active,revision from app.member where org_id=$1 and id=$2",
            [ctx.orgId, id],
          )
        ).rows[0];
        if (!r) throw new AppError("NOT_FOUND", 404);
        return r;
      },
    );
  }
  if (path === "/invitations" && method === "GET") {
    manager(ctx);
    return (
      await tx.query(
        `select ${safeColumns} from app.invitation where org_id=$1 order by created_at desc`,
        [ctx.orgId],
      )
    ).rows;
  }
  if (path === "/invitations" && method === "POST") {
    manager(ctx);
    const value = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((x) => x.toLowerCase()),
        role: z.enum(["staff", "admin"]),
      })
      .strict()
      .parse(body);
    if (ctx.role === "admin" && value.role !== "staff")
      throw new AppError("FORBIDDEN", 403);
    return command(
      tx,
      ctx,
      key,
      "inviteMember",
      value,
      async () => {
        const id = randomUUID(),
          token = randomBytes(32).toString("hex");
        const result = (
          await tx.query(
            `insert into app.invitation(id,org_id,email,role,invited_by,token_hash,delivery_ciphertext) values($1,$2,$3,$4,$5,$6,$7) returning ${safeColumns}`,
            [
              id,
              ctx.orgId,
              value.email,
              value.role,
              ctx.identity.userId,
              tokenHash(token),
              encryptInvitationToken(
                token,
                process.env.INVITATION_KEY!,
                ctx.orgId + id,
              ),
            ],
          )
        ).rows[0];
        await tx.query(
          "insert into app.outbox(org_id,namespace,kind,resource_id,operation_id) select $1,$2,'invitation.deliver',id,delivery_operation_id from app.invitation where id=$3",
          [ctx.orgId, namespace(), id],
        );
        await audit(tx, ctx, "invitation.created", "invitation", id, {
          role: value.role,
        });
        return { ref: { id }, data: result };
      },
      async (ref) =>
        (
          await tx.query(
            `select ${safeColumns} from app.invitation where org_id=$1 and id=$2`,
            [ctx.orgId, ref.id],
          )
        ).rows[0],
    );
  }
  const action = path.match(/^\/invitations\/([^/]+)\/(revoke|resend)$/);
  if (action && method === "POST") {
    manager(ctx);
    z.object({}).strict().parse(body);
    const id = uuid.parse(action[1]);
    return command(
      tx,
      ctx,
      key,
      "invitation." + action[2],
      { id },
      async () => {
        const current = (
          await tx.query(
            "select role,state from app.invitation where org_id=$1 and id=$2 for update",
            [ctx.orgId, id],
          )
        ).rows[0];
        if (!current) throw new AppError("NOT_FOUND", 404);
        if (ctx.role === "admin" && current.role !== "staff")
          throw new AppError("FORBIDDEN", 403);
        if (current.state !== "pending") throw new AppError("CONFLICT", 409);
        if (action[2] === "revoke")
          await tx.query(
            "update app.invitation set state='revoked',delivery_ciphertext=null,revision=revision+1 where id=$1",
            [id],
          );
        else {
          const token = randomBytes(32).toString("hex");
          await tx.query(
            "update app.invitation set token_hash=$1,delivery_ciphertext=$2,expires_at=now()+interval '7 days',delivery_state='pending',delivery_operation_id=gen_random_uuid(),revision=revision+1 where id=$3",
            [
              tokenHash(token),
              encryptInvitationToken(
                token,
                process.env.INVITATION_KEY!,
                ctx.orgId + id,
              ),
              id,
            ],
          );
          await tx.query(
            "insert into app.outbox(org_id,namespace,kind,resource_id,operation_id) select $1,$2,'invitation.deliver',id,delivery_operation_id from app.invitation where id=$3",
            [ctx.orgId, namespace(), id],
          );
        }
        await audit(tx, ctx, "invitation." + action[2], "invitation", id);
        return {
          ref: { id },
          data: (
            await tx.query(
              `select ${safeColumns} from app.invitation where id=$1`,
              [id],
            )
          ).rows[0],
        };
      },
      async () =>
        (
          await tx.query(
            `select ${safeColumns} from app.invitation where id=$1`,
            [id],
          )
        ).rows[0],
    );
  }
}
