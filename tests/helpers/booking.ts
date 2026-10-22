import { createPhase2Harness } from "./phase2.ts";
export async function bookingFixture() {
  const f = await createPhase2Harness();
  const resource = (
    await f.req("POST", "/booking-resources", {
      locationId: f.h.orgA.locationId,
      name: "Contoh Room",
      durationMinutes: 30,
    })
  ).body.data;
  const contact = (
    await f.req("POST", "/contacts", {
      name: "Contoh Guest",
      phone: null,
      preferredLanguage: "en",
    })
  ).body.data;
  return {
    ...f,
    resource,
    contact,
    input: {
      resourceId: resource.id,
      contactId: contact.id,
      title: "Contoh appointment",
      startAt: f.slotStart,
    },
  };
}
