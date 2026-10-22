import { bookingCommand, loadBooking, listBookings } from "./commands.ts";
import type { PoolClient } from "pg";
import { z } from "zod";
import { uuid, type TenantContext } from "../../../contracts/src/index.ts";
import { saveResource } from "./resources.ts";
import { getAvailability } from "./availability.ts";
export async function bookingRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
) {
  const booking = path.match(
    /^\/bookings(?:\/([^/]+)(?:\/(confirm|reschedule|cancel))?)?$/,
  );
  if (booking) {
    const id = booking[1] ? uuid.parse(booking[1]) : null;
    const action = booking[2];
    if (method === "GET")
      return id
        ? loadBooking(tx, ctx, id)
        : listBookings(tx, ctx, Object.fromEntries(query));
    if (method === "POST")
      return bookingCommand(tx, ctx, id, action ?? "request", body, key);
  }
  if (path === "/booking-availability" && method === "GET")
    return getAvailability(tx, ctx, Object.fromEntries(query));
  const match = path.match(/^\/booking-resources(?:\/([^/]+))?$/);
  if (!match) return;
  const id = match[1] ? uuid.parse(match[1]) : null;
  if (method === "GET" && !id) {
    const v = z
      .object({ locationId: uuid.optional() })
      .strict()
      .parse(Object.fromEntries(query));
    return (
      await tx.query(
        "select * from app.booking_resource where org_id=$1 and ($2::uuid is null or location_id=$2)order by name,id limit 100",
        [ctx.orgId, v.locationId ?? null],
      )
    ).rows;
  }
  if ((method === "POST" && !id) || (method === "PATCH" && id))
    return saveResource(tx, ctx, id, body, key);
}
