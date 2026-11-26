// Rules behind the contact timeline screen: each entry's line, its flag, its
// link, and joining a later page without repeats. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendPage,
  entryLine,
  linkOf,
  marker,
} from "../../web/lib/core/timeline-rules.ts";
import type { TimelineEntry } from "../../packages/contracts/src/contacts.ts";

const en = (a: string) => a;
const ms = (_a: string, b: string) => b;
const at = "2026-11-24T02:00:00.000Z";
const now = new Date("2026-11-24T03:00:00.000Z");

const call: TimelineEntry = {
  kind: "call", id: "c1", at, state: "ended", refusal: null, outcome: "message",
  duration_seconds: 185, after_hours: true, transfer_result: null,
};

test("a call's line uses the call log's words, duration and after hours", () => {
  assert.equal(entryLine(call, en), "Message taken · 3 min · After hours");
  assert.equal(entryLine(call, ms), "Mesej diambil · 3 min · Luar waktu");
  assert.equal(
    entryLine({ ...call, state: "refused", refusal: "WALLET_EMPTY", outcome: null, duration_seconds: null, after_hours: false }, en),
    "Not answered",
  );
  assert.equal(entryLine({ ...call, duration_seconds: 42, after_hours: false }, en), "Message taken · 42 s");
});

test("a chat names who wrote last; files and empty chats have their own words", () => {
  const chat: TimelineEntry = {
    kind: "chat", id: "w1", at, state: "open", owner: "agent", needs_attention: true,
    last_author: "customer", last_kind: "text", last_body: "Ada slot petang?",
  };
  assert.equal(entryLine(chat, en), "Customer: Ada slot petang?");
  assert.equal(entryLine({ ...chat, last_author: "agent", last_kind: "media", last_body: "" }, ms), "Ejen AI: Menghantar fail");
  assert.equal(entryLine({ ...chat, last_author: null, last_kind: null, last_body: null }, en), "No messages yet");
  assert.equal(marker(chat, now), "waiting");
  assert.equal(marker({ ...chat, needs_attention: false }, now), null);
});

test("follow-ups and bookings are flagged while they still need someone", () => {
  const f: TimelineEntry = {
    kind: "follow_up", id: "f1", at, follow_up_kind: "booking", source: "call", state: "open", due_at: null,
    call_id: "c9", conversation_id: null, text: "Potong rambut",
  };
  // Open items open on the follow-up page; closed ones on their call or chat.
  assert.deepEqual(linkOf(f), { path: "/app/follow-ups", param: "item", id: "f1" });
  assert.deepEqual(linkOf({ ...f, state: "done" }), { path: "/app/calls", param: "call", id: "c9" });
  assert.deepEqual(linkOf({ ...f, state: "dismissed", source: "whatsapp", call_id: null, conversation_id: "w9" }), {
    path: "/app/inbox", param: "conversation", id: "w9",
  });
  assert.equal(linkOf({ ...f, state: "done", call_id: null }), null);
  assert.equal(entryLine(f, en), "Booking request · Potong rambut");
  assert.equal(marker(f, now), "open");
  assert.equal(entryLine({ ...f, state: "dismissed" }, en), "Booking request · Declined · Potong rambut");
  assert.equal(marker({ ...f, state: "done" }, now), null);
  const b: TimelineEntry = { kind: "booking", id: "b1", at, title: "Potong rambut", start_at: "2026-11-25T02:00:00.000Z", status: "confirmed" };
  assert.equal(marker(b, now), "upcoming");
  assert.equal(marker({ ...b, status: "cancelled" }, now), null);
  assert.equal(marker({ ...b, start_at: "2026-11-23T02:00:00.000Z" }, now), null);
});

test("consent reads channel, purpose and choice; links go to the record's page", () => {
  const c: TimelineEntry = { kind: "consent", id: "k1", at, channel: "phone", purpose: "marketing", granted: false, evidence: "Minta berhenti" };
  assert.equal(entryLine(c, en), "Phone · Marketing · Withdrawn");
  assert.equal(linkOf(c), null);
  assert.deepEqual(linkOf(call), { path: "/app/calls", param: "call", id: "c1" });
  assert.deepEqual(linkOf({ kind: "chat", id: "w", at, state: "open", owner: "agent", needs_attention: false, last_author: null, last_kind: null, last_body: null }), {
    path: "/app/inbox", param: "conversation", id: "w",
  });
});

test("a later page drops entries already shown, by kind and id", () => {
  const note = (id: string): TimelineEntry => ({ kind: "note", id, at, text: "Nota" });
  const shown = [note("a"), { ...call, id: "a" }];
  assert.deepEqual(
    appendPage(shown, [note("a"), note("b")]).map((e) => e.kind + e.id),
    ["notea", "calla", "noteb"],
  );
});
