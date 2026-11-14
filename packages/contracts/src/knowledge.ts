// Knowledge core inputs. Limits match supabase/migrations/20261114200000_knowledge_core.sql.
import { z } from "zod";
import {
  boundedText,
  modelDecisionSchema,
  toolCallSchema,
} from "./agent-test.ts";

export const LIMITS = {
  facts: 300,
  rules: 100,
  catalogueRows: 10000,
  catalogueBatch: 500,
  packs: 9,
} as const;
export const docLanguage = z.enum(["ms", "en", "zh", "mixed"]);
export const ruleKind = z.enum([
  "never",
  "unknown",
  "message",
  "handoff",
  "after_hours",
  "always",
]);
const packId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
const agentRevision = z.number().int().positive();
const json4k = z
  .unknown()
  .refine(
    (v) =>
      v !== undefined &&
      new TextEncoder().encode(JSON.stringify(v)).length <= 4000,
    { message: "Value too large" },
  );

export const packsInput = z
  .object({
    expectedAgentRevision: agentRevision,
    packs: z
      .array(packId)
      .max(LIMITS.packs)
      .refine((x) => new Set(x).size === x.length),
  })
  .strict();
export const factInput = z
  .object({
    id: z.uuid().optional(),
    expectedAgentRevision: agentRevision,
    packId: packId.optional(),
    fieldKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,60}$/)
      .optional(),
    title: boundedText(200),
    value: json4k,
    language: docLanguage.default("mixed"),
  })
  .strict()
  .refine((x) => !!x.packId === !!x.fieldKey, {
    message: "Pack fields need both packId and fieldKey",
  });
export const ruleInput = z
  .object({
    id: z.uuid().optional(),
    expectedAgentRevision: agentRevision,
    kind: ruleKind,
    text: boundedText(1000),
    packId: packId.optional(),
    packRuleId: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,60}$/)
      .optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((x) => !!x.packId === !!x.packRuleId, {
    message: "Pack rule overrides need both packId and packRuleId",
  });
export const catalogueRowInput = z
  .object({
    item: boundedText(200),
    aliases: z.array(boundedText(120)).max(20).default([]),
    priceSen: z.number().int().min(0).max(100000000000).nullable().default(null),
    stockNote: z.string().max(200).default(""),
    attributes: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,60}$/), z.unknown())
      .default({})
      .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= 4000),
    language: docLanguage.default("mixed"),
  })
  .strict();
export const catalogueInput = z
  .object({
    expectedAgentRevision: agentRevision,
    packId: packId.optional(),
    // Pasted or imported rows arrive as drafts; rows the owner types one by
    // one are confirmed. Drafts never reach the agent.
    status: z.enum(["draft", "confirmed"]),
    rows: z.array(catalogueRowInput).min(1).max(LIMITS.catalogueBatch),
  })
  .strict();
export const confirmInput = z
  .object({ expectedAgentRevision: agentRevision })
  .strict();
export const removeInput = z
  .object({ expectedAgentRevision: agentRevision })
  .strict();
export const gapResolve = z.discriminatedUnion("as", [
  z
    .object({
      as: z.literal("fact"),
      expectedRevision: z.number().int().positive(),
      expectedAgentRevision: agentRevision,
      title: boundedText(200),
      value: boundedText(4000),
    })
    .strict(),
  z
    .object({
      as: z.literal("rule"),
      expectedRevision: z.number().int().positive(),
      expectedAgentRevision: agentRevision,
      kind: ruleKind,
      text: boundedText(1000),
    })
    .strict(),
]);
export const gapIgnore = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
// Browser test paths only (typed and spoken). The shared toolCallSchema,
// modelDecisionSchema and voiceTools are unchanged, because the WhatsApp and
// phone-call paths use them and their SQL allow-lists do not know these tools.
// Every argument is required in the JSON schema the model sees (hosted strict
// modes need that; defaults count as required in zod's output schema), but a
// missing one parses to its default, so older tool calls stay valid.
export const catalogueArgs = z
  .object({
    item: z.string().max(200).default(""),
    code: z.string().max(80).default(""),
    fits: z.string().max(200).default(""),
  })
  .strict()
  .refine((x) => [x.item, x.code, x.fits].some((v) => v.trim()), {
    message: "Give an item, a code or a model",
  });
const [searchTool, availabilityTool, bookTool, , handoffTool] =
  toolCallSchema.options;
export const coreToolCallSchema = z.discriminatedUnion("name", [
  searchTool,
  z
    .object({ name: z.literal("lookup_catalogue"), args: catalogueArgs })
    .strict(),
  availabilityTool,
  bookTool,
  z
    .object({
      name: z.literal("take_message"),
      args: z
        .object({
          text: boundedText(4000),
          unanswered: z.boolean().default(false),
        })
        .strict(),
    })
    .strict(),
  handoffTool,
]);
export const coreDecisionSchema = z.discriminatedUnion("kind", [
  modelDecisionSchema.options[0],
  z.object({ kind: z.literal("tool"), call: coreToolCallSchema }).strict(),
]);
export type CoreToolCall = z.infer<typeof coreToolCallSchema>;
export type CoreDecision = z.infer<typeof coreDecisionSchema>;

export type KnowledgeFact = {
  id: string;
  pack_id: string | null;
  field_key: string | null;
  title: string;
  value: unknown;
  language: z.infer<typeof docLanguage>;
  status: "draft" | "confirmed";
  source: string;
  revision: number;
};
export type KnowledgeRule = {
  id: string;
  kind: z.infer<typeof ruleKind>;
  text: string;
  pack_id: string | null;
  pack_rule_id: string | null;
  enabled: boolean;
  status: "draft" | "confirmed";
  source: string;
  revision: number;
};
export type CatalogueRow = {
  id: string;
  pack_id: string | null;
  item: string;
  aliases: string[];
  price_sen: number | null;
  stock_note: string;
  attributes: Record<string, unknown>;
  language: string;
  status: "draft" | "confirmed";
  updated_at: string;
  revision: number;
};
export type KnowledgeCore = {
  revision: number;
  packs: string[];
  facts: KnowledgeFact[];
  rules: KnowledgeRule[];
  catalogue: { total: number; drafts: number; rows: CatalogueRow[] };
};
export type KnowledgeGap = {
  id: string;
  status: "open" | "resolved" | "ignored";
  resolution: "fact" | "rule" | "ignore" | null;
  ask_count: number;
  last_asked_at: string;
  revision: number;
  question: string;
  language: string;
  channel: "text" | "voice";
  answer: string;
};
export type CatalogueHit = {
  sourceId: string;
  item: string;
  aliases: string[];
  priceSen: number | null;
  price: string | null;
  stockNote: string;
  updatedAt: string;
  attributes: Record<string, unknown>;
  score: number;
  match: "code" | "trigram";
};
