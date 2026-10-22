"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarBlank, Plus, ArrowLeft } from "@phosphor-icons/react";
import type {
  Resource,
  Booking,
} from "../../../packages/contracts/src/booking";
import {
  useCore,
  useWords,
  useResource,
  useAction,
  Heading,
  Notice,
  Loading,
} from "./state";
import { Field } from "./field";
import { useExperience } from "../experience";
import { BookingForm } from "./booking-form";
import {
  BookingCalendar,
  localDay,
  shiftDay,
  dayInstant,
  bookingTime,
  useBookingWords,
} from "./booking-calendar";
export function LocalBookings() {
  const { client, workspace } = useCore(),
    w = useWords(),
    { href } = useExperience(),
    query = useSearchParams();
  const [day, setDay] = useState(localDay()),
    [locationId, setLocation] = useState(workspace.locations[0]?.id ?? ""),
    [resourceId, setResource] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [selected, setSelected] = useState(query.get("booking") ?? ""),
    [creating, setCreating] = useState(false),
    [managing, setManaging] = useState(false);
  const resources = useResource(
    () => client.execute("bookingResources", { locationId }),
    "resources|" + locationId,
  );
  const list = useResource(
    () =>
      client.execute("bookings", {
        from: dayInstant(day),
        to: dayInstant(shiftDay(day, 1)),
        locationId,
        resourceId: resourceId || undefined,
        limit: 100,
        cursor,
      }),
    "bookings|" + day + "|" + locationId + "|" + resourceId + "|" + cursor,
  );
  return (
    <>
      <Heading
        eyebrow={w("Bookings · Kuala Lumpur", "Tempahan · Kuala Lumpur")}
        title={w(
          "A little room for every customer.",
          "Ruang untuk setiap pelanggan.",
        )}
        description={w(
          "Requests, confirmed appointments and your team’s availability. Together in one local calendar.",
          "Permohonan, janji temu disahkan dan ketersediaan pasukan dalam satu kalendar setempat.",
        )}
      >
        <button
          className="button button-dark"
          onClick={() => {
            setCreating(true);
            setSelected("");
          }}
          disabled={!resources.data?.some((r) => r.active)}
        >
          <Plus size={17} />
          {w("New booking", "Tempahan baharu")}
        </button>
      </Heading>
      <div className="core-booking-toolbar">
        <Field label={w("Branch", "Cawangan")}>
          <select
            value={locationId}
            onChange={(e) => {
              setLocation(e.target.value);
              setResource("");
              setCursor(undefined);
              setSelected("");
              setCreating(false);
              setManaging(false);
            }}
          >
            {workspace.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={w("Resource filter", "Tapis sumber")}>
          <select
            value={resourceId}
            onChange={(e) => {
              setResource(e.target.value);
              setCursor(undefined);
            }}
          >
            <option value="">{w("All resources", "Semua sumber")}</option>
            {resources.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={w("Calendar date", "Tarikh kalendar")}>
          <input
            type="date"
            required
            value={day}
            onChange={(e) => {
              if (e.target.value) {
                setDay(e.target.value);
                setCursor(undefined);
              }
            }}
          />
        </Field>
        {workspace.role !== "staff" && (
          <button
            className="button secondary-button"
            onClick={() => setManaging(!managing)}
          >
            {w("Manage resources", "Urus sumber")}
          </button>
        )}
      </div>
      <Notice error={resources.error ?? list.error} />
      {managing && (
        <ResourceManager
          key={locationId}
          locationId={locationId}
          resources={resources.data ?? []}
          onSaved={() => void resources.reload()}
        />
      )}
      {!resources.data ? (
        <Loading />
      ) : !resources.data.length ? (
        <section className="core-panel core-empty">
          <CalendarBlank size={42} weight="light" />
          <h2>
            {w(
              "Give appointments a place.",
              "Sediakan tempat untuk janji temu.",
            )}
          </h2>
          <p>
            {w(
              "Add a room, chair or staff calendar with an appointment duration. Saved branch hours define when it opens.",
              "Tambah bilik, kerusi atau kalendar kakitangan berserta tempoh janji temu. Waktu cawangan menentukan ketersediaan.",
            )}
          </p>
          <div className="core-actions">
            {workspace.role !== "staff" && (
              <button
                className="button button-dark"
                onClick={() => setManaging(true)}
              >
                {w("Add resource", "Tambah sumber")}
              </button>
            )}
            <a href={href("/app/hours")}>
              {w("Review branch hours", "Semak waktu cawangan")}
            </a>
          </div>
        </section>
      ) : (
        <div className="core-booking-desk">
          <section className="core-panel core-agenda-panel">
            {!list.data ? (
              <Loading error={list.error} />
            ) : (
              <BookingCalendar
                items={list.data?.items ?? []}
                day={day}
                onDay={(d) => {
                  setDay(d);
                  setCursor(undefined);
                }}
                onSelect={(id) => {
                  setSelected(id);
                  setCreating(false);
                }}
                selected={selected}
              />
            )}
            <div className="core-actions">
              {cursor && (
                <button onClick={() => setCursor(undefined)}>
                  {w("First page", "Halaman pertama")}
                </button>
              )}
              {list.data?.nextCursor && (
                <button onClick={() => setCursor(list.data!.nextCursor!)}>
                  {w("Next page", "Halaman seterusnya")}
                </button>
              )}
            </div>
          </section>
          <section className="core-panel">
            {creating ? (
              <>
                <h2>{w("Make a booking request", "Mohon tempahan")}</h2>
                <p>
                  {w(
                    "Your team confirms availability before the appointment is reserved.",
                    "Pasukan mengesahkan ketersediaan sebelum janji temu ditempah.",
                  )}
                </p>
                <BookingForm
                  resources={resources.data}
                  onSaved={() => {
                    setCreating(false);
                    void list.reload();
                  }}
                />
              </>
            ) : selected ? (
              <BookingDetail
                key={selected}
                id={selected}
                resources={resources.data}
                onClose={() => setSelected("")}
              />
            ) : (
              <div className="core-empty core-booking-placeholder">
                <CalendarBlank size={40} weight="light" />
                <h2>
                  {w(
                    "Every appointment, in view.",
                    "Setiap janji temu, jelas.",
                  )}
                </h2>
                <p>
                  {w(
                    "Choose an appointment to review its details, confirm a request or find a better time.",
                    "Pilih janji temu untuk menyemak butiran, mengesahkan permohonan atau menukar waktu.",
                  )}
                </p>
                <small>
                  {w(
                    "Local calendar · no external messages sent",
                    "Kalendar setempat · tiada mesej luar dihantar",
                  )}
                </small>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
function ResourceManager({
  locationId,
  resources,
  onSaved,
}: {
  locationId: string;
  resources: Resource[];
  onSaved: () => void;
}) {
  const w = useWords();
  const [selected, setSelected] = useState("");
  return (
    <section className="core-panel">
      <h2>{w("Booking resources", "Sumber tempahan")}</h2>
      <Field label={w("Edit resource", "Sunting sumber")}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">
            {w("Add new resource", "Tambah sumber baharu")}
          </option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {!r.active ? " · " + w("Archived", "Diarkibkan") : ""}
            </option>
          ))}
        </select>
      </Field>
      <ResourceForm
        key={selected}
        resource={resources.find((r) => r.id === selected)}
        locationId={locationId}
        onSaved={onSaved}
      />
    </section>
  );
}
function ResourceForm({
  resource,
  locationId,
  onSaved,
}: {
  resource?: Resource;
  locationId: string;
  onSaved: () => void;
}) {
  const { client } = useCore(),
    w = useWords(),
    a = useAction();
  const [name, setName] = useState(resource?.name ?? ""),
    [duration, setDuration] = useState(resource?.duration_minutes ?? 30),
    [active, setActive] = useState(resource?.active ?? true),
    [revision, setRevision] = useState(resource?.revision ?? 1);
  return (
    <form
      className="core-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const saved = await a.run(() =>
          resource
            ? client.execute("updateBookingResource", {
                id: resource.id,
                expectedRevision: revision,
                name,
                durationMinutes: duration,
                active,
              })
            : client.execute("createBookingResource", {
                locationId,
                name,
                durationMinutes: duration,
              }),
        );
        if (saved) {
          if (!resource) setName("");
          setRevision(saved.revision);
          onSaved();
        }
      }}
    >
      <Notice error={a.error} saved={a.saved} />
      {resource && (
        <button
          type="button"
          className="core-back"
          onClick={() => {
            setName(resource.name);
            setDuration(resource.duration_minutes);
            setActive(resource.active);
            setRevision(resource.revision);
          }}
        >
          {w("Reload latest values", "Muat semula nilai terkini")}
        </button>
      )}
      <fieldset disabled={a.busy}>
        <div className="core-two-columns">
          <Field label={w("Resource name", "Nama sumber")}>
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={w("Duration · minutes", "Tempoh · minit")}>
            <input
              type="number"
              required
              min={15}
              max={240}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </Field>
        </div>
        {resource && (
          <label className="core-checkbox">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {w("Accept new appointments", "Terima janji temu baharu")}
          </label>
        )}
        <button className="button button-dark">
          {w("Save resource", "Simpan sumber")}
        </button>
      </fieldset>
    </form>
  );
}
function BookingDetail({
  id,
  resources,
  onClose,
}: {
  id: string;
  resources: Resource[];
  onClose: () => void;
}) {
  const { client } = useCore(),
    w = useWords(),
    { locale } = useExperience(),
    copy = useBookingWords(),
    a = useAction();
  const data = useResource(
    () => client.execute("booking", { id }),
    "booking|" + id,
  );
  const [review, setReview] = useState<{
      action: "confirm" | "cancel";
      booking: Booking;
    } | null>(null),
    [moving, setMoving] = useState(false);
  const b = data.data;
  return (
    <>
      <button className="core-back" onClick={onClose}>
        <ArrowLeft size={15} />
        {w("Close details", "Tutup butiran")}
      </button>
      <Notice error={data.error ?? a.error} />
      {!b ? (
        <Loading />
      ) : (
        <>
          <span className="remaining-chip">{copy[b.status]}</span>
          <h2 className="core-detail-title">{b.title}</h2>
          <p>
            {bookingTime(b.start_at, locale, true)} —{" "}
            {bookingTime(b.end_at, locale)}
            <br />
            {resources.find((r) => r.id === b.resource_id)?.name ??
              w("Resource", "Sumber")}{" "}
            · Asia/Kuala_Lumpur
          </p>
          <BookingContact id={b.contact_id} />
          {moving ? (
            <BookingForm
              resources={resources}
              booking={b}
              onSaved={() => {
                setMoving(false);
                void data.reload();
              }}
            />
          ) : (
            b.status !== "cancelled" && (
              <div className="core-actions">
                {b.status === "requested" && (
                  <button
                    className="button button-dark"
                    disabled={a.busy}
                    onClick={() => setReview({ action: "confirm", booking: b })}
                  >
                    {w("Review confirmation", "Semak pengesahan")}
                  </button>
                )}
                <button
                  className="button secondary-button"
                  onClick={() => setMoving(true)}
                >
                  {w("Reschedule", "Tukar waktu")}
                </button>
                <button
                  disabled={a.busy}
                  onClick={() => setReview({ action: "cancel", booking: b })}
                >
                  {w("Cancel appointment", "Batalkan janji temu")}
                </button>
              </div>
            )
          )}
          {review && (
            <div
              className="core-review"
              role="region"
              aria-label={w(
                "Review appointment change",
                "Semak perubahan janji temu",
              )}
            >
              <h3>
                {review.action === "confirm"
                  ? w("Confirm this appointment?", "Sahkan janji temu ini?")
                  : w("Cancel this appointment?", "Batalkan janji temu ini?")}
              </h3>
              <p>
                {review.booking.title} ·{" "}
                {bookingTime(review.booking.start_at, locale, true)}
                <br />
                {w(
                  "This updates your local calendar. No external notification is sent.",
                  "Ini mengemas kini kalendar setempat. Tiada pemberitahuan luar dihantar.",
                )}
              </p>
              <div className="core-actions">
                <button
                  className="button button-dark"
                  disabled={a.busy}
                  onClick={async () => {
                    const result = await a.run(() =>
                      client.execute(
                        review.action === "confirm"
                          ? "confirmBooking"
                          : "cancelBooking",
                        {
                          id: review.booking.id,
                          expectedRevision: review.booking.revision,
                        },
                      ),
                    );
                    if (result) {
                      setReview(null);
                      void data.reload();
                    }
                  }}
                >
                  {review.action === "confirm"
                    ? w("Confirm appointment", "Sahkan janji temu")
                    : w("Yes, cancel appointment", "Ya, batalkan janji temu")}
                </button>
                <button onClick={() => setReview(null)}>
                  {w("Keep reviewing", "Terus semak")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
function BookingContact({ id }: { id: string }) {
  const { client } = useCore(),
    w = useWords(),
    { href } = useExperience();
  const c = useResource(
    () => client.execute("getContact", { id }),
    "booking-contact|" + id,
  );
  return (
    <p>
      {c.data?.name ?? w("Contact", "Kenalan")} ·{" "}
      <a href={href("/app/contacts") + "&contact=" + id}>
        {w("Open contact", "Buka kenalan")}
      </a>
    </p>
  );
}
export function ContactBookings({ contactId }: { contactId: string }) {
  const { client } = useCore(),
    w = useWords(),
    { href, locale } = useExperience(),
    copy = useBookingWords();
  const [day, setDay] = useState(localDay()),
    [cursor, setCursor] = useState<string>();
  const list = useResource(
    () =>
      client.execute("bookings", {
        contactId,
        from: dayInstant(day),
        to: dayInstant(shiftDay(day, 30)),
        cursor,
        limit: 25,
      }),
    "contact-bookings|" + contactId + "|" + day + "|" + cursor,
  );
  return (
    <section className="core-contact-bookings">
      <h3>{w("Appointments", "Janji temu")}</h3>
      <Field label={w("Show appointments from", "Lihat janji temu dari")}>
        <input
          type="date"
          value={day}
          onChange={(e) => {
            if (e.target.value) {
              setDay(e.target.value);
              setCursor(undefined);
            }
          }}
        />
      </Field>
      <Notice error={list.error} />
      {list.data?.items.map((b) => (
        <a
          className="core-history-booking"
          key={b.id}
          href={href("/app/bookings") + "&booking=" + b.id}
        >
          <strong>{b.title}</strong>
          <span>
            {bookingTime(b.start_at, locale, true)} · {copy[b.status]}
          </span>
        </a>
      ))}
      {list.data && !list.data.items.length && (
        <p>
          {w(
            "No appointments in these 30 days.",
            "Tiada janji temu dalam 30 hari ini.",
          )}
        </p>
      )}
      <div className="core-actions">
        {cursor && (
          <button onClick={() => setCursor(undefined)}>
            {w("First page", "Halaman pertama")}
          </button>
        )}
        {list.data?.nextCursor && (
          <button onClick={() => setCursor(list.data!.nextCursor!)}>
            {w("More appointments", "Janji temu lain")}
          </button>
        )}
      </div>
    </section>
  );
}
