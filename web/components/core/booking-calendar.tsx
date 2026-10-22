"use client";
import type { Booking } from "../../../packages/contracts/src/booking";
import { useExperience } from "../experience";
import { useWords } from "./state";
import { coreEn } from "@/messages/core-en";
import { coreMs } from "@/messages/core-ms";
export const localDay = () =>
  new Date(Date.now() + 28800000).toISOString().slice(0, 10);
export const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const dayInstant = (day: string) =>
  new Date(day + "T00:00:00+08:00").toISOString();
export function useBookingWords() {
  return useExperience().locale === "ms" ? coreMs : coreEn;
}
export function bookingTime(value: string, locale = "en", date = false) {
  return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    ...(date ? { day: "numeric", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function BookingCalendar({
  items,
  day,
  onDay,
  onSelect,
  selected,
}: {
  items: Booking[];
  day: string;
  onDay: (day: string) => void;
  onSelect: (id: string) => void;
  selected?: string;
}) {
  const { locale } = useExperience(),
    w = useWords(),
    copy = useBookingWords();
  return (
    <div className="core-booking-agenda">
      <div
        className="core-day-strip"
        aria-label={w("Choose a day", "Pilih hari")}
      >
        {Array.from({ length: 7 }, (_, i) => shiftDay(day, i - 3)).map((d) => (
          <button key={d} aria-pressed={d === day} onClick={() => onDay(d)}>
            <small>
              {new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", {
                weekday: "short",
                timeZone: "Asia/Kuala_Lumpur",
              }).format(new Date(d + "T12:00:00+08:00"))}
            </small>
            <strong>{d.slice(-2)}</strong>
          </button>
        ))}
      </div>
      <div className="core-agenda-list">
        {!items.length ? (
          <div className="core-empty">
            <h2>{copy.empty}</h2>
            <p>
              {w(
                "Choose another day, or make room for a new appointment.",
                "Pilih hari lain atau tambah janji temu baharu.",
              )}
            </p>
          </div>
        ) : (
          items.map((b) => (
            <button
              key={b.id}
              className={
                "core-booking-row " + (selected === b.id ? "selected" : "")
              }
              onClick={() => onSelect(b.id)}
            >
              <time dateTime={b.start_at}>
                {bookingTime(b.start_at, locale)}
              </time>
              <span>
                <strong>{b.title}</strong>
                <small>
                  {bookingTime(b.end_at, locale)} · {copy[b.status]}
                </small>
              </span>
              <span
                className={"core-status-dot " + b.status}
                aria-hidden="true"
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
