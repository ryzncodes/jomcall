import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpAlertMail, parseFollowUpAlert } from "../../engine/src/follow-up-alert.ts";

// The follow-up email's text (follow-up queue design, alerts, D4). Pure.
const base = "https://app.example.invalid/";
const id = "11111111-2222-4333-8444-555555555555";
const ACTION = {
  message: ["took a message", "menerima mesej"],
  booking: ["recorded a booking request", "merekodkan permintaan tempahan"],
  handoff: ["asked for a staff member", "meminta kakitangan"],
} as const;
const FROM = { call: ["from a phone call", "daripada panggilan telefon"], whatsapp: ["on WhatsApp", "di WhatsApp"] } as const;

test("every kind, source and reason reads exactly as fixed", () => {
  for (const kind of ["booking", "message", "handoff"] as const)
    for (const source of ["call", "whatsapp"] as const)
      for (const reason of ["new", "assigned"] as const) {
        const a = parseFollowUpAlert({ operationId: "op", email: "a@example.test", reason, kind, source, createdAt: "2026-11-22T02:42:00.000Z", followUpId: id });
        const m = followUpAlertMail(a, base);
        const link = `https://app.example.invalid/app/follow-ups?item=${id}`;
        assert.equal(
          m.subject,
          reason === "new"
            ? "New follow-up in JomCall / Susulan baharu dalam JomCall"
            : "A follow-up was assigned to you / Satu susulan diberikan kepada anda",
        );
        assert.equal(
          m.text,
          [
            `The JomCall agent ${ACTION[kind][0]} ${FROM[source][0]} at 22 Nov 2026, 10:42.`,
            ...(reason === "assigned" ? ["It has been assigned to you."] : []),
            `Open: ${link}`,
            "",
            `Ejen JomCall ${ACTION[kind][1]} ${FROM[source][1]} pada 22 Nov 2026, 10:42.`,
            ...(reason === "assigned" ? ["Susulan ini diberikan kepada anda."] : []),
            `Buka: ${link}`,
          ].join("\n"),
        );
      }
});

test("the time is Kuala Lumpur's, across midnight and a year end, with BM month names", () => {
  const mk = (createdAt: string) =>
    followUpAlertMail(parseFollowUpAlert({ operationId: "o", email: "a@b.test", reason: "new", kind: "message", source: "call", createdAt, followUpId: id }), base).text;
  const t = mk("2026-12-31T16:05:00+00:00");
  assert.match(t, /at 1 Jan 2027, 00:05\./);
  assert.match(t, /pada 1 Jan 2027, 00:05\./);
  const dec = mk("2026-12-10T03:00:00Z");
  assert.match(dec, /at 10 Dec 2026, 11:00\./);
  assert.match(dec, /pada 10 Dis 2026, 11:00\./);
});

test("a malformed payload is refused", () => {
  assert.throws(() => parseFollowUpAlert({ reason: "other" }));
});
