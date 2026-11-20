import { z } from "zod";
import { uuid } from "./index.ts";

// Phone numbers and real calls (local app). E.164 only; fake numbers in tests.
export const e164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/);
export const phoneNumberCreate = z
  .object({
    e164,
    label: z.string().trim().max(80).default(""),
    locationId: uuid,
    agentId: uuid,
    transferE164: e164.nullable().default(null),
  })
  .strict();
export const phoneNumberUpdate = z
  .object({
    label: z.string().trim().max(80),
    locationId: uuid,
    agentId: uuid,
    transferE164: e164.nullable(),
    active: z.boolean(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const callList = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export type PhoneNumber = {
  id: string;
  e164: string;
  label: string;
  location_id: string;
  agent_id: string;
  transfer_e164: string | null;
  active: boolean;
  revision: number;
  created_at: string;
};
export type Channels = {
  // The service offers the channel: its page shows in the sidebar.
  phone: boolean;
  whatsapp: boolean;
  integrations: boolean;
  // This workspace answers on it now (a number or a connected channel).
  live: { phone: boolean; whatsapp: boolean };
};
// A request for a phone number. Numbers are bought by an operator, so the
// owner asks and waits; the areas are the ones a local number can be had in.
export const phoneAreas = [
  "any",
  "klang_valley",
  "penang",
  "johor",
  "perak",
  "melaka",
  "negeri_sembilan",
  "pahang",
  "kedah",
  "sabah",
  "sarawak",
] as const;
export const phoneNumberRequestCreate = z
  .object({
    area: z.enum(phoneAreas),
    // The business's own existing number, the one it will forward from.
    forwardFrom: e164.nullable().default(null),
  })
  .strict();
export type PhoneNumberRequest = {
  id: string;
  area: (typeof phoneAreas)[number];
  forward_from: string | null;
  state: "open" | "ready" | "cancelled";
  created_at: string;
  ready_at: string | null;
};
export type PhoneNumbers = {
  items: PhoneNumber[];
  // Whether a telephony provider is configured on the agent side; never a value.
  provider: { configured: boolean; reason: string | null };
  // The latest request for a number, if any, and whether the current plan
  // includes a phone number (a request is refused without one).
  request: PhoneNumberRequest | null;
  planIncludesNumber: boolean;
};
export type CallSummary = {
  id: string;
  caller_e164: string | null;
  dialled_e164: string;
  state: "active" | "ended" | "refused";
  refusal: string | null;
  outcome: string | null;
  language: string | null;
  after_hours: boolean;
  do_not_contact: boolean;
  transfer_result: string | null;
  started_at: string;
  duration_seconds: number | null;
};
export type CallTurn = {
  id: string;
  input: string;
  answer: string | null;
  state: string;
  created_at: string;
};
export type CallDetail = CallSummary & {
  disclosure_played_at: string | null;
  recording_enabled: boolean;
  // Managers only; staff see the summary without the words.
  turns: CallTurn[] | null;
  proposals:
    | { id: string; kind: string; state: string; details: unknown }[]
    | null;
};
