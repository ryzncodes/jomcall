import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import {
  slotsInput,
  instant,
  type Slot,
  type Resource,
} from "../../../contracts/src/booking.ts";
import type { Schedule } from "../../../contracts/src/core.ts";
import { loadResource } from "./resources.ts";
export const KL = "Asia/Kuala_Lumpur";
export const klDay = (value: number | string | Date) =>
  new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function withinHours(
  start: string,
  end: string,
  schedule: Pick<Schedule, "timezone" | "weekdays" | "closures">,
) {
  if (schedule.timezone !== KL)
    throw new AppError("BOOKING_TIMEZONE_UNSUPPORTED", 422);
  const date = klDay(start);
  if (schedule.closures.some((c) => c.date === date)) return false;
  const midnight = Date.parse(date + "T00:00:00+08:00");
  const weekday = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  // Adjacent intervals are one continuous open interval.
  const merged: { start: number; end: number }[] = [];
  const minutes = (v: string) =>
    Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  for (const r of schedule.weekdays[weekday]) {
    const s = minutes(r.start),
      e = minutes(r.end);
    const last = merged.at(-1);
    if (last && last.end === s) last.end = e;
    else merged.push({ start: s, end: e });
  }
  return merged.some(
    (r) =>
      Date.parse(start) >= midnight + r.start * 60000 &&
      Date.parse(end) <= midnight + r.end * 60000,
  );
}
export async function getAvailability(
  tx: PoolClient,
  ctx: TenantContext,
  input: unknown,
) {
  const v = slotsInput.parse(input);
  const resource = await loadResource(tx, ctx, v.resourceId);
  const schedule = (
    await tx.query(
      "select s.* from app.location_schedule s join app.location l on(l.org_id=s.org_id and l.id=s.location_id) where s.org_id=$1 and s.location_id=$2 and l.archived_at is null",
      [ctx.orgId, resource.location_id],
    )
  ).rows[0] as Schedule | undefined;
  const begin = Date.parse(v.fromDate + "T00:00:00+08:00");
  const occupied = (
    await tx.query(
      "select start_at,end_at from app.booking where org_id=$1 and resource_id=$2 and status='confirmed' and start_at<$4::timestamptz and end_at>$3::timestamptz",
      [
        ctx.orgId,
        resource.id,
        new Date(begin).toISOString(),
        new Date(begin + v.days * 86400000).toISOString(),
      ],
    )
  ).rows;
  return calculateAvailability(ctx.orgId, resource, schedule, occupied, v);
}
export function calculateAvailability(
  orgId: string,
  resource: Resource,
  schedule: Schedule | undefined | null,
  occupied: { start_at: string; end_at: string }[],
  input: unknown,
) {
  const v = slotsInput.parse(input);
  const scope = JSON.stringify([orgId, v.resourceId, v.fromDate, v.days]);
  let after = "";
  if (v.cursor) {
    try {
      const c = z
        .object({ scope: z.string(), at: instant })
        .strict()
        .parse(JSON.parse(Buffer.from(v.cursor, "base64url").toString()));
      if (c.scope !== scope) throw Error();
      after = c.at;
    } catch {
      throw new AppError("INVALID_CURSOR", 422);
    }
  }
  if (!schedule || !resource.active) return { items: [], nextCursor: null };
  if (schedule.timezone !== KL)
    throw new AppError("BOOKING_TIMEZONE_UNSUPPORTED", 422);
  const now = Date.now(),
    begin = Date.parse(v.fromDate + "T00:00:00+08:00");
  const items: Slot[] = [];
  for (let at = begin; at < begin + v.days * 86400000; at += 15 * 60000) {
    if (at < now + 15 * 60000 || at > now + 90 * 86400000) continue;
    const startAt = new Date(at).toISOString(),
      endAt = new Date(at + resource.duration_minutes * 60000).toISOString();
    if (startAt <= after || !withinHours(startAt, endAt, schedule)) continue;
    if (
      occupied.some(
        (b) =>
          new Date(b.start_at).getTime() < Date.parse(endAt) &&
          new Date(b.end_at).getTime() > at,
      )
    )
      continue;
    items.push({
      resourceId: resource.id,
      startAt,
      endAt,
      resourceRevision: resource.revision,
      scheduleRevision: schedule.revision,
    });
    if (items.length === 51) break;
  }
  const more = items.length > 50;
  const page = items.slice(0, 50);
  return {
    items: page,
    nextCursor: more
      ? Buffer.from(
          JSON.stringify({ scope, at: page.at(-1)!.startAt }),
        ).toString("base64url")
      : null,
  };
}
