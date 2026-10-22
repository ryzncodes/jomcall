import { z } from "zod";
import { uuid } from "./index.ts";
import { dateOnly, instant } from "./booking.ts";
export const boundedText = (bytes: number) =>
  z
    .string()
    .min(1)
    .max(bytes)
    .refine(
      (x) =>
        !x.includes("\0") &&
        new TextEncoder().encode(x).length <= bytes &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          x,
        ),
    );
export const testStart = z
  .object({
    agentId: uuid,
    locationId: uuid,
    contactId: uuid.optional(),
    source: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("draft"),
          expectedRevision: z.number().int().positive(),
        })
        .strict(),
      z.object({ kind: z.literal("published"), versionId: uuid }).strict(),
    ]),
  })
  .strict();
export const revisionInput = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const turnInput = z
  .object({
    text: boundedText(4000),
    expectedSessionRevision: z.number().int().positive(),
    clientTurnId: uuid,
  })
  .strict();
export const bookingArgs = z
  .object({ resourceId: uuid, startAt: instant, title: boundedText(120) })
  .strict();
export const toolCallSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("search_knowledge"),
      args: z.object({ query: boundedText(200) }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("check_availability"),
      args: z
        .object({
          resourceId: uuid,
          fromDate: dateOnly,
          days: z.number().int().min(1).max(7),
        })
        .strict(),
    })
    .strict(),
  z.object({ name: z.literal("book_slot"), args: bookingArgs }).strict(),
  z
    .object({
      name: z.literal("take_message"),
      args: z.object({ text: boundedText(4000) }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("handoff_to_human"),
      args: z.object({ reason: boundedText(500) }).strict(),
    })
    .strict(),
]);
export const modelDecisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("answer"),
      text: boundedText(4000),
      citations: z.array(z.string().max(100)).max(5),
    })
    .strict(),
  z.object({ kind: z.literal("tool"), call: toolCallSchema }).strict(),
]);
export const proposalApply = z
  .object({
    contactId: uuid,
    expectedProposalRevision: z.number().int().positive(),
  })
  .strict();
export type ModelDecision = z.infer<typeof modelDecisionSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type KnowledgeHit = {
  sourceId: string;
  title: string;
  excerpt: string;
  score: number;
};
export type TestSession = {
  id: string;
  location_id: string;
  org_id: string;
  revision: number;
  source: "draft" | "published";
  snapshot_hash: string;
  agent_version_id: string | null;
  contact_id: string | null;
  state: "open" | "closed";
  expires_at: string;
  model_digest: string | null;
};
export type TestTurn = {
  created_at: string;
  id: string;
  session_id: string;
  revision: number;
  attempt: number;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  input: string;
  answer: string | null;
  citations: string[];
  error_code: string | null;
};
export type Proposal = {
  id: string;
  session_id: string;
  turn_id: string;
  attempt: number;
  revision: number;
  applied_booking_id: string | null;
} & (
  | { kind: "booking"; details: z.infer<typeof bookingArgs> }
  | { kind: "message"; details: { text: string } }
  | { kind: "handoff"; details: { reason: string } }
);
export type SessionDetail = TestSession & {
  sources: KnowledgeHit[];
  turns: TestTurn[];
  proposals: Proposal[];
  steps: {
    id: string;
    turn_id: string;
    attempt: number;
    step: number;
    tool: string;
    result: unknown;
  }[];
};
export type Readiness = {
  configured: boolean;
  available: boolean;
  modelDigest: string | null;
  reason: string | null;
};
