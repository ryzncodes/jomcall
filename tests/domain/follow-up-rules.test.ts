// Rules behind the follow-up screens: buttons per item, words, due times in
// Kuala Lumpur and what a refused command means. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_WORDS,
  actionsFor,
  cancelQuestion,
  commandOf,
  bookingStart,
  calendarGone,
  dueChoice,
  dueFromInput,
  dueState,
  dueToInput,
  itemText,
  needsReload,
  refusalWords,
  stateWords,
} from "../../web/lib/core/follow-up-rules.ts";

const contact = { id: "c1", name: "Aisyah Contoh", phone: "+60123330001" };

test("buttons: booking items confirm or decline; no contact means decline and Bookings", () => {
  const b = null;
  assert.deepEqual(actionsFor({ kind: "message", state: "open", contact, booking_id: b }), ["done", "dismiss"]);
  assert.deepEqual(actionsFor({ kind: "handoff", state: "open", contact: null, booking_id: b }), ["done", "dismiss"]);
  assert.deepEqual(actionsFor({ kind: "booking", state: "open", contact, booking_id: b }), ["confirm", "decline"]);
  assert.deepEqual(actionsFor({ kind: "booking", state: "open", contact: null, booking_id: b }), ["decline", "bookings"]);
  assert.deepEqual(actionsFor({ kind: "message", state: "dismissed", contact, booking_id: b }), ["reopen"]);
  assert.deepEqual(actionsFor({ kind: "message", state: "done", contact, booking_id: b }), ["reopen"]);
});

test("reopening a confirmed booking says it cancels the booking; a declined one reopens plainly", () => {
  const confirmed = { kind: "booking" as const, state: "done" as const, contact, booking_id: "b1" };
  assert.deepEqual(actionsFor(confirmed), ["reopen_booking"]);
  assert.deepEqual(ACTION_WORDS.reopen_booking, ["Cancel booking and reopen", "Batalkan tempahan dan buka semula"]);
  assert.deepEqual(actionsFor({ ...confirmed, state: "dismissed" }), ["reopen"]);
  assert.deepEqual(actionsFor({ ...confirmed, booking_id: null }), ["reopen"]);
  assert.deepEqual(ACTION_WORDS.reopen, ["Reopen", "Buka semula"]);
  // Both reopen the item; only one of them is a link.
  assert.equal(commandOf("reopen_booking"), "reopen");
  assert.equal(commandOf("reopen"), "reopen");
  assert.equal(commandOf("decline"), "close_dismissed");
  assert.equal(commandOf("bookings"), undefined);
  assert.deepEqual(cancelQuestion("24 Nov 2026, 9:00 am"), [
    "Cancel the booking for 24 Nov 2026, 9:00 am?",
    "Batalkan tempahan untuk 24 Nov 2026, 9:00 am?",
  ]);
  assert.deepEqual(cancelQuestion(undefined), ["Cancel this booking?", "Batalkan tempahan ini?"]);
});

test("the Bookings link uses the Bookings page's own words", async () => {
  const en = (await import("../../web/messages/en.json", { with: { type: "json" } })).default;
  const ms = (await import("../../web/messages/ms.json", { with: { type: "json" } })).default;
  assert.deepEqual(ACTION_WORDS.bookings, [en.crm.bookings, ms.crm.bookings]);
});

test("state in words: a closed booking request reads confirmed or declined", () => {
  assert.deepEqual(stateWords({ kind: "booking", state: "open" }), ["Open", "Terbuka"]);
  assert.deepEqual(stateWords({ kind: "booking", state: "done" }), ["Confirmed", "Disahkan"]);
  assert.deepEqual(stateWords({ kind: "booking", state: "dismissed" }), ["Declined", "Ditolak"]);
  assert.deepEqual(stateWords({ kind: "message", state: "done" }), ["Done", "Selesai"]);
  assert.deepEqual(stateWords({ kind: "handoff", state: "dismissed" }), ["Dismissed", "Diketepikan"]);
});

test("item text by kind", () => {
  assert.equal(itemText({ kind: "message", details: { text: "Sila telefon semula." } }), "Sila telefon semula.");
  assert.equal(itemText({ kind: "handoff", details: { reason: "Aduan" } }), "Aduan");
  assert.equal(itemText({ kind: "booking", details: { title: "Potong rambut" } }), "Potong rambut");
  assert.equal(itemText({ kind: "message", details: { text: "  " } }), undefined);
  assert.equal(itemText({ kind: "message", details: { text: 5 } }), undefined);
  assert.equal(bookingStart({ kind: "booking", details: { startAt: "2026-11-24T02:00:00.000Z" } }), "2026-11-24T02:00:00.000Z");
  assert.equal(bookingStart({ kind: "booking", details: { startAt: "soon" } }), undefined);
  assert.equal(bookingStart({ kind: "message", details: { startAt: "2026-11-24T02:00:00.000Z" } }), undefined);
});

test("due choices are the end of the Kuala Lumpur day", () => {
  // 23:30 KL on 22 Nov is 15:30 UTC.
  const late = new Date("2026-11-22T15:30:00Z");
  assert.equal(dueChoice("today", late), "2026-11-22T15:59:00.000Z");
  assert.equal(dueChoice("tomorrow", late), "2026-11-23T15:59:00.000Z");
  // 00:30 KL on 23 Nov is 16:30 UTC on 22 Nov.
  const early = new Date("2026-11-22T16:30:00Z");
  assert.equal(dueChoice("today", early), "2026-11-23T15:59:00.000Z");
  assert.equal(dueFromInput("2026-11-24T15:00"), "2026-11-24T07:00:00.000Z");
  assert.equal(dueFromInput("2026-11-24"), undefined);
  assert.equal(dueToInput("2026-11-24T07:00:00.000Z"), "2026-11-24T15:00");
});

test("due state", () => {
  const now = new Date("2026-11-22T02:00:00Z"); // 10:00 KL
  assert.equal(dueState("2026-11-22T01:00:00Z", now), "overdue");
  assert.equal(dueState("2026-11-22T15:59:00Z", now), "today");
  assert.equal(dueState("2026-11-23T15:59:00Z", now), "tomorrow");
  assert.equal(dueState("2026-11-23T16:00:00Z", now), "later");
});

test("a refused confirm whose item is still there means the calendar is gone", () => {
  assert.equal(calendarGone("NOT_FOUND", "confirm", true), true);
  assert.equal(calendarGone("NOT_FOUND", "confirm", false), false);
  assert.equal(calendarGone("NOT_FOUND", "done", true), false);
  assert.equal(calendarGone("SLOT_UNAVAILABLE", "confirm", true), false);
  assert.equal(needsReload("CONFLICT"), true);
  assert.equal(needsReload("NOT_FOUND"), true);
  assert.equal(needsReload("SLOT_UNAVAILABLE"), false);
  assert.equal(needsReload(null), false);
});

test("refusal words: the brief's sentences, or the shared copy", () => {
  assert.equal(refusalWords("CONFLICT", "done", true)![0], "Someone changed this item. It has been reloaded.");
  assert.equal(refusalWords("CONFLICT", "done", false)![1], "Seseorang telah mengubah item ini. Item dimuat semula.");
  assert.equal(
    refusalWords("NOT_FOUND", "confirm", true)![0],
    "This booking can't be confirmed: its calendar is no longer available.",
  );
  assert.equal(refusalWords("NOT_FOUND", "confirm", true)![1], "Tempahan ini tidak dapat disahkan: kalendarnya tiada lagi.");
  assert.equal(refusalWords("NOT_FOUND", "confirm", false)![0], "This item is no longer available.");
  assert.equal(refusalWords("NOT_FOUND", "done", true)![0], "This item is no longer available.");
  assert.equal(refusalWords("SLOT_UNAVAILABLE", "confirm", true), undefined);
  assert.equal(refusalWords(null, "done", true), undefined);
});
