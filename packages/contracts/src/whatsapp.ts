import { z } from "zod";
import { uuid } from "./index.ts";
import { boundedText } from "./agent-test.ts";

const digits = z.string().regex(/^[0-9]{5,30}$/);
export const channelSave = z
  .object({
    phoneNumberId: digits,
    wabaId: digits,
    // Write-only. Never returned by any command.
    accessToken: z.string().min(1).max(4096).optional(),
    agentEnabled: z.boolean(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export const channelRevision = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const templateCreate = z
  .object({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/),
    language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
    category: z.enum(["utility", "marketing"]),
    purpose: z.enum([
      "reengage",
      "missed_call",
      "booking_confirmation",
      "owner_summary",
      "other",
    ]),
    body: boundedText(1024),
    variables: z.number().int().min(0).max(10),
  })
  .strict();
// Meta's review happens in WhatsApp Manager. Staff record the outcome here
// until template sync exists.
export const templateStatus = z
  .object({
    status: z.enum([
      "draft",
      "pending",
      "approved",
      "rejected",
      "paused",
      "disabled",
    ]),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const staffReply = z
  .object({
    text: boundedText(4000),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const conversationList = z
  .object({ attention: z.enum(["all", "needs"]).optional() })
  .strict();

export type WhatsAppChannel = {
  id: string;
  state: "not_connected" | "pending" | "connected" | "failed" | "disabled";
  state_reason: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone_e164: string | null;
  credentials_set_at: string | null;
  agent_enabled: boolean;
  revision: number;
};
export type WhatsAppTemplate = {
  id: string;
  name: string;
  language: string;
  category: "utility" | "marketing" | "authentication";
  purpose: string;
  status: string;
  body: string;
  variables: number;
  revision: number;
};
export type WhatsAppOverview = {
  readiness: {
    provider: "disabled" | "fake" | "cloud";
    configured: boolean;
    missing: string[];
  };
  channel: WhatsAppChannel | null;
  templates: WhatsAppTemplate[];
};
export type ConversationSummary = {
  id: string;
  contact_id: string;
  contact_name: string;
  wa_id: string;
  state: "open" | "closed";
  owner: "agent" | "staff";
  needs_attention: boolean;
  attention_reason: string | null;
  last_message_at: string;
  last_body: string | null;
  revision: number;
};
export type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  author: "customer" | "agent" | "staff" | "system";
  kind: string;
  body: string;
  status: string;
  error_code: string | null;
  created_at: string;
};
export type ConversationDetail = ConversationSummary & {
  last_inbound_at: string | null;
  window_open: boolean;
  messages: ChatMessage[];
  proposals: {
    id: string;
    kind: string;
    details: unknown;
    state: string;
    created_at: string;
  }[];
};
export { uuid };
