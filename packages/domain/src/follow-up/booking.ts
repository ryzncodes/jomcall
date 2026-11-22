// Booking follow-ups and JomCall's own calendar (design D5). Confirm turns
// the agent's booking request into a confirmed booking for the item's
// contact; reopening the item cancels that booking again. Both run inside
// the caller's transaction, so a refusal anywhere rolls everything back.
import type { PoolClient } from "pg";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import type { FollowUp } from "../../../contracts/src/follow-up.ts";
import type { Booking } from "../../../contracts/src/booking.ts";
import { audit } from "../../../db/src/receipts.ts";
import {
  confirmBookingInTransaction,
  requestBookingInTransaction,
} from "../booking/commands.ts";

// Request then confirm the booking the item describes, with the booking
// code's own checks (time, opening hours, clash with confirmed bookings);
// its errors pass through unchanged. The caller closes the item as done
// with the returned booking id. The web role cannot lock app.follow_up, so
// follow_up_close checks the revision again under its row lock.
export async function confirmFollowUpBooking(
  tx: PoolClient,
  ctx: TenantContext,
  item: FollowUp,
  expectedRevision: number,
): Promise<Booking> {
  if (item.revision !== expectedRevision || item.state !== "open")
    throw new AppError("CONFLICT", 409);
  if (item.kind !== "booking") throw new AppError("INVALID_STATE", 422);
  if (!item.contact) throw new AppError("CONTACT_REQUIRED", 409);
  const d = item.details as {
    resourceId?: unknown;
    startAt?: unknown;
    title?: unknown;
  };
  const requested = await requestBookingInTransaction(
    tx,
    ctx,
    {
      contactId: item.contact.id,
      resourceId: d.resourceId as string,
      title: d.title as string,
      startAt: d.startAt as string,
    },
    "staff",
  );
  return confirmBookingInTransaction(
    tx,
    ctx,
    requested.id,
    requested.revision,
  );
}

// Cancel the booking a reopened item had confirmed, but only while it is
// still confirmed and belongs to the item's own contact: a booking linked by
// any other path is left as it is.
export async function cancelFollowUpBooking(
  tx: PoolClient,
  ctx: TenantContext,
  bookingId: string,
  contactId: string,
): Promise<void> {
  const r = await tx.query(
    "update app.booking set status='cancelled',revision=revision+1 where org_id=$1 and id=$2 and status='confirmed' and contact_id=$3",
    [ctx.orgId, bookingId, contactId],
  );
  if (r.rowCount === 1)
    await audit(tx, ctx, "booking.cancel", "booking", bookingId);
}
