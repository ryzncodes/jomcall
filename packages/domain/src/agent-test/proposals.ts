import type { PoolClient } from "pg";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import {
  proposalApply,
  bookingArgs,
} from "../../../contracts/src/agent-test.ts";
import { manager } from "../authorization.ts";
import { command, audit } from "../../../db/src/receipts.ts";
import {
  lockBookingContact,
  loadBooking,
  requestBookingInTransaction,
} from "../booking/commands.ts";
import { loadSession } from "./sessions.ts";
export async function applyBookingProposal(
  tx: PoolClient,
  ctx: TenantContext,
  sessionId: string,
  id: string,
  body: unknown,
  key: string,
) {
  manager(ctx);
  const v = proposalApply.parse(body);
  return command(
    tx,
    ctx,
    key,
    "applyBookingProposal",
    { sessionId, id, ...v },
    async () => {
      await lockBookingContact(tx, ctx, v.contactId);
      const s = await loadSession(tx, ctx, sessionId, true);
      if (s.contact_id && s.contact_id !== v.contactId)
        throw new AppError("CONTACT_MISMATCH", 409);
      const p = (
        await tx.query(
          "select * from app.test_proposal where org_id=$1 and session_id=$2 and id=$3 for update",
          [ctx.orgId, sessionId, id],
        )
      ).rows[0];
      if (!p) throw new AppError("NOT_FOUND", 404);
      if (p.applied_booking_id) {
        const b = await loadBooking(tx, ctx, p.applied_booking_id);
        return { ref: { id: b.id }, data: b };
      }
      const t = (
        await tx.query(
          "select * from app.test_turn where org_id=$1 and id=$2 for update",
          [ctx.orgId, p.turn_id],
        )
      ).rows[0];
      if (
        p.kind !== "booking" ||
        p.revision !== v.expectedProposalRevision ||
        t.state !== "completed" ||
        t.attempt !== p.attempt
      )
        throw new AppError("PROPOSAL_NOT_READY", 409);
      const details = bookingArgs.parse(p.details);
      const resource = (
        await tx.query(
          "select location_id from app.booking_resource where org_id=$1 and id=$2",
          [ctx.orgId, details.resourceId],
        )
      ).rows[0];
      if (!resource || resource.location_id !== s.location_id)
        throw new AppError("NOT_FOUND", 404);
      const b = await requestBookingInTransaction(
        tx,
        ctx,
        { ...details, contactId: v.contactId },
        "reviewed_test",
      );
      await tx.query(
        "update app.test_session set contact_id=$3,revision=revision+1 where org_id=$1 and id=$2",
        [ctx.orgId, sessionId, v.contactId],
      );
      await tx.query(
        "update app.test_proposal set applied_booking_id=$3,revision=revision+1 where org_id=$1 and id=$2",
        [ctx.orgId, id, b.id],
      );
      await audit(tx, ctx, "agent_test.proposal_applied", "test_proposal", id, {
        bookingId: b.id,
      });
      return { ref: { id: b.id }, data: b };
    },
    (ref) => loadBooking(tx, ctx, String(ref.id)),
  );
}
