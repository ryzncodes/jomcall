// Part 1: compare search methods on the fake test set. Writes results/search.json and results/search.md.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
// Read-only reuse of the product's current keyword search.
import { buildKnowledgeIndex, searchKnowledge } from "../../../packages/domain/src/agent-test/knowledge.ts";
import { EMBEDDING_MODELS, TOOL_ARGS_MODEL, type EmbeddingModel } from "../models.ts";
import { buildCatalogue, rowText, type Row } from "./catalogue.ts";
import { dot, embedDocuments, embedQuery, RESULTS, truncate } from "./embed.ts";
import { CATALOGUE_DOC, CATALOGUE_HEADER, SEGMENTS, type Biz } from "./knowledge.ts";
import { QUESTIONS, type Question } from "./questions.ts";

const BIZ: Biz[] = ["salon", "aircon", "tuition", "auto"];
const catalogue = buildCatalogue();
const rowById = new Map(catalogue.map((r) => [r.id, r]));

// ── Units ───────────────────────────────────────────────────────────────────
type Unit = { id: string; biz: Biz; title: string; text: string; covers: Set<string>; row?: Row };
type Hit = { unit: Unit; score: number };

/** Fine units: one per fact / rule / catalogue row. */
const fine: Unit[] = [
  ...SEGMENTS.map((s) => ({ id: s.id, biz: s.biz, title: s.doc, text: s.text, covers: new Set([s.id]) })),
  ...catalogue.map((r) => ({ id: r.id, biz: "auto" as Biz, title: CATALOGUE_DOC, text: rowText(r), covers: new Set([r.id]), row: r })),
];

/** Coarse units: the product's current 1200-character chunks over whole documents. */
const coarse: Unit[] = [];
const currentIndex = new Map<Biz, ReturnType<typeof buildKnowledgeIndex>>();
for (const biz of BIZ) {
  const docs = new Map<string, { id: string; text: string }[]>();
  for (const s of SEGMENTS.filter((s) => s.biz === biz)) docs.set(s.doc, [...(docs.get(s.doc) ?? []), { id: s.id, text: s.text }]);
  if (biz === "auto") docs.set(CATALOGUE_DOC, [{ id: "_header", text: CATALOGUE_HEADER }, ...catalogue.map((r) => ({ id: r.id, text: rowText(r) }))]);
  const built = [...docs].map(([name, parts]) => {
    let at = 0;
    const spans = parts.map((p) => {
      const len = Array.from(p.text).length;
      const span = { id: p.id, from: at, to: at + len };
      at += len + 1; // "\n"
      return span;
    });
    return { name, content: parts.map((p) => p.text).join("\n"), spans };
  });
  const index = buildKnowledgeIndex({ knowledge: built.map((d) => ({ kind: "text", name: d.name, content: d.content })) });
  currentIndex.set(biz, index);
  for (const hit of index) {
    const [, d, c] = hit.sourceId.split(":").map(Number);
    const from = c! * 1080;
    const to = from + 1200;
    // A chunk "holds" a fact when it contains at least 60% of that fact's characters.
    const covers = new Set(
      built[d!]!.spans.filter((s) => (Math.min(to, s.to) - Math.max(from, s.from)) / (s.to - s.from) >= 0.6).map((s) => s.id),
    );
    coarse.push({ id: hit.sourceId, biz, title: hit.title, text: hit.excerpt, covers });
  }
}
const coarseById = new Map(coarse.map((u) => [u.id, u]));
const embedText = (u: Unit) => `${u.title}\n${u.text}`;

// ── Keyword methods ─────────────────────────────────────────────────────────
const tokenize = (text: string) => {
  const v = text.normalize("NFKC").toLowerCase();
  const words = v.match(/[\p{L}\p{N}]+/gu) ?? [];
  const han = (v.match(/\p{Script=Han}+/gu) ?? []).flatMap((run) => {
    const c = Array.from(run);
    return c.slice(0, -1).map((x, i) => x + c[i + 1]);
  });
  return [...words, ...han];
};

function bm25(units: Unit[]) {
  const docs = units.map((u) => tokenize(u.title + " " + u.text));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length;
  return (query: string): Hit[] => {
    const q = [...new Set(tokenize(query))];
    return units
      .map((unit, i) => {
        const d = docs[i]!;
        let score = 0;
        for (const t of q) {
          const tf = d.filter((x) => x === t).length;
          if (!tf) continue;
          const idf = Math.log(1 + (units.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
          score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * d.length) / avg));
        }
        return { unit, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);
  };
}

// ── Trigram lookup on structured catalogue columns (what pg_trgm would give) ──
const grams = (s: string) => {
  const out = new Set<string>();
  for (const w of s.toLowerCase().match(/[\p{L}\p{N}.]+/gu) ?? []) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
};
const jaccard = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
};
const normPn = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Part-number candidates in a spoken or typed query: single tokens and runs of 2-4 neighbours glued together. */
function pnCandidates(query: string) {
  const toks = query.match(/[A-Za-z0-9]+/g) ?? [];
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++)
    for (let n = 1; n <= 4 && i + n <= toks.length; n++) {
      const c = normPn(toks.slice(i, i + n).join(""));
      if (c.length >= 6 && /\d{3}/.test(c)) out.add(c);
    }
  return [...out];
}
const rowPnGrams = new Map(catalogue.map((r) => [r.id, grams(normPn(r.partNo))]));
const rowTextGrams = new Map(catalogue.map((r) => [r.id, grams(`${r.item} ${r.fitment} ${r.brand}`)]));
const pnScore = (query: string, r: Row) => Math.max(0, ...pnCandidates(query).map((c) => jaccard(grams(c), rowPnGrams.get(r.id)!)));
const textScore = (query: string, r: Row) => {
  const q = grams(query);
  const d = rowTextGrams.get(r.id)!;
  let n = 0;
  for (const x of q) if (d.has(x)) n++;
  return n / (q.size || 1);
};
const PN_MATCH = 0.5;
const catalogueUnits = fine.filter((u) => u.row);
function trigramLookup(pnQuery: string, textQuery: string): Hit[] {
  const byPn = catalogueUnits.map((unit) => ({ unit, score: pnScore(pnQuery, unit.row!) })).filter((h) => h.score >= PN_MATCH);
  if (byPn.length) return byPn.map((h) => ({ ...h, score: 1 + h.score })).sort((a, b) => b.score - a.score);
  return catalogueUnits
    .map((unit) => ({ unit, score: textScore(textQuery, unit.row!) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ── Embedding methods ───────────────────────────────────────────────────────
type Vecs = Map<string, number[]>;
async function unitVectors(m: EmbeddingModel, units: Unit[], dims?: number): Promise<{ vecs: Vecs; tokens: number }> {
  const out = await embedDocuments(m, units.map(embedText));
  return {
    vecs: new Map(units.map((u, i) => [u.id, dims ? truncate(out[i]!.v, dims) : out[i]!.v])),
    tokens: out.reduce((a, e) => a + e.tokens, 0),
  };
}
const cosineRank = (units: Unit[], vecs: Vecs, q: number[]): Hit[] =>
  units.map((unit) => ({ unit, score: dot(vecs.get(unit.id)!, q) })).sort((a, b) => b.score - a.score);

/** Reciprocal-rank fusion; the reported score is the embedding cosine so it can be thresholded. */
function rrf(primary: Hit[], other: Hit[], depth = 30): Hit[] {
  const s = new Map<string, { unit: Unit; rrf: number; cos: number }>();
  primary.slice(0, depth).forEach((h, i) => s.set(h.unit.id, { unit: h.unit, rrf: 1 / (60 + i), cos: h.score }));
  other.slice(0, depth).forEach((h, i) => {
    const e = s.get(h.unit.id) ?? { unit: h.unit, rrf: 0, cos: primary.find((p) => p.unit.id === h.unit.id)?.score ?? 0 };
    e.rrf += 1 / (60 + i);
    s.set(h.unit.id, e);
  });
  return [...s.values()].sort((a, b) => b.rrf - a.rrf).map((e) => ({ unit: e.unit, score: e.cos }));
}

// ── Tool-argument variant: the agent model writes structured lookup arguments ──
type ToolArgs = { part_number: string | null; car_model: string | null; item: string | null; ms: number; inTok: number; outTok: number };
const toolArgsCache = new Map<number, ToolArgs>();
async function toolArgs(q: Question): Promise<ToolArgs> {
  if (toolArgsCache.has(q.id)) return toolArgsCache.get(q.id)!;
  const client = new Anthropic();
  const t0 = performance.now();
  const r = await client.messages.create({
    model: TOOL_ARGS_MODEL.id,
    max_tokens: 2000,
    system:
      "You are a phone agent for a Malaysian car spare-parts shop. Turn the caller's sentence (possibly garbled by speech-to-text, in Malay, English, Manglish or Mandarin) into arguments for the tool search_catalogue. " +
      "The catalogue columns are: part number (e.g. 12345-BZ678, PW123456), item (written by the owner in workshop English/Malay such as 'Brake pad depan', 'Brake shoe blkg', 'Water pump', 'Absorber depan (1pc)', 'Minyak enjin fully syn 5W-30 4L', 'Bateri NS60 MF'), car (e.g. 'Myvi 1.3/1.5 2018+ (G3)', 'Saga BLM/FLX 1.3', 'Vios NCP93 2007-2013'). " +
      "Fix obvious mis-hearings of car and part names. Use null when the caller did not give that argument. Write `item` in the owner's style: English part name, 'depan' for front, 'blkg' for rear.",
    messages: [{ role: "user", content: q.text }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            part_number: { type: ["string", "null"] },
            car_model: { type: ["string", "null"] },
            item: { type: ["string", "null"] },
          },
          required: ["part_number", "car_model", "item"],
          additionalProperties: false,
        },
      },
    },
  });
  const text = r.content.find((b) => b.type === "text");
  const parsed = JSON.parse(text && text.type === "text" ? text.text : "{}");
  const out = { ...parsed, ms: performance.now() - t0, inTok: r.usage.input_tokens, outTok: r.usage.output_tokens } as ToolArgs;
  toolArgsCache.set(q.id, out);
  return out;
}

// ── Evaluation ──────────────────────────────────────────────────────────────
type Run = { q: Question; top: { id: string; score: number; correct: boolean }[]; ms: number };
type Method = { name: string; scope: "all" | "catalogue"; note: string; runs: Run[]; costQueryUsdPer1k?: number; costIndexUsdPer1k?: number; dims?: number; remoteMs?: number[] };

const isCorrect = (q: Question, u: Unit) => q.gold.some((g) => u.covers.has(g));
async function evaluate(name: string, scope: Method["scope"], note: string, search: (q: Question) => Promise<{ hits: Hit[]; remoteMs?: number }>): Promise<Method> {
  const runs: Run[] = [];
  const remoteMs: number[] = [];
  for (const q of QUESTIONS.filter((q) => scope === "all" || q.catalogue)) {
    const t0 = performance.now();
    const { hits, remoteMs: r = 0 } = await search(q);
    const local = performance.now() - t0;
    remoteMs.push(r);
    // `ms` = local compute for this call + the remote call time recorded when the vector was first fetched.
    runs.push({ q, ms: local + r, top: hits.slice(0, 5).map((h) => ({ id: h.unit.id, score: h.score, correct: isCorrect(q, h.unit) })) });
  }
  return { name, scope, note, runs, remoteMs };
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0;
};
const hitAt = (r: Run, k: number) => r.top.slice(0, k).some((t) => t.correct);

function summary(m: Method) {
  const ans = m.runs.filter((r) => r.q.gold.length);
  const absent = m.runs.filter((r) => !r.q.gold.length);
  const rightTop = ans.filter((r) => r.top[0]?.correct).map((r) => r.top[0]!.score);
  // Confidence threshold: keeps 90% of the correct top-1 answers.
  const threshold = quantile(rightTop, 0.1);
  const confident = (r: Run) => r.top.length > 0 && r.top[0]!.score >= threshold;
  const cell = (rs: Run[]) => `${pct(rs.filter((r) => hitAt(r, 1)).length, rs.length)} / ${pct(rs.filter((r) => hitAt(r, 3)).length, rs.length)} / ${pct(rs.filter((r) => hitAt(r, 5)).length, rs.length)}`;
  const group = (key: (r: Run) => string) => {
    const out: Record<string, string> = {};
    for (const k of [...new Set(ans.map(key))]) out[k] = `${cell(ans.filter((r) => key(r) === k))} (n=${ans.filter((r) => key(r) === k).length})`;
    return out;
  };
  return {
    name: m.name,
    scope: m.scope,
    note: m.note,
    n: ans.length,
    top1: pct(ans.filter((r) => hitAt(r, 1)).length, ans.length),
    top3: pct(ans.filter((r) => hitAt(r, 3)).length, ans.length),
    top5: pct(ans.filter((r) => hitAt(r, 5)).length, ans.length),
    byLang: group((r) => r.q.lang),
    byKind: group((r) => r.q.kind),
    byBiz: group((r) => r.q.biz),
    absentN: absent.length,
    absentAnyHit: `${absent.filter((r) => r.top.length).length}/${absent.length}`,
    absentConfident: `${absent.filter(confident).length}/${absent.length}`,
    answerableConfidentWrong: `${ans.filter((r) => confident(r) && !r.top[0]!.correct).length}/${ans.length}`,
    threshold: Number(threshold.toFixed(3)),
    p50ms: Number(quantile(m.runs.map((r) => r.ms), 0.5).toFixed(1)),
    p90ms: Number(quantile(m.runs.map((r) => r.ms), 0.9).toFixed(1)),
    costQueryUsdPer1k: m.costQueryUsdPer1k,
    costIndexUsdPer1k: m.costIndexUsdPer1k,
    dims: m.dims,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
const only = process.env.SPIKE_MODELS?.split(",");
const models = EMBEDDING_MODELS.filter((m) => !only || only.includes(m.key));
const methods: Method[] = [];
const unitsOf = (set: Unit[], biz: Biz) => set.filter((u) => u.biz === biz);

methods.push(
  await evaluate("keyword-current / 1200-char chunks", "all", "today's product code, unchanged", async (q) => ({
    hits: searchKnowledge(currentIndex.get(q.biz)!, q.text).map((h) => ({ unit: coarseById.get(h.sourceId)!, score: h.score })),
  })),
);
const fineAsIndex = new Map(BIZ.map((b) => [b, unitsOf(fine, b).map((u) => ({ sourceId: u.id, title: u.title, excerpt: u.text, score: 0 }))]));
const fineById = new Map(fine.map((u) => [u.id, u]));
methods.push(
  await evaluate("keyword-current / one unit per fact or row", "all", "same scoring, smaller units", async (q) => ({
    hits: searchKnowledge(fineAsIndex.get(q.biz)!, q.text).map((h) => ({ unit: fineById.get(h.sourceId)!, score: h.score })),
  })),
);
const bm25ByBiz = new Map(BIZ.map((b) => [b, bm25(unitsOf(fine, b))]));
methods.push(await evaluate("BM25 / per fact or row", "all", "ranked keyword search (what Postgres full-text would approximate)", async (q) => ({ hits: bm25ByBiz.get(q.biz)!(q.text) })));

const queryTokens: Record<string, number> = {};
for (const m of models) {
  console.error(`embedding with ${m.id} …`);
  const variants: { label: string; dims?: number }[] = m.key === "gemini-001" ? [{ label: "3072" }, { label: "768", dims: 768 }] : [{ label: String(m.dims) }];
  const coarseVecs = await unitVectors(m, coarse);
  const qv = new Map<number, { v: number[]; ms: number; tokens: number }>();
  for (const q of QUESTIONS) qv.set(q.id, await embedQuery(m, q.text));
  queryTokens[m.key] = [...qv.values()].reduce((a, e) => a + e.tokens, 0);
  const costQ = ((queryTokens[m.key]! / QUESTIONS.length) * 1000 * m.usdPerMTok) / 1e6;
  for (const variant of variants) {
    const d = variant.dims;
    const fineVecs = await unitVectors(m, fine, d);
    const qvec = (q: Question) => (d ? truncate(qv.get(q.id)!.v, d) : qv.get(q.id)!.v);
    const costFine = ((fineVecs.tokens / fine.length) * 1000 * m.usdPerMTok) / 1e6;
    const tag = `${m.key}@${variant.label}`;
    if (!d) {
      const mm = await evaluate(`embed ${tag} / 1200-char chunks`, "all", "embedding only, today's chunking", async (q) => ({ hits: cosineRank(unitsOf(coarse, q.biz), coarseVecs.vecs, qv.get(q.id)!.v), remoteMs: qv.get(q.id)!.ms }));
      mm.costQueryUsdPer1k = costQ;
      mm.costIndexUsdPer1k = ((coarseVecs.tokens / coarse.length) * 1000 * m.usdPerMTok) / 1e6;
      mm.dims = m.dims;
      methods.push(mm);
    }
    const e = await evaluate(`embed ${tag} / per fact or row`, "all", "embedding only", async (q) => ({ hits: cosineRank(unitsOf(fine, q.biz), fineVecs.vecs, qvec(q)), remoteMs: qv.get(q.id)!.ms }));
    const h = await evaluate(`hybrid BM25 + ${tag} / per fact or row`, "all", "reciprocal-rank fusion", async (q) => ({
      hits: rrf(cosineRank(unitsOf(fine, q.biz), fineVecs.vecs, qvec(q)), bm25ByBiz.get(q.biz)!(q.text)),
      remoteMs: qv.get(q.id)!.ms,
    }));
    const ce = await evaluate(`catalogue: embed ${tag} over rows`, "catalogue", "rows only", async (q) => ({ hits: cosineRank(catalogueUnits, fineVecs.vecs, qvec(q)), remoteMs: qv.get(q.id)!.ms }));
    const cr = await evaluate(`catalogue: part-no trigram first, else trigram + ${tag}`, "catalogue", "router: exact/fuzzy part number wins; otherwise fuse trigram text with embedding", async (q) => {
      const byPn = catalogueUnits.map((unit) => ({ unit, score: pnScore(q.text, unit.row!) })).filter((x) => x.score >= PN_MATCH).sort((a, b) => b.score - a.score);
      if (byPn.length) return { hits: byPn.map((x) => ({ ...x, score: 1 })) };
      return { hits: rrf(cosineRank(catalogueUnits, fineVecs.vecs, qvec(q)), trigramLookup("", q.text)), remoteMs: qv.get(q.id)!.ms };
    });
    for (const x of [e, h, ce, cr]) {
      x.costQueryUsdPer1k = costQ;
      x.costIndexUsdPer1k = costFine;
      x.dims = d ?? m.dims;
      methods.push(x);
    }
  }
}

methods.push(await evaluate("catalogue: trigram on columns (raw caller text)", "catalogue", "pg_trgm-style, no model", async (q) => ({ hits: trigramLookup(q.text, q.text) })));
if (process.env.ANTHROPIC_API_KEY && !process.env.SPIKE_NO_LLM) {
  console.error(`tool arguments with ${TOOL_ARGS_MODEL.id} …`);
  const usage = { inTok: 0, outTok: 0, ms: [] as number[] };
  const m = await evaluate(`catalogue: trigram on columns, arguments written by ${TOOL_ARGS_MODEL.id}`, "catalogue", "the agent model already writes tool arguments in its turn; its time is not search time", async (q) => {
    const a = await toolArgs(q);
    usage.inTok += a.inTok;
    usage.outTok += a.outTok;
    usage.ms.push(a.ms);
    return { hits: trigramLookup(a.part_number ?? "", [a.car_model, a.item].filter(Boolean).join(" ") || q.text) };
  });
  m.note += `; model call p50 ${Math.round(quantile(usage.ms, 0.5))} ms, ${usage.inTok} in / ${usage.outTok} out tokens for ${m.runs.length} questions`;
  // Subtract nothing: ms here is local lookup only (the model call sits outside evaluate's remoteMs).
  m.runs.forEach((r, i) => (r.ms = Math.max(0.01, r.ms - usage.ms[i]!)));
  methods.push(m);
  writeFileSync(join(RESULTS, "tool-args.json"), JSON.stringify([...toolArgsCache].map(([id, a]) => ({ id, q: QUESTIONS[id - 1]!.text, ...a })), null, 2));
}

const summaries = methods.map(summary);
const stats = {
  questions: QUESTIONS.length,
  answerable: QUESTIONS.filter((q) => q.gold.length).length,
  byLang: Object.fromEntries(["bm", "en", "manglish", "zh"].map((l) => [l, QUESTIONS.filter((q) => q.lang === l).length])),
  byKind: Object.fromEntries([...new Set(QUESTIONS.map((q) => q.kind))].map((k) => [k, QUESTIONS.filter((q) => q.kind === k).length])),
  fineUnits: Object.fromEntries(BIZ.map((b) => [b, unitsOf(fine, b).length])),
  coarseChunks: Object.fromEntries(BIZ.map((b) => [b, unitsOf(coarse, b).length])),
  queryTokens,
};
writeFileSync(join(RESULTS, "search.json"), JSON.stringify({ stats, summaries, runs: methods.map((m) => ({ name: m.name, runs: m.runs.map((r) => ({ id: r.q.id, lang: r.q.lang, kind: r.q.kind, text: r.q.text, gold: r.q.gold, top: r.top, ms: r.ms })) })) }, null, 1));

// Markdown report
const langs = ["bm", "en", "manglish", "zh"];
const kinds = ["direct", "paraphrase", "cross", "stt", "model", "partno"];
const usd = (x?: number) => (x === undefined ? "0" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);
const md: string[] = [];
md.push(`Test set: ${JSON.stringify(stats)}\n`);
for (const scope of ["all", "catalogue"] as const) {
  const ss = summaries.filter((s) => s.scope === scope);
  md.push(`### ${scope === "all" ? "All questions (per-business index)" : "Catalogue questions only (300 rows)"}\n`);
  md.push(`| Method | n | Top 1 | Top 3 | Top 5 | Absent: confident hit | Absent: any hit | Answerable: confident but wrong | p50 ms | p90 ms | $ / 1k queries | $ / 1k units indexed |`);
  md.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of ss) md.push(`| ${s.name} | ${s.n} | ${s.top1} | ${s.top3} | ${s.top5} | ${s.absentConfident} | ${s.absentAnyHit} | ${s.answerableConfidentWrong} | ${s.p50ms} | ${s.p90ms} | ${usd(s.costQueryUsdPer1k)} | ${usd(s.costIndexUsdPer1k)} |`);
  md.push(`\nTop 1 / top 3 / top 5 by language:\n`);
  md.push(`| Method | ${langs.join(" | ")} |`);
  md.push(`|---|${langs.map(() => "---").join("|")}|`);
  for (const s of ss) md.push(`| ${s.name} | ${langs.map((l) => s.byLang[l] ?? "–").join(" | ")} |`);
  md.push(`\nTop 1 / top 3 / top 5 by question kind:\n`);
  md.push(`| Method | ${kinds.join(" | ")} |`);
  md.push(`|---|${kinds.map(() => "---").join("|")}|`);
  for (const s of ss) md.push(`| ${s.name} | ${kinds.map((k) => s.byKind[k] ?? "–").join(" | ")} |`);
  md.push("");
}
writeFileSync(join(RESULTS, "search.md"), md.join("\n"));
console.log(md.join("\n"));
