import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import {
  bookingInput,
  bookingRevision,
  bookingReschedule,
  bookingList,
  instant,
  type Booking,
  type BookingInput,
} from "../../../contracts/src/booking.ts";
import type { Schedule } from "../../../contracts/src/core.ts";
import { command, audit } from "../../../db/src/receipts.ts";
import { loadResource } from "./resources.ts";
import { withinHours, KL } from "./availability.ts";
export async function loadBooking(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
  lock = false,
): Promise<Booking> {
  const r = (
    await tx.query(
      `select * from app.booking where org_id=$1 and id=$2${lock ? " for update" : ""}`,
      [ctx.orgId, id],
    )
  ).rows[0];
  if (!r) throw new AppError("NOT_FOUND", 404);
  return r;
}
export async function lockBookingContact(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
) {
  const c = (
    await tx.query(
      "select * from app.contact where org_id=$1 and id=$2 for update",
      [ctx.orgId, id],
    )
  ).rows[0];
  if (!c) throw new AppError("NOT_FOUND", 404);
  if (c.deletion_pending) throw new AppError("CONTACT_DELETION_PENDING", 409);
}
async function lockResourceLocation(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
) {
  await tx.query("select app_private.lock_booking_resource($1,$2)", [
    ctx.orgId,
    id,
  ]);
  return loadResource(tx, ctx, id);
}
async function validTime(
  tx: PoolClient,
  ctx: TenantContext,
  resourceId: string,
  locationId: string,
  start: string,
  duration: number,
  active: boolean,
  confirmed: boolean,
  ignoreId?: string,
) {
  const ms = Date.parse(start);
  if (
    ms % 900000 !== 0 ||
    ms < Date.now() + 900000 ||
    ms > Date.now() + 90 * 86400000
  )
    throw new AppError("INVALID_BOOKING_TIME", 422);
  if (!active) throw new AppError("RESOURCE_INACTIVE", 409);
  const end = new Date(ms + duration * 60000).toISOString();
  const schedule = (
    await tx.query(
      "select * from app.location_schedule where org_id=$1 and location_id=$2",
      [ctx.orgId, locationId],
    )
  ).rows[0] as Schedule | undefined;
  if (!schedule || !withinHours(start, end, schedule))
    throw new AppError("OUTSIDE_OPEN_HOURS", 409);
  if (
    confirmed &&
    (
      await tx.query(
        "select id from app.booking where org_id=$1 and resource_id=$2 and status='confirmed' and ($5::uuid is null or id<>$5) and start_at<$4::timestamptz and end_at>$3::timestamptz limit 1",
        [ctx.orgId, resourceId, start, end, ignoreId ?? null],
      )
    ).rowCount
  )
    throw new AppError("SLOT_UNAVAILABLE", 409);
  return end;
}
export async function requestBookingInTransaction(
  tx: PoolClient,
  ctx: TenantContext,
  input: BookingInput,
  source: "staff" | "reviewed_test",
) {
  const v = bookingInput.parse(input);
  await lockBookingContact(tx, ctx, v.contactId);
  const r = await lockResourceLocation(tx, ctx, v.resourceId);
  const end = await validTime(
    tx,
    ctx,
    r.id,
    r.location_id,
    v.startAt,
    r.duration_minutes,
    r.active,
    false,
  );
  const b = (
    await tx.query(
      "insert into app.booking(org_id,contact_id,resource_id,location_id,title,start_at,end_at,timezone,source,creator_id)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)returning *",
      [
        ctx.orgId,
        v.contactId,
        r.id,
        r.location_id,
        v.title,
        v.startAt,
        end,
        KL,
        source,
        ctx.identity.userId,
      ],
    )
  ).rows[0] as Booking;
  await audit(tx, ctx, "booking.requested", "booking", b.id);
  return b;
}
export async function bookingCommand(
  tx: PoolClient,
  ctx: TenantContext,
  id: string | null,
  action: string,
  body: unknown,
  key: string,
) {
  const v = !id
    ? bookingInput.parse(body)
    : action === "reschedule"
      ? bookingReschedule.parse(body)
      : bookingRevision.parse(body);
  return command(
    tx,
    ctx,
    key,
    "booking." + action,
    { id, ...v },
    async () => {
      if (!id) {
        const b = await requestBookingInTransaction(
          tx,
          ctx,
          v as BookingInput,
          "staff",
        );
        return { ref: { id: b.id }, data: b };
      }
      const prior = await loadBooking(tx, ctx, id);
      await lockBookingContact(tx, ctx, prior.contact_id);
      const r = await lockResourceLocation(tx, ctx, prior.resource_id);
      const b = await loadBooking(tx, ctx, id, true);
      if (!("expectedRevision" in v) || b.revision !== v.expectedRevision)
        throw new AppError("CONFLICT", 409);
      if (b.status === "cancelled")
        throw new AppError("BOOKING_CANCELLED", 409);
      let start = new Date(b.start_at).toISOString(),
        end = new Date(b.end_at).toISOString();
      let status: Booking["status"] = b.status;
      if (action === "cancel") status = "cancelled";
      else {
        if (action === "confirm" && b.status !== "requested")
          throw new AppError("CONFLICT", 409);
        if (action === "reschedule" && "startAt" in v)
          start = instant.parse(v.startAt);
        if (action === "confirm") status = "confirmed";
        end = await validTime(
          tx,
          ctx,
          r.id,
          r.location_id,
          start,
          (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) /
            60000,
          r.active,
          status === "confirmed",
          id,
        );
      }
      const saved = (
        await tx.query(
          "update app.booking set start_at=$3,end_at=$4,status=$5,revision=revision+1 where org_id=$1 and id=$2 returning *",
          [ctx.orgId, id, start, end, status],
        )
      ).rows[0];
      await audit(tx, ctx, "booking." + action, "booking", id);
      return { ref: { id }, data: saved };
    },
    (ref) => loadBooking(tx, ctx, String(ref.id)),
  );
}
export async function listBookings(
  tx: PoolClient,
  ctx: TenantContext,
  input: unknown,
) {
  const v = bookingList.parse(input);
  const { cursor, limit, ...filters } = v;
  const scope = JSON.stringify([ctx.orgId, filters]);
  let after: { at: string; id: string } | undefined;
  if (cursor) {
    try {
      const parsed = z
        .object({ scope: z.string(), at: instant, id: z.uuid() })
        .strict()
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
      if (parsed.scope !== scope) throw Error();
      after = parsed;
    } catch {
      throw new AppError("INVALID_CURSOR", 422);
    }
  }
  const rows = (
    await tx.query(
      `select * from app.booking where org_id=$1 and start_at>=$2::timestamptz and start_at<$3::timestamptz and ($4::uuid is null or location_id=$4) and ($5::uuid is null or resource_id=$5) and ($6::uuid is null or contact_id=$6) and ($7::text is null or status=$7) and ($8::timestamptz is null or (start_at,id)>($8::timestamptz,$9::uuid)) order by start_at,id limit $10`,
      [
        ctx.orgId,
        v.from,
        v.to,
        v.locationId ?? null,
        v.resourceId ?? null,
        v.contactId ?? null,
        v.status ?? null,
        after?.at ?? null,
        after?.id ?? null,
        limit + 1,
      ],
    )
  ).rows;
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit
        ? Buffer.from(
            JSON.stringify({
              scope,
              at: new Date(last.start_at).toISOString(),
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}
