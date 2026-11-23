// Pure rules behind the contact timeline: each entry's label, its one line,
// its marker, where it links, and how a later page joins the list.
import type { TimelineEntry } from "../../../packages/contracts/src/contacts";
import { KIND_WORDS, stateWords } from "./follow-up-rules";
import { outcomeText } from "./call-words";

type W = (en: string, ms: string) => string;

export const LABELS: Record<TimelineEntry["kind"], [string, string]> = {
  call: ["Call", "Panggilan"],
  chat: ["WhatsApp", "WhatsApp"],
  booking: ["Appointment", "Janji temu"],
  note: ["Note", "Nota"],
  consent: ["Consent", "Persetujuan"],
  follow_up: ["Follow-up", "Susulan"],
};

const AUTHORS: Record<string, [string, string]> = {
  customer: ["Customer", "Pelanggan"],
  agent: ["AI agent", "Ejen AI"],
  staff: ["Staff", "Staf"],
};

// The entry's one line. A booking's time is formatted by the screen, which
// owns the calendar's wording, so it is left out here.
export function entryLine(e: TimelineEntry, w: W): string {
  switch (e.kind) {
    case "call": {
      const parts = [outcomeText(e, w)];
      if (e.duration_seconds)
        parts.push(
          e.duration_seconds < 60
            ? w(`${e.duration_seconds} s`, `${e.duration_seconds} saat`)
            : w(
                `${Math.round(e.duration_seconds / 60)} min`,
                `${Math.round(e.duration_seconds / 60)} min`,
              ),
        );
      if (e.after_hours) parts.push(w("After hours", "Luar waktu"));
      return parts.join(" · ");
    }
    case "chat": {
      if (!e.last_author) return w("No messages yet", "Tiada mesej lagi");
      const text =
        e.last_kind === "media"
          ? w("Sent a file", "Menghantar fail")
          : e.last_body || w("(no text)", "(tiada teks)");
      const who = AUTHORS[e.last_author];
      return who ? `${w(who[0], who[1])}: ${text}` : text;
    }
    case "booking":
      return e.title;
    case "note":
      return e.text;
    case "consent":
      return [
        e.channel === "phone" ? w("Phone", "Telefon") : "WhatsApp",
        e.purpose === "marketing"
          ? w("Marketing", "Pemasaran")
          : w("Service", "Perkhidmatan"),
        e.granted ? w("Granted", "Diberi") : w("Withdrawn", "Ditarik balik"),
      ].join(" · ");
    case "follow_up": {
      const k = KIND_WORDS[e.follow_up_kind],
        s = stateWords({ kind: e.follow_up_kind, state: e.state });
      // An open item carries the "Open" flag instead.
      return [w(k[0], k[1]), e.state === "open" ? null : w(s[0], s[1]), e.text]
        .filter(Boolean)
        .join(" · ");
    }
  }
}

export type Marker = "open" | "upcoming" | "waiting" | null;
// A small flag on what still needs someone: an open follow-up, a booking
// still ahead, a chat waiting for staff.
export function marker(e: TimelineEntry, now: Date): Marker {
  if (e.kind === "follow_up" && e.state === "open") return "open";
  if (
    e.kind === "booking" &&
    e.status !== "cancelled" &&
    Date.parse(e.start_at) > now.getTime()
  )
    return "upcoming";
  if (e.kind === "chat" && e.needs_attention) return "waiting";
  return null;
}
export const MARKER_WORDS: Record<Exclude<Marker, null>, [string, string]> = {
  open: ["Open", "Terbuka"],
  upcoming: ["Upcoming", "Akan datang"],
  waiting: ["Waiting for staff", "Menunggu staf"],
};

// The page an entry opens, its query parameter and the id to pass, when
// there is one. The follow-up page opens open items only, so a closed item
// links to its call or chat, which list their items in every state.
export function linkOf(
  e: TimelineEntry,
): { path: string; param: string; id: string } | null {
  if (e.kind === "call") return { path: "/app/calls", param: "call", id: e.id };
  if (e.kind === "chat")
    return { path: "/app/inbox", param: "conversation", id: e.id };
  if (e.kind === "booking")
    return { path: "/app/bookings", param: "booking", id: e.id };
  if (e.kind === "follow_up") {
    if (e.state === "open")
      return { path: "/app/follow-ups", param: "item", id: e.id };
    if (e.call_id) return { path: "/app/calls", param: "call", id: e.call_id };
    if (e.conversation_id)
      return { path: "/app/inbox", param: "conversation", id: e.conversation_id };
  }
  return null;
}

// A later page joins the list without repeating an entry already shown: a
// chat sorts by its latest message, so it can move while someone pages.
export function appendPage(
  shown: TimelineEntry[],
  page: TimelineEntry[],
): TimelineEntry[] {
  const seen = new Set(shown.map((e) => e.kind + ":" + e.id));
  return [...shown, ...page.filter((e) => !seen.has(e.kind + ":" + e.id))];
}
