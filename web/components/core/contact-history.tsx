"use client";
// The contact panel's "Still open" list and "History": one list per contact
// of calls, chats, appointments, notes, consent and follow-ups, newest first
// (docs/superpowers/specs/2026-11-24-contact-timeline-design.md). The
// children (the appointments section) sit between the two.
import { useEffect, useState, type ReactNode } from "react";
import type { TimelineEntry } from "../../../packages/contracts/src/contacts";
import { useCore, useWords, useResource, Notice, Loading } from "./state";
import { useExperience } from "../experience";
import { bookingTime, useBookingWords } from "./booking-calendar";
import {
  LABELS,
  MARKER_WORDS,
  appendPage,
  entryLine,
  linkOf,
  marker,
} from "@/lib/core/timeline-rules";

export function ContactHistory({
  contactId,
  children,
}: {
  contactId: string;
  children?: ReactNode;
}) {
  const w = useWords(),
    { client } = useCore();
  const first = useResource(
    () => client.execute("contactTimeline", { id: contactId }),
    "contact-timeline|" + contactId,
  );
  const [older, setOlder] = useState<{
    items: TimelineEntry[];
    next: string | null;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const data = first.data;
  // When page one changes (a saved note or a new call moves every entry
  // down), older pages loaded before it would skip an entry: drop them.
  // Page one also refetches every 15 seconds; an unchanged page keeps them.
  const firstPage = data?.items.map((e) => e.kind + e.id + e.at).join("|");
  useEffect(() => setOlder(undefined), [firstPage]);
  const items = data
    ? older
      ? appendPage(data.items, older.items)
      : data.items
    : [];
  const next = older ? older.next : (data?.next ?? null);
  async function more() {
    if (!next || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const page = await client.execute("contactTimeline", {
        id: contactId,
        cursor: next,
      });
      setOlder((o) => ({
        items: appendPage(o?.items ?? [], page.items),
        next: page.next,
      }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!!data?.open?.length && (
        <section className="core-timeline core-timeline-open">
          <h3>{w("Still open", "Masih terbuka")}</h3>
          {data.open.map((e) => (
            <Entry key={e.kind + e.id} e={e} />
          ))}
        </section>
      )}
      {children}
      <section className="core-timeline">
        <h3>{w("History", "Sejarah")}</h3>
        {!data ? (
          <Loading error={first.error} />
        ) : (
          <>
            <Notice error={first.error} />
            {items.map((e) => (
              <Entry key={e.kind + e.id} e={e} />
            ))}
            {!items.length && (
              <p>
                {w(
                  "Nothing yet. Calls, chats, appointments and notes for this person will show here.",
                  "Belum ada apa-apa. Panggilan, sembang, janji temu dan nota untuk orang ini akan dipaparkan di sini.",
                )}
              </p>
            )}
            <Notice error={error} />
            {next && (
              <div className="core-actions">
                <button
                  className="button secondary-button"
                  onClick={more}
                  disabled={busy}
                >
                  {busy
                    ? w("Loading…", "Memuatkan…")
                    : w("Show older", "Tunjuk yang lebih lama")}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Entry({ e }: { e: TimelineEntry }) {
  const w = useWords(),
    { href, locale } = useExperience(),
    bookingWords = useBookingWords();
  const link = linkOf(e),
    flag = marker(e, new Date());
  const label = LABELS[e.kind];
  const line =
    e.kind === "booking"
      ? [entryLine(e, w), bookingTime(e.start_at, locale, true), bookingWords[e.status]].join(" · ")
      : entryLine(e, w);
  return (
    <article className={`core-timeline-entry core-timeline-${e.kind}`}>
      <div className="core-timeline-head">
        <strong>{w(label[0], label[1])}</strong>
        {flag && (
          <span className={`core-timeline-flag core-timeline-flag-${flag}`}>
            {w(MARKER_WORDS[flag][0], MARKER_WORDS[flag][1])}
          </span>
        )}
        <time dateTime={e.at}>
          {new Date(e.at).toLocaleString(locale === "ms" ? "ms-MY" : "en-MY", {
            timeZone: "Asia/Kuala_Lumpur",
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </div>
      <p>{line}</p>
      {e.kind === "consent" && e.evidence && (
        <p className="core-timeline-detail">{e.evidence}</p>
      )}
      {link && (
        <a className="text-link" href={`${href(link.path)}&${link.param}=${link.id}`}>
          {w("View", "Lihat")}
        </a>
      )}
    </article>
  );
}
