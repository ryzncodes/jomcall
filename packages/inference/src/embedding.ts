// Optional semantic search. Off by default: JOMCALL_EMBEDDING_PROVIDER unset,
// empty or "disabled" means no embedding call is ever made. "google" sends
// unit and question text to the Vertex embedding endpoint with the existing
// GOOGLE_CLOUD_API_KEY (controller's call D4/D7, owner to confirm). Not yet
// approved for production; search works without it.
type Env = Record<string, string | undefined>;
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 768;
export type EmbedTask = "query" | "document";
export interface Embedder {
  readonly model: string;
  embed(texts: string[], task: EmbedTask, signal?: AbortSignal): Promise<number[][]>;
}

export function embeddingProvider(env: Env = process.env): "disabled" | "google" {
  const value = env.JOMCALL_EMBEDDING_PROVIDER || "disabled";
  if (value !== "disabled" && value !== "google")
    throw Error("EMBEDDING_PROVIDER_INVALID");
  return value;
}

export const normalise = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

// Truncated gemini-embedding-001 vectors are not unit length: re-normalise.
export class GoogleEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL;
  constructor(
    private key: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async embed(texts: string[], task: EmbedTask, signal?: AbortSignal) {
    if (!texts.length) return [];
    const r = await this.fetcher(
      `https://aiplatform.googleapis.com/v1/publishers/google/models/${EMBEDDING_MODEL}:predict`,
      {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-goog-api-key": this.key },
        body: JSON.stringify({
          instances: texts.map((content) => ({
            content,
            task_type: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          })),
          parameters: { outputDimensionality: EMBEDDING_DIMS },
        }),
      },
    );
    // Status only: never the response body, which may echo text.
    if (!r.ok) throw Error("EMBEDDING_FAILED_" + r.status);
    const body = (await r.json()) as {
      predictions?: { embeddings?: { values?: number[] } }[];
    };
    const out = (body.predictions ?? []).map((p) => p.embeddings?.values ?? []);
    if (out.length !== texts.length || out.some((v) => v.length !== EMBEDDING_DIMS))
      throw Error("EMBEDDING_INVALID");
    return out.map(normalise);
  }
}

// Deterministic, offline. Texts sharing words get similar vectors.
export class FakeEmbedder implements Embedder {
  readonly model = "fake-embedding";
  calls = 0;
  async embed(texts: string[]) {
    this.calls++;
    return texts.map((t) => {
      const v = new Array(EMBEDDING_DIMS).fill(0);
      for (const w of t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        let h = 0;
        for (const c of w) h = (h * 31 + c.codePointAt(0)!) % EMBEDDING_DIMS;
        v[h] += 1;
      }
      v[0] += 0.01;
      return normalise(v);
    });
  }
}

export function createEmbedder(env: Env = process.env): Embedder | null {
  if (embeddingProvider(env) === "disabled") return null;
  const key = env.GOOGLE_CLOUD_API_KEY;
  if (!key) throw Error("EMBEDDING_KEY_MISSING");
  return new GoogleEmbedder(key);
}

export const vectorLiteral = (v: number[]) =>
  "[" + v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",") + "]";
