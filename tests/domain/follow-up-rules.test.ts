// Rules behind the follow-up screens: buttons per item, words, due times in
// Kuala Lumpur and what a refused command means. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  actionsFor,
  bookingStart,
  calendarGone,
  dueChoice,
  dueFromInput,
  dueState,
  dueToInput,
  itemText,
  needsReload,
  stateWords,
} from "../../web/lib/core/follow-up-rules.ts";

const contact = { id: "c1", name: "Aisyah Contoh", phone: "+60123330001" };

test("buttons: booking items confirm or decline; no contact means decline only", () => {
  assert.deepEqual(actionsFor({ kind: "message", state: "open", contact }), ["done", "dismiss"]);
  assert.deepEqual(actionsFor({ kind: "handoff", state: "open", contact: null }), ["done", "dismiss"]);
  assert.deepEqual(actionsFor({ kind: "booking", state: "open", contact }), ["confirm", "decline"]);
  assert.deepEqual(actionsFor({ kind: "booking", state: "open", contact: null }), ["decline"]);
  assert.deepEqual(actionsFor({ kind: "booking", state: "done", contact }), ["reopen"]);
  assert.deepEqual(actionsFor({ kind: "message", state: "dismissed", contact }), ["reopen"]);
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
