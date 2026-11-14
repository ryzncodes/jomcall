// Embedding clients with an on-disk cache under results/ (ignored by git).
// Keys are read from the environment and never logged.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmbeddingModel } from "../models.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const RESULTS = join(here, "..", "results");
mkdirSync(join(RESULTS, "emb-cache"), { recursive: true });

export type Task = "query" | "document";
type Entry = { v: number[]; tokens: number; ms: number };
type Cache = Record<string, Entry>;

const caches = new Map<string, Cache>();
const file = (m: EmbeddingModel) => join(RESULTS, "emb-cache", `${m.key}.json`);
const load = (m: EmbeddingModel): Cache => {
  if (!caches.has(m.key)) caches.set(m.key, existsSync(file(m)) ? JSON.parse(readFileSync(file(m), "utf8")) : {});
  return caches.get(m.key)!;
};
const save = (m: EmbeddingModel) => writeFileSync(file(m), JSON.stringify(load(m)));
const keyOf = (task: Task, text: string) => createHash("sha256").update(task + "\n" + text).digest("hex").slice(0, 32);

async function post(url: string, headers: Record<string, string>, body: unknown) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    if (r.ok) return r.json() as Promise<any>;
    const text = (await r.text()).slice(0, 300);
    if ((r.status === 429 || r.status >= 500) && attempt < 6) {
      await new Promise((s) => setTimeout(s, 1500 * 2 ** attempt));
      continue;
    }
    throw new Error(`embedding request failed ${r.status}: ${text}`);
  }
}

async function callVertex(m: EmbeddingModel, task: Task, texts: string[]) {
  const j = await post(
    `https://aiplatform.googleapis.com/v1/publishers/google/models/${m.id}:predict`,
    { "x-goog-api-key": process.env.GOOGLE_CLOUD_API_KEY! },
    { instances: texts.map((content) => ({ content, task_type: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" })) },
  );
  return (j.predictions as any[]).map((p) => ({ v: p.embeddings.values as number[], tokens: p.embeddings.statistics?.token_count ?? 0 }));
}

async function callOpenRouter(m: EmbeddingModel, _task: Task, texts: string[]) {
  const j = await post("https://openrouter.ai/api/v1/embeddings", { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, { model: m.id, input: texts });
  if (!Array.isArray(j.data)) throw new Error(`unexpected embedding response: ${JSON.stringify(j).slice(0, 200)}`);
  const total = j.usage?.prompt_tokens ?? j.usage?.total_tokens ?? 0;
  const chars = texts.reduce((a, t) => a + t.length, 0) || 1;
  return (j.data as any[])
    .sort((a, b) => a.index - b.index)
    .map((d, i) => ({ v: d.embedding as number[], tokens: Math.round((total * texts[i]!.length) / chars) }));
}

const norm = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

/** Embed documents in batches with a small pool; cached. */
export async function embedDocuments(m: EmbeddingModel, texts: string[]): Promise<Entry[]> {
  const cache = load(m);
  const missing = [...new Set(texts.filter((t) => !cache[keyOf("document", t)]))];
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += m.batch) batches.push(missing.slice(i, i + m.batch));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++]!;
      const t0 = performance.now();
      const out = await (m.provider === "vertex" ? callVertex : callOpenRouter)(m, "document", b);
      const ms = performance.now() - t0;
      b.forEach((t, i) => (cache[keyOf("document", t)] = { v: norm(out[i]!.v), tokens: out[i]!.tokens, ms }));
    }
  };
  await Promise.all(Array.from({ length: m.provider === "vertex" ? 6 : 2 }, worker));
  if (missing.length) save(m);
  return texts.map((t) => cache[keyOf("document", t)]!);
}

/** Embed one query, alone, timed end to end (this is what a live turn would pay); cached. */
export async function embedQuery(m: EmbeddingModel, text: string): Promise<Entry> {
  const cache = load(m);
  const k = keyOf("query", text);
  if (!cache[k]) {
    const t0 = performance.now();
    const [out] = await (m.provider === "vertex" ? callVertex : callOpenRouter)(m, "query", [text]);
    cache[k] = { v: norm(out!.v), tokens: out!.tokens, ms: performance.now() - t0 };
    save(m);
  }
  return cache[k]!;
}

/** Matryoshka truncation: keep the first n dimensions and re-normalise. */
export const truncate = (v: number[], n: number) => norm(v.slice(0, n));
export const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};
