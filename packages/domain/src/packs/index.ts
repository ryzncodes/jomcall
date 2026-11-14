// Pattern packs: product data, validated at load. A pack is defined by what a
// call is for, not by an industry. Design:
// docs/superpowers/specs/2026-11-14-knowledge-core-design.md
import { z } from "zod";
import appointment from "./appointment.json" with { type: "json" };
import caseIntake from "./case-intake.json" with { type: "json" };
import enrolmentLead from "./enrolment-lead.json" with { type: "json" };
import everyBusiness from "./every-business.json" with { type: "json" };
import order from "./order.json" with { type: "json" };
import quoteVisit from "./quote-visit.json" with { type: "json" };
import reservationRental from "./reservation-rental.json" with { type: "json" };
import statusCheck from "./status-check.json" with { type: "json" };
import stockPrice from "./stock-price.json" with { type: "json" };

const bilingual = z
  .object({ en: z.string().min(1).max(600), ms: z.string().min(1).max(600) })
  .strict();
export const factTypes = [
  "text",
  "list",
  "enum",
  "boolean",
  "number",
  "money_sen",
  "duration_minutes",
  "date",
  "hours",
  "phone_e164",
  "url",
] as const;
const field = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/),
    label: bilingual,
    type: z.enum(factTypes),
    required: z.boolean(),
    example: z.unknown(),
  })
  .strict();
export const ruleKinds = [
  "never",
  "unknown",
  "message",
  "handoff",
  "after_hours",
  "always",
] as const;
export const toolNames = [
  "search_knowledge",
  "lookup_catalogue",
  "check_availability",
  "book_slot",
  "take_message",
  "handoff_to_human",
] as const;
const evalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,80}$/),
    language: z.enum(["ms", "en", "manglish", "zh"]),
    kind: z.enum([
      "faq",
      "missing",
      "rule",
      "booking",
      "message",
      "handoff",
      "gap",
      "availability",
      "unauthorized",
    ]),
    question: z.string().min(1).max(600),
    sourceOrdinal: z.number().int().nonnegative().optional(),
    contains: z.string().optional(),
    rule: z.string().optional(),
    notContains: z.string().optional(),
    hour: z.number().int().min(0).max(23).optional(),
    expectTool: z.string().optional(),
    gapTool: z.string().optional(),
  })
  .strict();
export const packSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    name: bilingual,
    callPurpose: bilingual,
    businessTypes: z.array(z.string()).max(40),
    pairsWith: z.array(z.string()).max(10),
    facts: z.array(field).max(40),
    catalogue: z
      .object({
        needed: z.boolean(),
        reason: z.string(),
        columns: z.array(field).max(20),
        sampleRows: z.array(z.record(z.string(), z.unknown())).max(10),
      })
      .strict(),
    interview: z
      .array(
        z
          .object({
            order: z.number().int().positive(),
            en: z.string(),
            ms: z.string(),
            fills: z.array(z.string()).min(1),
          })
          .strict(),
      )
      .max(30),
    rules: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/),
            kind: z.enum(ruleKinds),
            text: bilingual,
          })
          .strict(),
      )
      .max(30),
    messageDetails: z.array(z.string()).max(20),
    tools: z
      .object({
        uses: z.array(z.enum(toolNames)),
        gaps: z.array(
          z
            .object({
              name: z.string(),
              purpose: z.string(),
              dataNeeded: z.string(),
              untilBuilt: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    evaluation: z
      .object({
        knowledge: z.array(
          z
            .object({
              kind: z.literal("faq"),
              name: z.string().min(1).max(200),
              content: z.string().min(1).max(4000),
            })
            .strict(),
        ),
        resources: z.array(z.string()),
        cases: z.array(evalCase).length(12),
      })
      .strict(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const unique = (xs: string[], what: string) => {
      if (new Set(xs).size !== xs.length)
        ctx.addIssue({ code: "custom", message: `duplicate ${what}` });
    };
    unique(
      pack.facts.map((f) => f.key),
      "fact key",
    );
    unique(
      pack.rules.map((r) => r.id),
      "rule id",
    );
    unique(
      pack.catalogue.columns.map((c) => c.key),
      "catalogue column",
    );
    if (pack.catalogue.needed && !pack.catalogue.columns.length)
      ctx.addIssue({ code: "custom", message: "catalogue needs columns" });
    for (const q of pack.interview)
      for (const target of q.fills) {
        const [kind, key] = target.split(".");
        const ok =
          target === "catalogue" ||
          (kind === "facts" && pack.facts.some((f) => f.key === key)) ||
          kind === "rules";
        if (!ok)
          ctx.addIssue({ code: "custom", message: `bad fill target ${target}` });
      }
    for (const c of pack.evaluation.cases)
      if (
        c.kind === "faq" &&
        (c.sourceOrdinal === undefined ||
          !pack.evaluation.knowledge[c.sourceOrdinal])
      )
        ctx.addIssue({ code: "custom", message: `bad source in ${c.id}` });
  });
export type Pack = z.infer<typeof packSchema>;
export type PackField = Pack["facts"][number];
export type RuleKind = (typeof ruleKinds)[number];

const raw = [
  everyBusiness,
  appointment,
  stockPrice,
  quoteVisit,
  order,
  reservationRental,
  enrolmentLead,
  caseIntake,
  statusCheck,
];
export const packs: readonly Pack[] = Object.freeze(
  raw.map((p) => packSchema.parse(p)),
);
export const packIds = packs.map((p) => p.id);
export function packById(id: string): Pack | undefined {
  return packs.find((p) => p.id === id);
}
// `every-business` is always active; the owner picks the rest.
export const basePack = "every-business";
export function activePacks(ids: readonly string[] | undefined): Pack[] {
  const wanted = new Set([basePack, ...(ids ?? [])]);
  return packs.filter((p) => wanted.has(p.id));
}

// What the editor needs: no evaluation data, no interview.
export type PackSummary = Pick<
  Pack,
  "id" | "name" | "callPurpose" | "facts" | "rules" | "pairsWith"
> & { catalogue: Pick<Pack["catalogue"], "needed" | "columns"> };
export function packSummaries(): PackSummary[] {
  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    callPurpose: p.callPurpose,
    facts: p.facts,
    rules: p.rules,
    pairsWith: p.pairsWith,
    catalogue: { needed: p.catalogue.needed, columns: p.catalogue.columns },
  }));
}

// Each pack's evaluation cases in the shape of tests/fixtures/agent-evaluation.json,
// so the existing gates can run them later. Rule cases may name a rule from
// every-business. Nothing here calls a model.
export function packEvaluationFixture(pack: Pack) {
  return {
    pack: pack.id,
    knowledge: pack.evaluation.knowledge,
    resources: pack.evaluation.resources,
    cases: pack.evaluation.cases.map((c) => ({ ...c, id: c.id })),
  };
}
