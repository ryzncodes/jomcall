import test from "node:test";
import assert from "node:assert/strict";
import { createPhase2Harness } from "../helpers/phase2.ts";
test("booking resources enforce manager, tenant, duration, revision and organization limits", async () => {
  const f = await createPhase2Harness();
  try {
    const input = {
      locationId: f.h.orgA.locationId,
      name: "Contoh Room",
      durationMinutes: 30,
    };
    const r = await f.req("POST", "/booking-resources", input);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(
      (
        await f.api.request(
          f.h.staff,
          f.h.orgA.id,
          "POST",
          "/api/v1/booking-resources",
          input,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.req("POST", "/booking-resources", {
          ...input,
          locationId: f.h.orgB.locationId,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.req("POST", "/booking-resources", {
          ...input,
          durationMinutes: 16,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await f.req("PATCH", `/booking-resources/${r.body.data.id}`, {
          name: "Changed",
          durationMinutes: 45,
          active: true,
          expectedRevision: 99,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.api.request(
          f.h.bob,
          f.h.orgB.id,
          "PATCH",
          `/api/v1/booking-resources/${r.body.data.id}`,
          {
            name: "Changed",
            durationMinutes: 45,
            active: true,
            expectedRevision: 1,
          },
        )
      ).status,
      404,
    );
    await f.h.cleanup.query(
      "insert into app.booking_resource(org_id,location_id,name,duration_minutes) select $1,$2,'Contoh '||n,30 from generate_series(1,99)n",
      [f.h.orgA.id, f.h.orgA.locationId],
    );
    assert.equal(
      (await f.req("POST", "/booking-resources", input)).status,
      429,
    );
  } finally {
    await f.close();
  }
});
