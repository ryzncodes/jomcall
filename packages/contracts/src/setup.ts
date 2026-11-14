// Guided setup: staged answers held until the owner confirms the review page.
import { z } from "zod";
import { scheduleInput } from "./agent.ts";

const packId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
const bytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).length;
const codePoints = (s: string) => [...s].length;

// Pack ids are checked against the real packs, duplicates and "extra equals
// main" in the domain route (a refined object cannot be extended per path).
export const setupStart = z
  .object({ mainPack: packId, extraPacks: z.array(packId).max(3) })
  .strict();

const factText = z
  .string()
  .trim()
  .refine((s) => codePoints(s) <= 2000, { message: "Answer too long" })
  // Same 4,000-byte ceiling as a saved fact value.
  .refine((s) => bytes(s) <= 4000, { message: "Value too large" });
const hoursShape = {
  timezone: scheduleInput.shape.timezone,
  weekdays: scheduleInput.shape.weekdays,
};
const wordsShape = {
  greeting: z.string().trim().min(1).max(2000),
  aiDisclosure: z.string().trim().min(1).max(2000),
};
// Editable parts of a staged item, by kind. packId and fieldKey of a fact are
// not editable: unknown keys are refused, and the route merges into the row.
export const setupFactPayload = z
  .object({
    value: factText.min(1),
    title: z.string().trim().min(1).max(200),
    language: z.enum(["ms", "en", "zh", "mixed"]),
  })
  .partial()
  .strict();
export const setupSchedulePayload = z.object(hoursShape).strict();
export const setupSettingsPayload = z.object(wordsShape).strict();

// Fact text is trimmed. Empty text is accepted here and handled as a skip.
export const setupAnswer = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fact"),
      text: factText,
    })
    .strict(),
  z
    .object({
      kind: z.literal("hours"),
      ...hoursShape,
    })
    .strict(),
  z
    .object({
      kind: z.literal("first_words"),
      ...wordsShape,
    })
    .strict(),
  z.object({ kind: z.literal("skip") }).strict(),
]);
export const setupAnswerInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    answer: setupAnswer,
  })
  .strict();
export const setupItemInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    payload: z
      .unknown()
      .refine((v) => v === undefined || bytes(v) <= 8000, {
        message: "Payload too large",
      })
      .optional(),
    state: z.enum(["pending", "confirmed", "removed"]).optional(),
  })
  .strict();

export const setupApplyInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    // Item ids the owner agrees may replace an existing confirmed value.
    replace: z.array(z.uuid()).max(100),
  })
  .strict();

export type SetupApplyResult = {
  agentRevision: number;
  applied: number;
  skipped: {
    itemId: string;
    reason: "conflict" | "removed" | "unconfirmed";
  }[];
};

export type SetupItem = {
  id: string;
  kind: "fact" | "schedule" | "settings" | "catalogue_row";
  key: string;
  payload: unknown;
  source: "interview" | "import";
  needsCheck: boolean;
  checkReason: string | null;
  state: "pending" | "confirmed" | "removed" | "applied";
};
export type SetupQuestionView = {
  id: string;
  kind: "hours" | "first_words" | "fact";
  en: string;
  ms: string;
  fills: string[];
};
export type Setup = {
  session: {
    id: string;
    mainPack: string;
    extraPacks: string[];
    state: "open" | "applied";
    revision: number;
  } | null;
  items: SetupItem[];
  questions: SetupQuestionView[];
  missing: { pack: string; key: string; en: string; ms: string }[];
  conflicts: { itemId: string; current: unknown }[];
  // No open session and the latest one was applied after the published
  // version (or nothing is published): the owner should test and publish.
  finish: boolean;
};
