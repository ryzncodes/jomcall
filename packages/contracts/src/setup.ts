// Guided setup: staged answers held until the owner confirms the review page.
import { z } from "zod";
import { scheduleInput } from "./agent.ts";
import type { SetupUpload } from "./setup-upload.ts";

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
    // Set on facts an import drafted, so removing the upload finds them.
    uploadId: z.uuid(),
  })
  .partial()
  .strict();
// Text whose length is counted in code points, as Postgres char_length counts
// it, so a row the reader stored with emoji or rare CJK can still be edited.
const charText = (max: number) =>
  z
    .string()
    .trim()
    .refine((s) => codePoints(s) <= max, { message: "Too long" });
// One price-list row an import drafted (setup_item kind catalogue_row).
export const setupCataloguePayload = z
  .object({
    uploadId: z.uuid(),
    item: charText(200).pipe(z.string().min(1)),
    variant: charText(200),
    priceSen: z.number().int().min(0).max(100000000000).nullable(),
    unit: charText(60),
    notes: charText(300),
  })
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
    replace: z.array(z.uuid()).max(600),
  })
  .strict();

export type SetupApplyResult = {
  agentRevision: number;
  applied: number;
  skipped: {
    itemId: string;
    reason:
      | "conflict"
      | "removed"
      | "unconfirmed"
      // A price row without a price.
      | "no_price"
      // A price row whose name matches an earlier row of the same apply.
      | "duplicate"
      // A fact whose field does not belong to its pack.
      | "unknown_field";
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
  // Price rows that are pending or confirmed only: what apply will do with
  // the row if the owner names nothing in replace (see SetupRowOutcome).
  outcome?: SetupRowOutcome;
  // outcome "duplicate": the staged row that is written instead.
  duplicateOf?: string;
  // Price rows only: the existing confirmed catalogue row with the same name
  // (item or alias), whatever the outcome.
  current?: { item: string; priceSen: number | null };
};
// write: a new catalogue row. update: replaces the price (and unit, notes) of
// the matching row; only when the item is named in replace, so the view never
// shows it. conflict: matches an existing row and is not named in replace (the
// current row is kept). duplicate: another staged row with the same name, or
// the same matching row, wins. no_price, unconfirmed: skipped.
export type SetupRowOutcome =
  | "write"
  | "update"
  | "no_price"
  | "unconfirmed"
  | "duplicate"
  | "conflict";
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
  // Uploads of the open session that are not removed, oldest first.
  uploads: SetupUpload[];
  // "off" when JOMCALL_SETUP_READER is not "anthropic": uploading is refused.
  reader: "ready" | "off";
  // Price rows that are pending or confirmed (total); of those, pending rows
  // still flagged for a check (flagged, can overlap noPrice), rows with no
  // price (noPrice), and the predicted outcomes with nothing named in
  // replace: rows written (willWrite), duplicates and conflicts.
  rows: {
    total: number;
    flagged: number;
    noPrice: number;
    willWrite: number;
    duplicates: number;
    conflicts: number;
  };
};
