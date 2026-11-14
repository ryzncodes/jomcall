// Part 2: send each fake document to each Claude model with each prompt design.
// Raw outputs go to results/extraction/<model>.<prompt>.<doc>.json (ignored by git).
// No refusal fallback is configured on purpose: a second model answering would spoil the measurement.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { CLAUDE_MODELS, type ClaudeModel } from "../models.ts";
import { DOCS, type Doc } from "./truth.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "results", "extraction");
mkdirSync(OUT, { recursive: true });
const client = new Anthropic();

// ── Prompt designs ──────────────────────────────────────────────────────────
const COMMON = `You are loading a Malaysian small business's own material into its phone-agent knowledge base. The material may be a photo, a PDF, a spreadsheet dump or text pasted from a chat, in Malay, English, Manglish or Chinese.

Produce:
- rows: every priced item or service. One row per price: if an item has several sizes, types or quantity tiers, write one row for each, with the size/type/tier in "variant". Keep item and variant wording as written in the source; do not translate. price_sen is the price in Malaysian sen as an integer (RM12.50 -> 1250). unit is what the price is per (kg, pc, pax, jam ...) when the source says so, else null. notes holds anything else attached to that row (part number, minimum order, stock remark).
- facts: opening hours, address, contact numbers, and policies or rules (deposit, delivery, warranty, cancellation, what the business does not do). One fact per entry, in the source's own wording, kind = hours | address | contact | policy | other.

Ignore anything that is not this business's information (forwarded adverts, unrelated chatter). If a later line corrects an earlier one, use the corrected value.`;

const PROMPTS = {
  plain: `${COMMON}

If a price cannot be read or is not given, set price_sen to null and add a short line to "unreadable" naming the item. Do not guess.`,
  checked: `${COMMON}

A wrong price told to a caller is the worst outcome, so mark your certainty on every row:
- confidence: high | medium | low for the row as a whole.
- needs_owner_check: true when the owner should look at this row before it goes live: the price is covered, smudged, cut off, blurred, handwritten over, approximate ("lebih kurang", "from", "dari"), given as "call"/"TBA", conflicts with another line, or you had to infer which column or line a price belongs to.
- check_reason: one short sentence when needs_owner_check is true, else null.
Never fill in a value you cannot actually see: set price_sen to null and needs_owner_check to true. If you can read it only partly, give your best reading and set needs_owner_check to true. Facts get the same needs_owner_check mark.`,
} as const;
export type PromptKey = keyof typeof PROMPTS;

const str = { type: "string" };
const nstr = { type: ["string", "null"] };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const SCHEMAS = {
  plain: obj({
    rows: { type: "array", items: obj({ item: str, variant: nstr, price_sen: { type: ["integer", "null"] }, unit: nstr, notes: nstr }) },
    facts: { type: "array", items: obj({ kind: { type: "string", enum: ["hours", "address", "contact", "policy", "other"] }, text: str }) },
    unreadable: { type: "array", items: str },
  }),
  checked: obj({
    rows: {
      type: "array",
      items: obj({ item: str, variant: nstr, price_sen: { type: ["integer", "null"] }, unit: nstr, notes: nstr, confidence: { type: "string", enum: ["high", "medium", "low"] }, needs_owner_check: { type: "boolean" }, check_reason: nstr }),
    },
    facts: { type: "array", items: obj({ kind: { type: "string", enum: ["hours", "address", "contact", "policy", "other"] }, text: str, needs_owner_check: { type: "boolean" } }) },
  }),
};

// ── Document -> message content ─────────────────────────────────────────────
/** What the product would do with a spreadsheet: read cells locally and hand the model a cell grid. */
export async function xlsxToText(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    out.push(`## Sheet "${ws.name}"`);
    const merges = Object.keys((ws as any)._merges ?? {}).map((k) => (ws as any)._merges[k].shortRange ?? (ws as any)._merges[k].range ?? k);
    if (merges.length) out.push(`Merged ranges: ${merges.join(", ")}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        cells.push(`${cell.address}=${JSON.stringify(cell.value)}`);
      });
      if (cells.length) out.push(cells.join(" | "));
    });
  }
  return out.join("\n");
}

async function content(doc: Doc): Promise<Anthropic.ContentBlockParam[]> {
  const path = join(here, "docs", doc.file);
  if (doc.kind === "image") return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(path).toString("base64") } }, { type: "text", text: "Extract this photo." }];
  if (doc.kind === "pdf") return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: readFileSync(path).toString("base64") } }, { type: "text", text: "Extract this PDF." }];
  if (doc.kind === "xlsx") return [{ type: "text", text: `Extract this spreadsheet. Cells are given as address=value, one spreadsheet row per line.\n\n${await xlsxToText(path)}` }];
  return [{ type: "text", text: `Extract this pasted chat text.\n\n<pasted>\n${readFileSync(path, "utf8")}\n</pasted>` }];
}

async function one(model: ClaudeModel, prompt: PromptKey, doc: Doc) {
  const file = join(OUT, `${model.key}.${prompt}.${doc.id}.json`);
  if (existsSync(file)) return;
  const t0 = performance.now();
  let record: Record<string, unknown>;
  try {
    const r = await client.messages.create({
      model: model.id,
      max_tokens: 16000,
      system: PROMPTS[prompt],
      messages: [{ role: "user", content: await content(doc) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMAS[prompt] } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const text = r.content.find((b) => b.type === "text");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text && text.type === "text" ? text.text : "");
    } catch {}
    record = {
      model: model.id,
      prompt,
      doc: doc.id,
      ms: Math.round(performance.now() - t0),
      stop_reason: r.stop_reason,
      usage: { input: r.usage.input_tokens, output: r.usage.output_tokens },
      usd: (r.usage.input_tokens * model.inUsdPerMTok + r.usage.output_tokens * model.outUsdPerMTok) / 1e6,
      output: parsed,
    };
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    record = { model: model.id, prompt, doc: doc.id, ms: Math.round(performance.now() - t0), error: `${status ?? ""} ${(e as Error).message}`.slice(0, 400) };
    if (status === 429 || (status ?? 0) >= 500) {
      console.error(`${model.key} ${prompt} ${doc.id}: ${record.error} (not saved, rerun to retry)`);
      return;
    }
  }
  writeFileSync(file, JSON.stringify(record, null, 2));
  console.error(`${model.key} ${prompt} ${doc.id}: ${record.ms} ms ${record.error ?? ""}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const onlyModels = process.env.SPIKE_MODELS?.split(",");
  const onlyDocs = process.env.SPIKE_DOCS?.split(",");
  const jobs: (() => Promise<void>)[] = [];
  for (const model of CLAUDE_MODELS.filter((m) => !onlyModels || onlyModels.includes(m.key)))
    for (const prompt of Object.keys(PROMPTS) as PromptKey[]) for (const doc of DOCS.filter((d) => !onlyDocs || onlyDocs.includes(d.id))) jobs.push(() => one(model, prompt, doc));
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) await jobs[next++]!();
    }),
  );
}
