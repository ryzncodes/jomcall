import { z } from "zod";
import { noticeDay } from "./billing-notice.ts";

// The owner/admin/assignee email for a follow-up (follow-up queue design,
// alerts, D4). It says that something needs attention, the kind, the channel
// and the time, and links to the item. Nothing of what the caller or customer
// said, no name, no number, no organization name. English, then Bahasa Melayu.
const alert = z.object({
  operationId: z.string().min(1),
  email: z.string().min(1),
  reason: z.enum(["new", "assigned"]),
  kind: z.enum(["booking", "message", "handoff"]),
  source: z.enum(["call", "whatsapp"]),
  createdAt: z.string().min(1),
  followUpId: z.string().min(1),
});
export type FollowUpAlert = z.infer<typeof alert>;
export const parseFollowUpAlert = (value: unknown): FollowUpAlert => alert.parse(value);

const ACTION = {
  message: { en: "took a message", ms: "menerima mesej" },
  booking: { en: "recorded a booking request", ms: "merekodkan permintaan tempahan" },
  handoff: { en: "asked for a staff member", ms: "meminta kakitangan" },
};
const FROM = {
  call: { en: "from a phone call", ms: "daripada panggilan telefon" },
  whatsapp: { en: "on WhatsApp", ms: "di WhatsApp" },
};

// "22 Nov 2026, 10:42" in Kuala Lumpur (UTC+8, no daylight saving).
function when(createdAt: string, lang: "en" | "ms") {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) throw Error("INVALID_TIME");
  const iso = new Date(ms + 8 * 3600_000).toISOString();
  return `${noticeDay(iso.slice(0, 10), lang)}, ${iso.slice(11, 16)}`;
}

export function followUpAlertMail(a: FollowUpAlert, appBase: string) {
  const link = `${appBase.replace(/\/+$/, "")}/app/follow-ups?item=${a.followUpId}`;
  const assigned = a.reason === "assigned";
  const subject = assigned
    ? "A follow-up was assigned to you / Satu susulan diberikan kepada anda"
    : "New follow-up in JomCall / Susulan baharu dalam JomCall";
  return {
    subject,
    text: [
      `The JomCall agent ${ACTION[a.kind].en} ${FROM[a.source].en} at ${when(a.createdAt, "en")}.`,
      ...(assigned ? ["It has been assigned to you."] : []),
      `Open: ${link}`,
      "",
      `Ejen JomCall ${ACTION[a.kind].ms} ${FROM[a.source].ms} pada ${when(a.createdAt, "ms")}.`,
      ...(assigned ? ["Susulan ini diberikan kepada anda."] : []),
      `Buka: ${link}`,
    ].join("\n"),
  };
}
