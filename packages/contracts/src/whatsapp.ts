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
// Meta's review happens in WhatsApp Manager. Once the agent process has seen
// a template at the provider (provider_status set), the provider's status is
// copied about once an hour and a manual change is refused. Staff record the
// outcome by hand only for templates never seen at the provider.
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
  // Last time the agent process asked the provider for the templates, and
  // the fixed code of the last failure (null after a successful check).
  templates_synced_at: string | null;
  templates_sync_reason: string | null;
};
// Provider status names the database maps to a local status (see migration
// 20261116150000_whatsapp_template_sync.sql; a test keeps the two equal).
// Any other name leaves the local status alone and is shown as it came.
export const mappedProviderStatuses = [
  "APPROVED",
  "PAUSED",
  "PENDING",
  "IN_REVIEW",
  "IN_APPEAL",
  "REJECTED",
  "DISABLED",
  "ARCHIVED",
  "PENDING_DELETION",
  "LIMIT_EXCEEDED",
] as const;
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
  // The provider's own status name at the last check, or null when the
  // template was not found there (or never checked).
  provider_status: string | null;
  synced_at: string | null;
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
  // The fixed notice a system message carries, or null.
  notice: "notice_opt_out" | "notice_handoff" | "notice_unsupported" | null;
  // True for the message that carried the AI introduction.
  disclosure: boolean;
  // True when the reply-request template went out in place of this text, so
  // the customer never saw the text itself.
  reply_request: boolean;
};
// What the send rules say about a plain staff text right now, read on the
// server from the same facts the agent process uses. The agent process
// decides again at send time, and that decision is the one recorded.
export type ReplyOutlook =
  | { allow: true; mode: "text"; fallback: false; reason: null }
  | { allow: true; mode: "template"; fallback: true; reason: null }
  | { allow: false; mode: null; fallback: false; reason: string };
export type ConversationDetail = ConversationSummary & {
  last_inbound_at: string | null;
  window_open: boolean;
  compliance: {
    do_not_contact: boolean;
    deletion_pending: boolean;
    // Latest recorded answer on WhatsApp; null when never asked.
    consent_service: boolean | null;
    consent_marketing: boolean | null;
  };
  reply_outlook: ReplyOutlook;
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
