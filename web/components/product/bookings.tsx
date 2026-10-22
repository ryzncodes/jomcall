"use client";
import { useEffect, useState } from "react";
import {
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Plus,
  ArrowUpRight,
  Clock,
  CheckCircle,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { useCrm } from "./crm-provider";
import { AppShell } from "./shell";
import { CrmDialog, dateLabel } from "./crm-ui";
import {
  bookingConflict,
  bookingTime,
  crmApi,
  klDay,
  shiftDay,
  type Booking,
} from "@/lib/api/crm";
import { branchesFor, branchAvailable } from "@/lib/api/admin";
import { clock } from "@/lib/api/client";
export function Bookings() {
  const { t, locale, href } = useExperience(),
    p = t.crm,
    { data, setData } = useCrm(),
    { draft } = useProduct();
  const [day, setDay] = useState(""),
    [month, setMonth] = useState(""),
    [filter, setFilter] = useState("active"),
    [contactFilter, setContactFilter] = useState(""),
    [editor, setEditor] = useState<Booking | null>(null),
    [cancelId, setCancelId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const connected =
    draft?.calendar.status === "connected" &&
    draft.settings.booking_mode === "calendar";
  const create = (contactId?: string) => {
    if (!draft || !data?.contacts.length) return;
    setError("");
    setEditor({
      id: crypto.randomUUID(),
      org_id: draft.organization.id,
      location_id: draft.location.id,
      contact_id: contactId || contactFilter || data.contacts[0].id,
      title: p.defaultTitle,
      start_at: bookingTime(
        day > klDay() ? day : shiftDay(klDay(), 1),
        "10:00",
      ),
      duration_minutes: draft.settings.duration_minutes,
      status: connected ? "confirmed" : "requested",
      source: "staff",
      provider: connected ? draft.calendar.provider : null,
      updated_at: new Date().toISOString(),
    });
  };
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!data || !draft || initialized) return;
    const q = new URLSearchParams(location.search),
      b = data.bookings.find((b) => b.id === q.get("booking"));
    const target = b ? klDay(new Date(b.start_at)) : klDay();
    setDay(target);
    setMonth(target.slice(0, 7));
    const c = q.get("contact");
    if (c && data.contacts.some((p) => p.id === c)) {
      setContactFilter(c);
      if (q.get("new") === "1") create(c);
    }
    if (c && !b) setFilter("all-dates");
    setInitialized(true);
  }, [data, draft, initialized]);
  const bookings =
    data?.bookings
      .filter(
        (b) =>
          (!contactFilter || b.contact_id === contactFilter) &&
          (filter === "all-dates" || klDay(new Date(b.start_at)) === day) &&
          (filter !== "active" || b.status !== "cancelled"),
      )
      .sort((a, b) => a.start_at.localeCompare(b.start_at)) ?? [];
  const first = month ? `${month}-01` : klDay(),
    offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7,
    days = Array.from({ length: 42 }, (_, i) => shiftDay(first, i - offset));
  const changeMonth = (delta: number) => {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    const next = klDay(d);
    setMonth(next.slice(0, 7));
    setDay(next);
  };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!data || !draft || !editor) return;
    const f = new FormData(e.currentTarget),
      title = String(f.get("title")).trim();
    if (!title) return;
    const status = String(f.get("status")) as Booking["status"];
    const original = data.bookings.find((b) => b.id === editor.id);
    if (
      original?.status === "confirmed" &&
      (!connected || draft.calendar.provider !== original.provider)
    ) {
      setError(p.syncWarning);
      return;
    }
    if (status === "confirmed" && !connected) {
      setError(p.calendarRequired);
      return;
    }
    const b: Booking = {
      ...editor,
      title,
      contact_id: String(f.get("contact") || editor.contact_id),
      location_id: String(f.get("location")),
      start_at: bookingTime(String(f.get("date")), String(f.get("time"))),
      duration_minutes: Number(f.get("duration")),
      status,
      provider: status === "confirmed" ? draft.calendar.provider : null,
      updated_at: new Date().toISOString(),
    };
    if (!branchAvailable(draft, b.location_id)) {
      setError(t.admin.branchUnavailable);
      return;
    }
    const issue = bookingConflict(data, b, draft);
    if (issue) {
      setError(p[issue]);
      return;
    }
    setData((d) =>
      d
        ? crmApi.saveBooking(
            d,
            b,
            `${p.bookingEvent}: ${b.title} · ${dateLabel(b.start_at, locale)} · ${p[b.status]}`,
          )
        : d,
    );
    setDay(klDay(new Date(b.start_at)));
    setMonth(klDay(new Date(b.start_at)).slice(0, 7));
    setNotice(p.bookingSaved);
    setEditor(null);
  };
  return (
    <AppShell active="bookings">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main crm-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.bookingTitle}</h1>
            <p>{p.bookingIntro}</p>
          </div>
          <button
            className="button button-dark"
            disabled={!data?.contacts.length}
            onClick={() => create()}
          >
            <Plus size={18} />
            {p.newBooking}
          </button>
        </div>
        <div className="booking-connection">
          <span className={`connection-dot ${connected ? "connected" : ""}`} />
          <span>{connected ? p.connectedHint : p.requestHint}</span>
          <a href={href("/app/integrations")}>
            {p.calendarLink}
            <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="booking-desk">
          <section className="booking-calendar" aria-label={p.calendar}>
            <div className="calendar-heading">
              <h2>
                {dateLabel(`${first}T12:00:00+08:00`, locale, {
                  month: "long",
                  year: "numeric",
                })}
              </h2>
              <div>
                <button
                  className="icon-button"
                  aria-label={p.previous}
                  onClick={() => changeMonth(-1)}
                >
                  <CaretLeft size={18} />
                </button>
                <button
                  className="crm-text-button"
                  onClick={() => {
                    setDay(klDay());
                    setMonth(klDay().slice(0, 7));
                    setFilter("active");
                  }}
                >
                  {p.today}
                </button>
                <button
                  className="icon-button"
                  aria-label={p.next}
                  onClick={() => changeMonth(1)}
                >
                  <CaretRight size={18} />
                </button>
              </div>
            </div>
            <div className="calendar-weekdays" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i}>
                  {dateLabel(
                    `${shiftDay("2026-10-12", i)}T12:00:00+08:00`,
                    locale,
                    { weekday: "short" },
                  )}
                </span>
              ))}
            </div>
            <div className="calendar-grid">
              {days.map((date) => {
                const count =
                  data?.bookings.filter(
                    (b) =>
                      b.status !== "cancelled" &&
                      klDay(new Date(b.start_at)) === date &&
                      (!contactFilter || b.contact_id === contactFilter),
                  ).length ?? 0;
                return (
                  <button
                    key={date}
                    className={`${date.slice(0, 7) !== month ? "outside" : ""} ${date === klDay() ? "is-today" : ""}`}
                    aria-pressed={date === day}
                    aria-label={`${Number(date.slice(-2))}${count ? ` ${count} ${p.bookings}` : ""} — ${dateLabel(`${date}T12:00:00+08:00`, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`}
                    onClick={() => {
                      setDay(date);
                      setMonth(date.slice(0, 7));
                      setFilter("active");
                    }}
                  >
                    <span>{Number(date.slice(-2))}</span>{" "}
                    {count > 0 && (
                      <span className="calendar-count">
                        <i />
                        {count}
                        <span className="calendar-count-label">
                          {" "}
                          {p.bookings}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <footer className="calendar-legend">
              <span>
                <i />
                {p.activeBookings}
              </span>
              <span>{t.timezone}</span>
            </footer>
            <div className="calendar-rules">
              <Clock size={21} />
              <div>
                <strong>
                  {draft?.settings.duration_minutes} {p.minutes} ·{" "}
                  {draft?.settings.buffer_minutes} {p.minutes}
                </strong>
                <a href={href("/app/agent")}>
                  {p.hoursLink}
                  <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          </section>
          <section className="booking-agenda" aria-label={p.agenda}>
            <div className="agenda-heading">
              <span>{filter === "all-dates" ? p.allDates : p.agenda}</span>
              <h2>
                {day
                  ? dateLabel(`${day}T12:00:00+08:00`, locale, {
                      weekday: "short",
                      day: "numeric",
                      month: "long",
                    })
                  : "—"}
              </h2>
              <div className="agenda-filters">
                <select
                  aria-label={p.status}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="active">{p.activeBookings}</option>
                  <option value="all">{p.allBookings}</option>
                  <option value="all-dates">{p.allDates}</option>
                </select>
                <select
                  aria-label={p.filterContact}
                  value={contactFilter}
                  onChange={(e) => setContactFilter(e.target.value)}
                >
                  <option value="">{p.everyone}</option>
                  {data?.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="crm-notice" role="status">
              {notice}
            </p>
            {bookings.map((b) => (
              <article className={`agenda-booking ${b.status}`} key={b.id}>
                <div className="agenda-time">
                  <strong>{clock(b.start_at)}</strong>
                  <span>
                    {b.duration_minutes} {p.minutes}
                  </span>
                </div>
                <div className="agenda-content">
                  <span className={`crm-chip ${b.status}`}>{p[b.status]}</span>
                  <h3>{b.title}</h3>
                  <a href={href(`/app/contacts?contact=${b.contact_id}`)}>
                    {data?.contacts.find((c) => c.id === b.contact_id)?.name}
                    <ArrowUpRight size={14} />
                  </a>
                  <p>
                    {b.source === "ai" ? p.ai : p.manual} ·{" "}
                    {draft &&
                      branchesFor(draft).find((x) => x.id === b.location_id)
                        ?.name}
                    {filter === "all-dates"
                      ? ` · ${dateLabel(b.start_at, locale, { day: "numeric", month: "short" })}`
                      : ""}
                  </p>
                  {b.status === "confirmed" &&
                    (!connected || draft?.calendar.provider !== b.provider) && (
                      <p className="crm-caption">{p.syncWarning}</p>
                    )}
                  {b.status !== "cancelled" && (
                    <div className="agenda-actions">
                      <button
                        onClick={() => {
                          setEditor({
                            ...b,
                            status:
                              b.status === "requested" && connected
                                ? "confirmed"
                                : b.status,
                          });
                          setError("");
                        }}
                      >
                        {b.status === "requested" ? p.confirm : p.reschedule}
                      </button>
                      <button onClick={() => setCancelId(b.id)}>
                        {p.cancelBooking}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {data && !bookings.length && (
              <div className="crm-empty">
                <CalendarBlank size={36} weight="light" />
                <h3>{p.noResults}</h3>
                <p>{p.noDay}</p>
                <button
                  className="button secondary-button"
                  disabled={!data.contacts.length}
                  onClick={() => create()}
                >
                  {p.newBooking}
                </button>
              </div>
            )}
            <footer className="crm-footnote">{p.localNote}</footer>
          </section>
        </div>
        {editor && (
          <CrmDialog
            title={
              data?.bookings.some((b) => b.id === editor.id)
                ? p.bookingDetails
                : p.newBooking
            }
            description={connected ? p.connectedHint : p.requestHint}
            onClose={() => setEditor(null)}
          >
            <form onSubmit={submit}>
              <label className="product-field">
                {p.contact}
                <select
                  aria-label={p.contact}
                  name="contact"
                  disabled={data?.bookings.some((b) => b.id === editor.id)}
                  defaultValue={editor.contact_id}
                >
                  {data?.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="product-field">
                {t.admin.branchChoice}
                <select
                  name="location"
                  aria-label={t.admin.branchChoice}
                  defaultValue={editor.location_id}
                >
                  {draft &&
                    branchesFor(draft)
                      .filter((b) => !b.archived)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                </select>
              </label>
              <label className="product-field">
                {p.service}
                <input
                  name="title"
                  defaultValue={editor.title}
                  required
                  maxLength={100}
                />
              </label>
              <div className="field-pair">
                <label className="product-field">
                  {p.date}
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={klDay(new Date(editor.start_at))}
                  />
                </label>
                <label className="product-field">
                  {p.time}
                  <input
                    type="time"
                    name="time"
                    required
                    defaultValue={clock(editor.start_at)}
                  />
                </label>
              </div>
              <div className="field-pair">
                <label className="product-field">
                  {p.duration}
                  <input
                    type="number"
                    name="duration"
                    min={5}
                    max={240}
                    step={5}
                    required
                    defaultValue={editor.duration_minutes}
                  />
                </label>
                <label className="product-field">
                  {p.status}
                  <select
                    aria-label={p.status}
                    name="status"
                    defaultValue={editor.status}
                  >
                    <option value="requested">{p.requested}</option>
                    <option value="confirmed" disabled={!connected}>
                      {p.confirmed}
                    </option>
                  </select>
                </label>
              </div>
              {error && (
                <p className="crm-form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button button-dark">
                <CheckCircle size={18} />
                {p.save}
              </button>
            </form>
          </CrmDialog>
        )}
        {cancelId && (
          <CrmDialog
            title={p.cancelTitle}
            description={p.cancelBody}
            onClose={() => setCancelId(null)}
          >
            <div className="crm-dialog-actions">
              <button
                className="button secondary-button"
                onClick={() => setCancelId(null)}
              >
                {p.keepBooking}
              </button>
              <button
                className="button button-dark"
                onClick={() => {
                  const b = data?.bookings.find((b) => b.id === cancelId);
                  if (b)
                    setData((d) =>
                      d
                        ? crmApi.saveBooking(
                            d,
                            {
                              ...b,
                              status: "cancelled",
                              updated_at: new Date().toISOString(),
                            },
                            `${p.cancelEvent}: ${b.title} · ${dateLabel(b.start_at, locale)}`,
                          )
                        : d,
                    );
                  setCancelId(null);
                  setNotice(p.bookingCancelled);
                }}
              >
                {p.cancelBooking}
              </button>
            </div>
          </CrmDialog>
        )}
      </main>
    </AppShell>
  );
}
