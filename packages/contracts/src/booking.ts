import { z } from "zod";
import { uuid } from "./index.ts";
export const dateOnly = z.iso.date();
export const instant = z.iso.datetime({ offset: true });
export const resourceFields = {
  name: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().min(15).max(240).multipleOf(15),
};
export const resourceCreate = z
  .object({ locationId: uuid, ...resourceFields })
  .strict();
export const resourceUpdate = z
  .object({
    ...resourceFields,
    active: z.boolean(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const slotsInput = z
  .object({
    resourceId: uuid,
    fromDate: dateOnly,
    days: z.coerce.number().int().min(1).max(7),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
export type Resource = {
  id: string;
  org_id: string;
  location_id: string;
  name: string;
  duration_minutes: number;
  active: boolean;
  revision: number;
};
export type Slot = {
  resourceId: string;
  startAt: string;
  endAt: string;
  resourceRevision: number;
  scheduleRevision: number;
};
export type SlotsInput = z.input<typeof slotsInput>;
export const bookingInput = z
  .object({
    contactId: uuid,
    resourceId: uuid,
    title: z.string().trim().min(1).max(120),
    startAt: instant,
  })
  .strict();
export const bookingRevision = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const bookingReschedule = bookingRevision.extend({ startAt: instant });
export const bookingList = z
  .object({
    from: instant,
    to: instant,
    locationId: uuid.optional(),
    resourceId: uuid.optional(),
    contactId: uuid.optional(),
    status: z.enum(["requested", "confirmed", "cancelled"]).optional(),
    cursor: z.string().max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
  );
export type Booking = {
  id: string;
  org_id: string;
  contact_id: string;
  resource_id: string;
  location_id: string;
  title: string;
  start_at: string;
  end_at: string;
  timezone: "Asia/Kuala_Lumpur";
  status: "requested" | "confirmed" | "cancelled";
  source: "staff" | "reviewed_test";
  revision: number;
};
export type BookingInput = z.infer<typeof bookingInput>;
