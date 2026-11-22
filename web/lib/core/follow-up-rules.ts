// Pure rules behind the follow-up queue's screens: which buttons an item
// gets, the words for its kind, state and due time, the due times the menu
// offers, and what a failed command means for the screen. Times are in
// Kuala Lumpur, which has no daylight saving (UTC+8 all year).
import type { FollowUp } from "../../../packages/contracts/src/follow-up";
import { klDate } from "./plan-rules";

export type Pair = [string, string];
// "reopen_booking" reopens a confirmed booking item, which also cancels its
// booking (spec 5.2), so it is named for that and asks first. "bookings" is
// a link to the Bookings page, not a command.
export type FollowUpAction =
  | "done"
  | "dismiss"
  | "confirm"
  | "decline"
  | "reopen"
  | "reopen_booking"
  | "bookings";

export const KIND_WORDS: Record<FollowUp["kind"], Pair> = {
  message: ["Message", "Mesej"],
  booking: ["Booking request", "Permintaan tempahan"],
  handoff: ["Wants staff", "Mahu kakitangan"],
};

export const SOURCE_WORDS: Record<FollowUp["source"], Pair> = {
  call: ["Call", "Panggilan"],
  whatsapp: ["WhatsApp", "WhatsApp"],
};

// A booking item closed as dismissed was declined; every other closed item
// reads as done or dismissed.
export function stateWords(item: Pick<FollowUp, "kind" | "state">): Pair {
  if (item.state === "open") return ["Open", "Terbuka"];
  if (item.kind === "booking")
    return item.state === "done"
      ? ["Confirmed", "Disahkan"]
      : ["Declined", "Ditolak"];
  return item.state === "done" ? ["Done", "Selesai"] : ["Dismissed", "Diketepikan"];
}

// The buttons an item gets. A booking item is closed as done only by
// confirming it into the calendar (the server refuses a plain Done), and it
// cannot be booked without a contact: then Decline and a link to Bookings,
// where staff can book it for a contact by hand (design D5). Reopening a
// confirmed booking item cancels its booking, so that button says so.
export function actionsFor(
  item: Pick<FollowUp, "kind" | "state" | "contact" | "booking_id">,
): FollowUpAction[] {
  if (item.state !== "open")
    return item.kind === "booking" && item.state === "done" && item.booking_id ? ["reopen_booking"] : ["reopen"];
  if (item.kind === "booking") return item.contact ? ["confirm", "decline"] : ["decline", "bookings"];
  return ["done", "dismiss"];
}

// The command an action sends; undefined for a link.
export function commandOf(a: FollowUpAction): "close_done" | "close_dismissed" | "confirm" | "reopen" | undefined {
  if (a === "done") return "close_done";
  if (a === "dismiss" || a === "decline") return "close_dismissed";
  if (a === "confirm") return "confirm";
  if (a === "reopen" || a === "reopen_booking") return "reopen";
  return undefined;
}

export const ACTION_WORDS: Record<FollowUpAction, Pair> = {
  done: ["Done", "Selesai"],
  dismiss: ["Dismiss", "Ketepikan"],
  confirm: ["Confirm booking", "Sahkan tempahan"],
  decline: ["Decline", "Tolak"],
  reopen: ["Reopen", "Buka semula"],
  reopen_booking: ["Cancel booking and reopen", "Batalkan tempahan dan buka semula"],
  // The Bookings page's own name (crm.bookings in the messages).
  bookings: ["Bookings", "Tempahan"],
};

// The question before reopen_booking sends; `when` is the booking's time
// as the screen shows it, or undefined when the item has none.
export function cancelQuestion(when: string | undefined): Pair {
  return when
    ? [`Cancel the booking for ${when}?`, `Batalkan tempahan untuk ${when}?`]
    : ["Cancel this booking?", "Batalkan tempahan ini?"];
}
export const CANCEL_YES: Pair = ["Yes, cancel", "Ya, batalkan"];
export const CANCEL_KEEP: Pair = ["Keep it", "Kekalkan"];

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

// The line under the contact: what the customer said or asked for.
export function itemText(item: Pick<FollowUp, "kind" | "details">): string | undefined {
  const d = item.details;
  if (item.kind === "message") return str(d.text);
  if (item.kind === "handoff") return str(d.reason);
  return str(d.title);
}

// A booking item's requested start, when it is a valid time.
export function bookingStart(item: Pick<FollowUp, "kind" | "details">): string | undefined {
  if (item.kind !== "booking") return undefined;
  const at = str(item.details.startAt);
  return at && !Number.isNaN(Date.parse(at)) ? at : undefined;
}

// "Today" and "Tomorrow" in the menu mean the end of that Kuala Lumpur day.
export function dueChoice(choice: "today" | "tomorrow", now: Date): string {
  const day = klDate(new Date(now.getTime() + (choice === "tomorrow" ? 86_400_000 : 0)));
  return new Date(`${day}T23:59:00+08:00`).toISOString();
}

// A date-time picker's value ("2026-11-24T15:00") read as Kuala Lumpur time.
export function dueFromInput(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const at = new Date(`${value}:00+08:00`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

// The picker's value for a stored due time, in Kuala Lumpur.
export function dueToInput(iso: string): string {
  return new Date(Date.parse(iso) + 28_800_000).toISOString().slice(0, 16);
}

export type DueState = "overdue" | "today" | "tomorrow" | "later";
export function dueState(dueAt: string, now: Date): DueState {
  const at = new Date(dueAt);
  if (at.getTime() < now.getTime()) return "overdue";
  const day = klDate(at);
  if (day === klDate(now)) return "today";
  if (day === klDate(new Date(now.getTime() + 86_400_000))) return "tomorrow";
  return "later";
}

// After a refused CONFLICT or NOT_FOUND the screen reads the item again.
// An unknown calendar also answers 404 to a confirm: when the item is still
// there, the calendar is what is missing, and the item stays open. Other
// failures are worded by the shared error copy. These sentences live here,
// not in the shared copy, so the mock preview bundle never carries them.
export const needsReload = (code: string | null) => code === "CONFLICT" || code === "NOT_FOUND";
export function calendarGone(code: string | null, action: FollowUpAction, stillThere: boolean) {
  return code === "NOT_FOUND" && action === "confirm" && stillThere;
}
export const CHANGED: Pair = [
  "Someone changed this item. It has been reloaded.",
  "Seseorang telah mengubah item ini. Item dimuat semula.",
];
export const GONE: Pair = ["This item is no longer available.", "Item ini tiada lagi."];
// The words after a refused command; undefined: use the shared error copy.
export function refusalWords(code: string | null, action: FollowUpAction, stillThere: boolean): Pair | undefined {
  if (code === "CONFLICT") return CHANGED;
  if (code === "NOT_FOUND") return calendarGone(code, action, stillThere) ? CALENDAR_GONE : GONE;
  return undefined;
}
export const CALENDAR_GONE: Pair = [
  "This booking can't be confirmed: its calendar is no longer available.",
  "Tempahan ini tidak dapat disahkan: kalendarnya tiada lagi.",
];

// Sent on the window after any follow-up command succeeds, so the sidebar
// count reads again without waiting for the next focus.
export const FOLLOW_UPS_CHANGED = "jomcall:follow-ups-changed";
