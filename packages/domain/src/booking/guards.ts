import type { PoolClient } from "pg";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import type { Schedule } from "../../../contracts/src/core.ts";
import { withinHours, KL } from "./availability.ts";
export async function guardFutureBookings(
  tx: PoolClient,
  ctx: TenantContext,
  locationId: string,
  resourceId?: string,
  schedule?: Pick<Schedule, "timezone" | "weekdays" | "closures">,
) {
  const rows = (
    await tx.query(
      "select * from app.booking where org_id=$1 and location_id=$2 and ($3::uuid is null or resource_id=$3) and status<>'cancelled' and end_at>now()",
      [ctx.orgId, locationId, resourceId ?? null],
    )
  ).rows;
  const affected = rows.some(
    (b) =>
      !schedule ||
      schedule.timezone !== KL ||
      (b.status === "confirmed" &&
        !withinHours(
          new Date(b.start_at).toISOString(),
          new Date(b.end_at).toISOString(),
          schedule,
        )),
  );
  if (affected) throw new AppError("BOOKINGS_AFFECTED", 409);
}
