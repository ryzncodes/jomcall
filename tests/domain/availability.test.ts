import test from "node:test";
import assert from "node:assert/strict";
import { createPhase2Harness } from "../helpers/phase2.ts";
test("availability uses KL schedule, bounded paging, closures and active resources without fabricated slots", async () => {
  const f = await createPhase2Harness();
  try {
    const resource = await f.req("POST", "/booking-resources", {
      locationId: f.h.orgA.locationId,
      name: "Room",
      durationMinutes: 30,
    });
    assert.equal(resource.status, 200);
    const r = resource.body.data;
    const path = `/booking-availability?resourceId=${r.id}&fromDate=${f.day}&days=2`;
    const first = await f.req("GET", path);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.items[0].startAt, f.slotStart);
    assert.equal(first.body.data.items.length, 50);
    assert.ok(first.body.data.nextCursor);
    const next = await f.req(
      "GET",
      path + "&cursor=" + encodeURIComponent(first.body.data.nextCursor),
    );
    assert.equal(next.status, 200);
    assert.ok(
      next.body.data.items.every(
        (x: { startAt: string }) =>
          x.startAt > first.body.data.items.at(-1).startAt,
      ),
    );
    assert.equal(
      (await f.req("GET", path.replace("days=2", "days=8"))).status,
      422,
    );
    assert.equal(
      (await f.req("GET", path.replace(f.day, "2026-02-30"))).status,
      422,
    );
    const staff = await f.api.request(
      f.h.staff,
      f.h.orgA.id,
      "GET",
      "/api/v1" + path,
    );
    assert.equal(staff.status, 200);
    await f.req("PUT", `/locations/${f.h.orgA.locationId}/schedule`, {
      ...f.schedule,
      expectedRevision: 1,
      closures: [{ date: f.day, reason: "Closed" }],
    });
    assert.equal(
      (await f.req("GET", path.replace("days=2", "days=1"))).body.data.items
        .length,
      0,
    );
    await f.req("PATCH", `/booking-resources/${r.id}`, {
      name: r.name,
      durationMinutes: 30,
      active: false,
      expectedRevision: 1,
    });
    assert.equal((await f.req("GET", path)).body.data.items.length, 0);
    await f.req("PATCH", `/booking-resources/${r.id}`, {
      name: r.name,
      durationMinutes: 30,
      active: true,
      expectedRevision: 2,
    });
    await f.req("PUT", `/locations/${f.h.orgA.locationId}/schedule`, {
      ...f.schedule,
      expectedRevision: 2,
      timezone: "Europe/London",
    });
    assert.equal(
      (await f.req("GET", path)).body.error.code,
      "BOOKING_TIMEZONE_UNSUPPORTED",
    );
    await f.h.cleanup.query(
      "delete from app.location_schedule where org_id=$1",
      [f.h.orgA.id],
    );
    assert.equal((await f.req("GET", path)).body.data.items.length, 0);
  } finally {
    await f.close();
  }
});
test("weekly slots use Monday-first indexing and join adjacent open intervals", async () => {
  const { withinHours } = await import(
    "../../packages/domain/src/booking/availability.ts"
  );
  const schedule = {
    timezone: "Asia/Kuala_Lumpur",
    weekdays: [
      [
        { start: "09:00", end: "09:15" },
        { start: "09:15", end: "10:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ],
    closures: [],
  };
  assert.equal(
    withinHours(
      "2026-10-19T09:00:00+08:00",
      "2026-10-19T09:30:00+08:00",
      schedule,
    ),
    true,
  );
  assert.equal(
    withinHours(
      "2026-10-18T09:00:00+08:00",
      "2026-10-18T09:30:00+08:00",
      schedule,
    ),
    false,
  );
});
