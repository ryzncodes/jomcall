// Knowledge-core tools for the browser test paths: search over units, the
// catalogue lookup and take_message with an "unanswered" flag. The shared
// executeTestTool and its schema are untouched for the other channels.
import { z } from "zod";
import { AppError } from "../../../contracts/src/index.ts";
import type { KnowledgeHit } from "../../../contracts/src/agent-test.ts";
import {
  coreToolCallSchema,
  type CatalogueHit,
  type CoreToolCall,
} from "../../../contracts/src/knowledge.ts";
import type { ToolAccess, ToolEffect, ToolResult } from "../agent-test/tools.ts";
import { buildKnowledgeIndex, searchKnowledge, type Snapshot } from "../agent-test/knowledge.ts";
import { agentRules } from "../agent-test/prompt.ts";
import { voiceRules } from "../agent-test/voice-prompt.ts";
import type { CoreSnapshot } from "./snapshot.ts";
import { factText, unitHash } from "./snapshot.ts";
import { formatSen, maskContact, questionKey } from "./text.ts";
import { vectorLiteral, type Embedder } from "../../../inference/src/embedding.ts";

export type CoreSnapshotFull = Snapshot & CoreSnapshot;
type CatalogueRow = {
  ordinal: number;
  item: string;
  aliases: string[];
  price_sen: number | null;
  stock_note: string;
  attributes: Record<string, unknown>;
  updated_at: string;
  match: "code" | "trigram";
  score: number;
};
type UnitRow = { hash: string; source: string; title: string; text: string; score: number };
// Implemented by the agent repository through app_private.agent_knowledge,
// bound to the running turn's lease.
export interface KnowledgeAccess {
  catalogue(args: { item: string; code: string; fits: string }): Promise<CatalogueRow[]>;
  units(args: { model: string; vector: string; hashes: string[] }): Promise<UnitRow[]>;
  gap(data: {
    key: string;
    question: string;
    language: string;
    channel: "text" | "voice";
    answer: string;
  }): Promise<unknown>;
}
export type CoreToolResult =
  | ToolResult
  | { kind: "catalogue"; found: boolean; items: CatalogueHit[]; next?: string };

const NOT_FOUND_NEXT =
  "Not in the catalogue. Do not suggest a price. Say you will ask staff, then call take_message with unanswered true.";
const NO_EVIDENCE_NEXT =
  "Nothing relevant found. Do not guess. Say you will ask staff, then call take_message with unanswered true.";

export const coreToolRules =
  " lookup_catalogue {\"item\",\"code\",\"fits\"} for prices, stock and items in the catalogue (use \"\" for an unknown argument; code is a part number or code the customer said, fits is a model or size); take_message {\"text\",\"unanswered\"}: unanswered is true when you are taking the message because the business's knowledge did not answer the question.";
// Typed rules: the shared text, the extended tool list and the not-found path.
export const coreAgentRules =
  agentRules.replace(
    ' take_message {"text"} when asked to leave a message;',
    ' take_message {"text","unanswered"} when asked to leave a message;',
  ) + coreToolRules;
export const coreVoiceRules =
  voiceRules +
  " Use lookup_catalogue for prices, stock and items in the catalogue; pass an empty string for an argument you do not know. When the knowledge does not answer, say you will ask staff and call take_message with unanswered true.";

const descriptions: Record<string, string> = {
  search_knowledge:
    "Look up business facts such as hours, prices, services and policies. Use before stating any fact that is not already in the business facts.",
  lookup_catalogue:
    "Look up items, prices and stock notes in the business's catalogue. item: the item as the caller said it; code: a part number or code; fits: a model, size or year. Use an empty string for unknown arguments.",
  check_availability:
    "List open appointment slots for one resource over 1 to 7 days from a date (YYYY-MM-DD). Use before stating availability.",
  book_slot:
    "Record a proposed booking after the caller has said yes to the service, day and time. startAt is an ISO time with the +08:00 offset. A person confirms it later.",
  take_message:
    "Record a message from the caller for staff. A person reads it later. Set unanswered to true when the knowledge did not answer the caller's question.",
  handoff_to_human: "Ask for a staff member to take over, with a short reason.",
};
const strip = new Set(["$schema", "pattern", "format", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]);
const clean = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(clean)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).filter(([k]) => !strip.has(k)).map(([k, v]) => [k, clean(v)]),
        )
      : value;
export const coreVoiceTools = coreToolCallSchema.options.map((option) => {
  const name = option.shape.name.value;
  return {
    name,
    description: descriptions[name],
    input_schema: clean(z.toJSONSchema(option.shape.args)) as object,
  };
});

// Units the keyword path searches: today's free-text chunks (same source ids,
// so old citations still resolve) plus one unit per fact.
export function buildUnitIndex(snapshot: CoreSnapshotFull): KnowledgeHit[] {
  const facts = (snapshot.facts ?? []).map((f) => {
    const text = Array.from(factText(f.value)).slice(0, 2000).join("");
    return {
      sourceId: "fact:" + unitHash(f.title, text).slice(0, 16),
      title: f.title,
      excerpt: text,
      score: 0,
    };
  });
  return [...buildKnowledgeIndex(snapshot), ...facts];
}
// Unit hashes for the embedding path (facts and free-text chunks).
export function unitHashes(snapshot: CoreSnapshotFull): Map<string, KnowledgeHit> {
  const out = new Map<string, KnowledgeHit>();
  for (const hit of buildUnitIndex(snapshot)) out.set(unitHash(hit.title, hit.excerpt), hit);
  return out;
}

export type SearchOptions = {
  embedder?: Embedder | null;
  // A vector already computed for this exact query (voice turns start it early).
  vector?: { query: string; value: Promise<number[] | null> };
  timeoutMs?: number;
};
async function queryVector(query: string, opts: SearchOptions): Promise<number[] | null> {
  if (!opts.embedder) return null;
  const pending =
    opts.vector && opts.vector.query === query
      ? opts.vector.value
      : opts.embedder
          .embed([query], "query", AbortSignal.timeout(opts.timeoutMs ?? 1000))
          .then((v) => v[0] ?? null);
  return Promise.race([
    pending.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), opts.timeoutMs ?? 1000).unref()),
  ]);
}

// Embeddings when switched on and on time, otherwise keyword (D12: no fusion).
export async function searchUnits(
  snapshot: CoreSnapshotFull,
  knowledge: KnowledgeAccess | undefined,
  query: string,
  opts: SearchOptions = {},
): Promise<KnowledgeHit[]> {
  const keyword = () => searchKnowledge(buildUnitIndex(snapshot), query);
  if (!opts.embedder || !knowledge) return keyword();
  try {
    const vector = await queryVector(query, opts);
    if (!vector) return keyword();
    const map = unitHashes(snapshot);
    const rows = await knowledge.units({
      model: opts.embedder.model,
      vector: vectorLiteral(vector),
      hashes: [...map.keys()],
    });
    if (!rows.length) return keyword();
    return rows.map((r) => {
      const hit = map.get(r.hash);
      return hit
        ? { ...hit, score: r.score }
        : { sourceId: "unit:" + r.hash.slice(0, 16), title: r.title, excerpt: r.text, score: r.score };
    });
  } catch {
    console.error("EMBEDDING_SEARCH_FAILED");
    return keyword();
  }
}

export function catalogueHit(row: CatalogueRow): CatalogueHit {
  return {
    sourceId: "cat:" + row.ordinal,
    item: row.item,
    aliases: row.aliases,
    priceSen: row.price_sen,
    price: formatSen(row.price_sen),
    stockNote: row.stock_note,
    updatedAt: row.updated_at,
    attributes: row.attributes,
    score: row.score,
    match: row.match,
  };
}
// As evidence for citations on the typed path.
export const catalogueEvidence = (h: CatalogueHit): KnowledgeHit => ({
  sourceId: h.sourceId,
  title: h.item,
  excerpt: [h.price && `price ${h.price}`, h.stockNote && `stock: ${h.stockNote}`, h.aliases.length && `also called ${h.aliases.join(", ")}`, JSON.stringify(h.attributes)]
    .filter(Boolean)
    .join("; "),
  score: h.score,
});

export async function executeCoreTool(
  access: ToolAccess,
  knowledge: KnowledgeAccess,
  step: number,
  input: unknown,
  opts: SearchOptions = {},
): Promise<CoreToolResult> {
  if (!Number.isInteger(step) || step < 0 || step >= 4) throw new AppError("TOOL_LIMIT", 422);
  const call: CoreToolCall = coreToolCallSchema.parse(input),
    context = await access.read();
  const resourceId = "resourceId" in call.args ? call.args.resourceId : null;
  if (
    resourceId &&
    !context.resources.some((r) => r.id === resourceId && r.location_id === context.locationId && r.active)
  )
    throw new AppError("NOT_FOUND", 404);
  let effect: ToolEffect | { kind: "catalogue"; found: boolean; items: CatalogueHit[]; next?: string };
  switch (call.name) {
    case "search_knowledge": {
      const items = await searchUnits(context.snapshot as CoreSnapshotFull, knowledge, call.args.query, opts);
      effect = { kind: "knowledge", items, ...(items.length ? {} : { next: NO_EVIDENCE_NEXT }) } as ToolEffect;
      break;
    }
    case "lookup_catalogue": {
      const items = (await knowledge.catalogue(call.args)).map(catalogueHit);
      effect = items.length
        ? { kind: "catalogue", found: true, items }
        : { kind: "catalogue", found: false, items: [], next: NOT_FOUND_NEXT };
      break;
    }
    case "check_availability":
      effect = { kind: "availability", items: await access.availability(call.args) };
      break;
    case "book_slot":
      effect = { kind: "proposal", proposal: { kind: "booking", details: call.args } };
      break;
    case "take_message":
      effect = { kind: "proposal", proposal: { kind: "message", details: { text: call.args.text } } };
      break;
    case "handoff_to_human":
      effect = { kind: "proposal", proposal: { kind: "handoff", details: call.args } };
      break;
  }
  // The recorded call keeps every argument; the SQL allow-list accepts
  // lookup_catalogue for browser tests only.
  return access.record(step, call as never, effect as ToolEffect) as Promise<CoreToolResult>;
}

// A gap: the agent took a message because knowledge did not answer, or a
// lookup in this turn found nothing and the turn ended with a message.
export function isGap(calls: { call: CoreToolCall; result?: CoreToolResult }[]): boolean {
  const message = calls.find((c) => c.call.name === "take_message");
  if (!message) return false;
  if (message.call.name === "take_message" && message.call.args.unanswered) return true;
  return calls.some(
    (c) =>
      (c.result?.kind === "catalogue" && !c.result.found) ||
      (c.result?.kind === "knowledge" && c.result.items.length === 0),
  );
}
export function gapRecord(question: string, language: string, channel: "text" | "voice", answer: string) {
  const masked = Array.from(maskContact(question)).slice(0, 600).join("");
  return {
    key: questionKey(masked),
    question: masked,
    language,
    channel,
    answer: Array.from(answer).slice(0, 1000).join(""),
  };
}
