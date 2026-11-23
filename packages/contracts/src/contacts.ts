import { z } from "zod";
import { name, uuid } from "./index.ts";
export const contactFields = {
  name,
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{1,14}$/)
    .nullable(),
  preferredLanguage: z.enum(["ms", "en", "zh"]),
};
export const contactInput = z.object(contactFields).strict();
export const contactUpdate = z
  .object({ ...contactFields, expectedRevision: z.number().int().positive() })
  .strict();
export const noteInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    text: z.string().trim().min(1).max(5000),
  })
  .strict();
export const consentInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    channel: z.enum(["phone", "whatsapp"]),
    purpose: z.enum(["service", "marketing"]),
    granted: z.boolean(),
    source: z.string().trim().min(1).max(2000),
    evidence: z.string().trim().min(1).max(2000),
  })
  .strict();
export const dncInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

// One contact's history, newest first (contact timeline design, 2026-11-24).
export const timelineInput = z
  .object({ id: uuid, cursor: z.string().max(300).optional() })
  .strict();
type Entry<K extends string, T> = { kind: K; id: string; at: string } & T;
export type TimelineEntry =
  // The call screen's summary facts only: never what was said.
  | Entry<
      "call",
      {
        state: "active" | "ended" | "refused";
        refusal: string | null;
        outcome: string | null;
        duration_seconds: number | null;
        after_hours: boolean;
        transfer_result: string | null;
      }
    >
  // One entry per WhatsApp conversation, sorted by its latest message.
  | Entry<
      "chat",
      {
        state: string;
        owner: string;
        needs_attention: boolean;
        last_author: "customer" | "agent" | "staff" | "system" | null;
        last_kind: "text" | "template" | "media" | "unsupported" | null;
        // At most 200 characters; empty for media.
        last_body: string | null;
      }
    >
  | Entry<
      "booking",
      {
        title: string;
        start_at: string;
        status: "requested" | "confirmed" | "cancelled";
      }
    >
  | Entry<"note", { text: string }>
  | Entry<
      "consent",
      { channel: string; purpose: string; granted: boolean; evidence: string }
    >
  | Entry<
      "follow_up",
      {
        follow_up_kind: "booking" | "message" | "handoff";
        source: "call" | "whatsapp";
        state: "open" | "done" | "dismissed";
        due_at: string | null;
        // Where it came from; a closed item links there, where it shows in
        // every state (the follow-up page opens open items only).
        call_id: string | null;
        conversation_id: string | null;
        // What the customer said or asked for, at most 200 characters.
        text: string | null;
      }
    >;
export type ContactTimeline = {
  items: TimelineEntry[];
  next: string | null;
  // First page only: the contact's open follow-up items, oldest first, at
  // most 10, so an old open item is never buried. Null on later pages.
  open: TimelineEntry[] | null;
};
