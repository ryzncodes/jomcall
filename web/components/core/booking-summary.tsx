"use client";
import { useCore, useWords, useResource, Notice } from "./state";
import { useExperience } from "../experience";
import { localDay, dayInstant, shiftDay } from "./booking-calendar";
export function BookingSummary() {
  const { client } = useCore(),
    w = useWords(),
    { href } = useExperience();
  const day = localDay();
  const data = useResource(async () => {
    let count = 0,
      requested = 0,
      cursor: string | undefined;
    do {
      const page = await client.execute("bookings", {
        from: dayInstant(day),
        to: dayInstant(shiftDay(day, 1)),
        limit: 100,
        cursor,
      });
      count += page.items.filter((b) => b.status === "confirmed").length;
      requested += page.items.filter((b) => b.status === "requested").length;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { count, requested };
  }, "home-bookings|" + day);
  return (
    <section className="core-panel core-booking-summary">
      <div>
        <p className="eyebrow">
          {w("Today · local calendar", "Hari ini · kalendar setempat")}
        </p>
        <h2>
          {data.data
            ? `${data.data.count} ${w("confirmed", "disahkan")}`
            : w("Appointments", "Janji temu")}
        </h2>
        <p>
          {data.data
            ? `${data.data.requested} ${w("requests awaiting confirmation", "permohonan menunggu pengesahan")}`
            : w("Loading calendar…", "Memuatkan kalendar…")}
        </p>
        <Notice error={data.error} />
      </div>
      <a className="button secondary-button" href={href("/app/bookings")}>
        {w("Open calendar", "Buka kalendar")}
      </a>
    </section>
  );
}
