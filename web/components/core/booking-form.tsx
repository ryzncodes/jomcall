"use client";
import { useState } from "react";
import type {
  Resource,
  Booking,
} from "../../../packages/contracts/src/booking";
import { Field } from "./field";
import {
  useCore,
  useResource,
  useAction,
  useWords,
  Notice,
  Loading,
} from "./state";
import { localDay, bookingTime } from "./booking-calendar";
import { useExperience } from "../experience";
export function BookingForm({
  resources,
  onSaved,
  booking,
}: {
  resources: Resource[];
  onSaved: () => void;
  booking?: Booking;
}) {
  const { client } = useCore(),
    w = useWords(),
    { locale } = useExperience(),
    action = useAction();
  const [resourceId, setResource] = useState(
      booking?.resource_id ?? resources.find((r) => r.active)?.id ?? "",
    ),
    [search, setSearch] = useState(""),
    [contactId, setContact] = useState(""),
    [title, setTitle] = useState(""),
    [day, setDay] = useState(localDay()),
    [slot, setSlot] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [revision, setRevision] = useState(booking?.revision ?? 1),
    [reschedule, setReschedule] = useState(
      booking
        ? new Date(Date.parse(booking.start_at) + 28800000)
            .toISOString()
            .slice(0, 16)
        : "",
    );
  const contacts = useResource(
    () => client.execute("listContacts", { search, limit: 25 }),
    "booking-contacts|" + search,
  );
  const slots = useResource(
    () =>
      resourceId && !booking
        ? client.execute("availability", {
            resourceId,
            fromDate: day,
            days: 1,
            cursor,
          })
        : Promise.resolve({ items: [], nextCursor: null }),
    "slots|" + resourceId + "|" + day + "|" + cursor,
  );
  return (
    <form
      className="core-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await action.run(() =>
          booking
            ? client.execute("rescheduleBooking", {
                id: booking.id,
                expectedRevision: revision,
                startAt: new Date(reschedule + ":00+08:00").toISOString(),
              })
            : client.execute("requestBooking", {
                contactId,
                resourceId,
                title,
                startAt: slot,
              }),
        );
        if (result) onSaved();
      }}
    >
      <Notice error={action.error} />
      {booking && (
        <button
          type="button"
          className="core-back"
          onClick={() => {
            setRevision(booking.revision);
            setReschedule(
              new Date(Date.parse(booking.start_at) + 28800000)
                .toISOString()
                .slice(0, 16),
            );
          }}
        >
          {w("Reload latest values", "Muat semula nilai terkini")}
        </button>
      )}
      <fieldset disabled={action.busy}>
        {booking ? (
          <>
            <Field
              label={w(
                "New date and time · Kuala Lumpur",
                "Tarikh dan waktu baharu · Kuala Lumpur",
              )}
            >
              <input
                type="datetime-local"
                step="900"
                required
                value={reschedule}
                onChange={(e) => setReschedule(e.target.value)}
              />
            </Field>
            <p>
              {w(
                "The original appointment stays in place if the new time is unavailable.",
                "Janji temu asal dikekalkan jika waktu baharu tidak tersedia.",
              )}
            </p>
          </>
        ) : (
          <>
            <Field label={w("Find contact", "Cari kenalan")}>
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setContact("");
                }}
              />
            </Field>
            <Notice error={contacts.error} />
            <Field label={w("Contact", "Kenalan")}>
              <select
                required
                value={contactId}
                onChange={(e) => setContact(e.target.value)}
              >
                <option value="">
                  {w("Choose a contact", "Pilih kenalan")}
                </option>
                {contacts.data?.items
                  .filter((c) => !c.deletion_pending)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={w("Appointment title", "Tajuk janji temu")}>
              <input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label={w("Resource", "Sumber")}>
              <select
                required
                value={resourceId}
                onChange={(e) => {
                  setResource(e.target.value);
                  setSlot("");
                  setCursor(undefined);
                }}
              >
                <option value="">
                  {w("Choose a resource", "Pilih sumber")}
                </option>
                {resources
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.duration_minutes} min
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={w("Date · Kuala Lumpur", "Tarikh · Kuala Lumpur")}>
              <input
                type="date"
                required
                min={localDay()}
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setSlot("");
                  setCursor(undefined);
                }}
              />
            </Field>
            <div>
              <p className="eyebrow">
                {w("Available times", "Waktu tersedia")}
              </p>
              <Notice error={slots.error} />
              {!slots.data ? (
                <Loading />
              ) : slots.data.items.length ? (
                <div className="core-slot-grid">
                  {slots.data.items.map((s) => (
                    <button
                      type="button"
                      key={s.startAt}
                      aria-pressed={slot === s.startAt}
                      onClick={() => setSlot(s.startAt)}
                    >
                      {bookingTime(s.startAt, locale)}
                    </button>
                  ))}
                </div>
              ) : (
                <p>
                  {w(
                    "No available times. Check resource, branch hours or another date.",
                    "Tiada waktu tersedia. Semak sumber, waktu cawangan atau tarikh lain.",
                  )}
                </p>
              )}
              <div className="core-actions">
                {cursor && (
                  <button type="button" onClick={() => setCursor(undefined)}>
                    {w("First times", "Waktu pertama")}
                  </button>
                )}
                {slots.data?.nextCursor && (
                  <button
                    type="button"
                    onClick={() => setCursor(slots.data!.nextCursor!)}
                  >
                    {w("More times", "Waktu lain")}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
        <button
          className="button button-dark"
          disabled={!booking && (!slot || !contactId || !title)}
        >
          {booking
            ? w("Save new time", "Simpan waktu baharu")
            : w("Create booking request", "Cipta permohonan tempahan")}
        </button>
      </fieldset>
    </form>
  );
}
