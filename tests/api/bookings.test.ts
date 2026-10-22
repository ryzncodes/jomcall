import test from "node:test";
import assert from "node:assert/strict";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { Engine } from "../../engine/src/engine.ts";
import { bookingFixture } from "../helpers/booking.ts";

test("bookings persist transitions, validate scope and dates, preserve occupied reschedule and export/delete", async () => {
  const f = await bookingFixture();
  let engine: Engine | undefined;
  try {
    const create = await f.req("POST", "/bookings", f.input);
    assert.equal(create.status, 200, JSON.stringify(create.body));
    let b = create.body.data;
    assert.equal(b.status, "requested");
    assert.equal(
      (await f.req("POST", "/bookings", { ...f.input, source: "staff" }))
        .status,
      422,
    );
    assert.equal(
      (
        await f.req("POST", "/bookings", {
          ...f.input,
          startAt: f.day + "T09:00:00",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await f.req("POST", "/bookings", {
          ...f.input,
          startAt: f.day + "T09:01:00+08:00",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await f.api.request(
          f.h.bob,
          f.h.orgB.id,
          "GET",
          "/api/v1/bookings/" + b.id,
        )
      ).status,
      404,
    );
    const confirmed = await f.api.request(
      f.h.staff,
      f.h.orgA.id,
      "POST",
      `/api/v1/bookings/${b.id}/confirm`,
      { expectedRevision: 1 },
    );
    assert.equal(confirmed.status, 200);
    b = confirmed.body.data;
    const other = (
      await f.req("POST", "/bookings", {
        ...f.input,
        startAt: f.day + "T10:00:00+08:00",
      })
    ).body.data;
    assert.equal(
      (
        await f.req("POST", `/bookings/${other.id}/confirm`, {
          expectedRevision: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.req("POST", `/bookings/${b.id}/reschedule`, {
          expectedRevision: b.revision,
          startAt: other.start_at,
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.req("GET", `/bookings/${b.id}`)).body.data.start_at,
      f.slotStart,
    );
    assert.equal(
      (
        await f.req("PATCH", `/booking-resources/${f.resource.id}`, {
          name: "Room",
          durationMinutes: 30,
          active: false,
          expectedRevision: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.req("PUT", `/locations/${f.h.orgA.locationId}/schedule`, {
          ...f.schedule,
          expectedRevision: 1,
          closures: [{ date: f.day, reason: "Closed" }],
        })
      ).status,
      409,
    );
    const list = await f.req(
      "GET",
      `/bookings?from=${f.day}T00:00:00Z&to=${f.day}T23:59:59Z&limit=1`,
    );
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 1);
    assert.ok(list.body.data.nextCursor);
    assert.equal(
      (
        await f.req(
          "GET",
          `/bookings?from=${f.day}T00:00:00Z&to=${f.day}T23:59:59Z&status=cancelled&cursor=${list.body.data.nextCursor}`,
        )
      ).status,
      422,
    );
    const ex = (
      await f.req("POST", `/contacts/${f.contact.id}/export`, {
        expectedRevision: 1,
      })
    ).body.data;
    engine = await Engine.create(f.h.namespace);
    await engine.tick();
    const download = await f.req("GET", `/jobs/${ex.id}/download`);
    assert.equal(download.body.bookings.length, 2);
    await f.req("POST", `/contacts/${f.contact.id}/deletion`, {
      expectedRevision: 1,
    });
    assert.equal((await f.req("POST", "/bookings", f.input)).status, 409);
    await engine.tick();
    assert.equal((await f.req("GET", `/bookings/${b.id}`)).status, 404);
  } finally {
    await engine?.close();
    await f.close();
  }
});
