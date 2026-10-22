import test from "node:test";
import assert from "node:assert/strict";
import { bookingFixture } from "../helpers/booking.ts";
test("concurrent confirmation cannot overlap; requests do not hold capacity; SQL exclusion survives bypass of domain", async () => {
  const f = await bookingFixture();
  try {
    const a = await f.req("POST", "/bookings", f.input),
      b = await f.req("POST", "/bookings", f.input);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const results = await Promise.all(
      [a, b].map((x) =>
        f.req("POST", `/bookings/${x.body.data.id}/confirm`, {
          expectedRevision: 1,
        }),
      ),
    );
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
    const loser = results[0].status === 409 ? a : b;
    await assert.rejects(
      f.h.cleanup.query(
        "update app.booking set status='confirmed' where id=$1",
        [loser.body.data.id],
      ),
      (e: unknown) => (e as { code: string }).code === "23P01",
    );
    const slots = await f.req(
      "GET",
      `/booking-availability?resourceId=${f.resource.id}&fromDate=${f.day}&days=1`,
    );
    assert.equal(
      slots.body.data.items[0].startAt,
      new Date(Date.parse(f.slotStart) + 1800000).toISOString(),
    );
    const winner = results.find((x) => x.status === 200)!.body.data;
    assert.equal(
      (
        await f.req("POST", `/bookings/${winner.id}/cancel`, {
          expectedRevision: winner.revision,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.req("POST", `/bookings/${loser.body.data.id}/confirm`, {
          expectedRevision: 1,
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});
test('schedule changes race confirmation without invalidating a confirmed slot',async()=>{
 const f=await bookingFixture();try{
 const b=(await f.req('POST','/bookings',f.input)).body.data;
 const results=await Promise.all([
 f.req('POST',`/bookings/${b.id}/confirm`,{expectedRevision:1}),
 f.req('PUT',`/locations/${f.h.orgA.locationId}/schedule`,{...f.schedule,expectedRevision:1,closures:[{date:f.day,reason:'Closed'}]})]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 await assert.rejects(f.h.db.withUserTransaction(f.h.bob,f.h.orgB.id,tx=>tx.query('select app_private.lock_booking_resource($1,$2)',[f.h.orgA.id,f.resource.id])),/NOT_FOUND/);
 const rows=await f.h.db.withUserTransaction(f.h.bob,f.h.orgB.id,tx=>tx.query('select * from app.booking where id=$1',[b.id]));assert.equal(rows.rowCount,0);
 }finally{await f.close();}
});
