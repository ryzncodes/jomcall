import { guardFutureBookings } from "./guards.ts";
import type { PoolClient } from "pg";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import {
  resourceCreate,
  resourceUpdate,
  type Resource,
} from "../../../contracts/src/booking.ts";
import { manager } from "../authorization.ts";
import { command, audit } from "../../../db/src/receipts.ts";
export async function loadResource(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
  lock = false,
): Promise<Resource> {
  const r = (
    await tx.query(
      `select * from app.booking_resource where org_id=$1 and id=$2${lock ? " for update" : ""}`,
      [ctx.orgId, id],
    )
  ).rows[0];
  if (!r) throw new AppError("NOT_FOUND", 404);
  return r;
}
export async function saveResource(
  tx: PoolClient,
  ctx: TenantContext,
  id: string | null,
  body: unknown,
  key: string,
) {
  manager(ctx);
  const v = id ? resourceUpdate.parse(body) : resourceCreate.parse(body);
  return command(
    tx,
    ctx,
    key,
    id ? "updateBookingResource" : "createBookingResource",
    { id, ...v },
    async () => {
      // Resource creation serializes the organization cap; updates use location before resource.
      if (!id)
        await tx.query(
          "select id from app.organization where id=$1 for update",
          [ctx.orgId],
        );
      const prior = id ? await loadResource(tx, ctx, id) : null;
      const locationId = "locationId" in v ? v.locationId : prior!.location_id;
      const location = (
        await tx.query(
          "select * from app.location where org_id=$1 and id=$2 and archived_at is null for update",
          [ctx.orgId, locationId],
        )
      ).rows[0];
      if (!location) throw new AppError("NOT_FOUND", 404);
      let row: Resource;
      if (id && "expectedRevision" in v) {
        const locked = await loadResource(tx, ctx, id, true);
        if (locked.revision !== v.expectedRevision)
          throw new AppError("CONFLICT", 409);
        if (!v.active) await guardFutureBookings(tx, ctx, locationId, id);
        row = (
          await tx.query(
            "update app.booking_resource set name=$3,duration_minutes=$4,active=$5,revision=revision+1 where org_id=$1 and id=$2 returning *",
            [ctx.orgId, id, v.name, v.durationMinutes, v.active],
          )
        ).rows[0];
      } else {
        if (
          Number(
            (
              await tx.query(
                "select count(*) from app.booking_resource where org_id=$1",
                [ctx.orgId],
              )
            ).rows[0].count,
          ) >= 100
        )
          throw new AppError("RESOURCE_LIMIT", 429);
        row = (
          await tx.query(
            "insert into app.booking_resource(org_id,location_id,name,duration_minutes)values($1,$2,$3,$4)returning *",
            [ctx.orgId, locationId, v.name, v.durationMinutes],
          )
        ).rows[0];
      }
      await audit(
        tx,
        ctx,
        id ? "booking_resource.updated" : "booking_resource.created",
        "booking_resource",
        row.id,
      );
      return { ref: { id: row.id }, data: row };
    },
    (ref) => loadResource(tx, ctx, String(ref.id)),
  );
}
