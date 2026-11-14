import type { PoolClient } from "pg";
import { AppError, uuid, type TenantContext } from "../../../contracts/src/index.ts";
import {
  phoneNumberCreate,
  phoneNumberUpdate,
  callList,
  type PhoneNumber,
} from "../../../contracts/src/phone.ts";
import { manager } from "../authorization.ts";
import { command, audit } from "../../../db/src/receipts.ts";
import { telephonyReadiness } from "./telephony.ts";

const SUMMARY =
  "id,caller_e164,dialled_e164,state,refusal,outcome,language,after_hours,do_not_contact,transfer_result,started_at,duration_seconds";

// A dialled number may be active in one organization only. Other
// organizations' rows are invisible here, so the unique index decides.
async function guarded<T>(tx: PoolClient, run: () => Promise<T>): Promise<T> {
  await tx.query("savepoint phone_number");
  try {
    const out = await run();
    await tx.query("release savepoint phone_number");
    return out;
  } catch (error: any) {
    await tx.query("rollback to savepoint phone_number");
    if (error?.code === "23505") throw new AppError("NUMBER_IN_USE", 409);
    if (error?.code === "23503") throw new AppError("NOT_FOUND", 404);
    throw error;
  }
}

async function checkTargets(tx: PoolClient, ctx: TenantContext, locationId: string, agentId: string) {
  const ok = (
    await tx.query(
      "select 1 from app.location l join app.agent a on a.org_id=l.org_id where l.org_id=$1 and l.id=$2 and l.archived_at is null and a.id=$3",
      [ctx.orgId, locationId, agentId],
    )
  ).rowCount;
  if (!ok) throw new AppError("NOT_FOUND", 404);
}

async function loadNumber(tx: PoolClient, ctx: TenantContext, id: string): Promise<PhoneNumber> {
  const row = (
    await tx.query("select * from app.phone_number where org_id=$1 and id=$2", [ctx.orgId, id])
  ).rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404);
  return row;
}

function cursorOf(row: { started_at: Date | string; id: string }) {
  return Buffer.from(new Date(row.started_at).toISOString() + "|" + row.id).toString("base64url");
}
function parseCursor(raw: string | undefined) {
  if (!raw) return null;
  const [at, id] = Buffer.from(raw, "base64url").toString().split("|");
  if (!at || Number.isNaN(Date.parse(at)) || !uuid.safeParse(id).success)
    throw new AppError("VALIDATION_FAILED", 422);
  return { at, id };
}

export async function phoneRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
) {
  const numbers = path.match(/^\/phone-numbers(?:\/([^/]+))?$/);
  if (numbers) {
    const id = numbers[1] ? uuid.parse(numbers[1]) : null;
    if (method === "GET" && !id)
      return {
        items: (
          await tx.query(
            "select * from app.phone_number where org_id=$1 order by active desc,created_at,id limit 100",
            [ctx.orgId],
          )
        ).rows,
        provider: telephonyReadiness(),
      };
    if (method === "POST" && !id) {
      manager(ctx);
      const v = phoneNumberCreate.parse(body);
      return command(
        tx, ctx, key, "createPhoneNumber", v,
        async () => {
          await checkTargets(tx, ctx, v.locationId, v.agentId);
          const row = await guarded(tx, async () =>
            (
              await tx.query(
                "insert into app.phone_number(org_id,e164,label,location_id,agent_id,transfer_e164)values($1,$2,$3,$4,$5,$6)returning *",
                [ctx.orgId, v.e164, v.label, v.locationId, v.agentId, v.transferE164],
              )
            ).rows[0],
          );
          await audit(tx, ctx, "phone_number.created", "phone_number", row.id);
          return { ref: { id: row.id }, data: row };
        },
        (ref) => loadNumber(tx, ctx, ref.id as string),
      );
    }
    if (method === "PATCH" && id) {
      manager(ctx);
      const v = phoneNumberUpdate.parse(body);
      return command(
        tx, ctx, key, "updatePhoneNumber", { id, ...v },
        async () => {
          await checkTargets(tx, ctx, v.locationId, v.agentId);
          const row = await guarded(tx, async () =>
            (
              await tx.query(
                "update app.phone_number set label=$3,location_id=$4,agent_id=$5,transfer_e164=$6,active=$7,revision=revision+1,updated_at=now() where org_id=$1 and id=$2 and revision=$8 returning *",
                [ctx.orgId, id, v.label, v.locationId, v.agentId, v.transferE164, v.active, v.expectedRevision],
              )
            ).rows[0],
          );
          if (!row) {
            await loadNumber(tx, ctx, id);
            throw new AppError("CONFLICT", 409);
          }
          await audit(tx, ctx, "phone_number.updated", "phone_number", id);
          return { ref: { id }, data: row };
        },
        (ref) => loadNumber(tx, ctx, ref.id as string),
      );
    }
    return;
  }
  if (path === "/calls" && method === "GET") {
    const v = callList.parse(Object.fromEntries(query));
    const limit = v.limit ?? 30;
    const after = parseCursor(v.cursor);
    const rows = (
      await tx.query(
        `select ${SUMMARY} from app.call where org_id=$1 and ($2::timestamptz is null or (started_at,id)<($2,$3::uuid)) order by started_at desc,id desc limit $4`,
        [ctx.orgId, after?.at ?? null, after?.id ?? null, limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? cursorOf(rows[limit - 1]) : null,
    };
  }
  const one = path.match(/^\/calls\/([^/]+)$/);
  if (one && method === "GET") {
    const id = uuid.parse(one[1]);
    const row = (
      await tx.query(
        `select ${SUMMARY},disclosure_played_at,recording_enabled from app.call where org_id=$1 and id=$2`,
        [ctx.orgId, id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    // Words are for managers; RLS enforces the same, this keeps the shape clear.
    const words = ctx.role !== "staff";
    return {
      ...row,
      turns: words
        ? (
            await tx.query(
              "select id,input,answer,state,created_at from app.call_turn where org_id=$1 and call_id=$2 order by created_at,id limit 200",
              [ctx.orgId, id],
            )
          ).rows
        : null,
      proposals: words
        ? (
            await tx.query(
              "select id,kind,state,details from app.call_proposal where org_id=$1 and call_id=$2 order by created_at,id limit 50",
              [ctx.orgId, id],
            )
          ).rows
        : null,
    };
  }
}
