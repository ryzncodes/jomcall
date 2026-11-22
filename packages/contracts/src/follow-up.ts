import { z } from "zod";
import { uuid } from "./index.ts";
import { instant } from "./booking.ts";

export const followUpView = z.enum(["open", "mine", "done"]);
export const followUpList = z
  .object({
    view: followUpView.default("open"),
    cursor: z.string().max(200).optional(),
  })
  .strict();
const revision = z.number().int().positive();
export const followUpClose = z
  .object({
    id: uuid,
    expectedRevision: revision,
    state: z.enum(["done", "dismissed"]),
  })
  .strict();
export const followUpReopen = z
  .object({ id: uuid, expectedRevision: revision })
  .strict();
// Confirm a booking item into JomCall's calendar and close it as done.
export const followUpConfirmBooking = z
  .object({ id: uuid, expectedRevision: revision })
  .strict();
export const followUpAssign = z
  .object({
    id: uuid,
    expectedRevision: revision,
    assigneeUserId: uuid.nullable(),
    dueAt: instant.nullable(),
  })
  .strict();

export type FollowUp = {
  id: string;
  kind: "booking" | "message" | "handoff";
  source: "call" | "whatsapp";
  details: Record<string, unknown>;
  state: "open" | "done" | "dismissed";
  revision: number;
  created_at: string;
  due_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  assignee: { userId: string; name: string } | null;
  booking_id: string | null;
  contact: { id: string; name: string; phone: string | null } | null;
  call_id: string | null;
  conversation_id: string | null;
};
export type FollowUpPage = { items: FollowUp[]; next: string | null };
export type FollowUpCount = { open: number; mine: number };
