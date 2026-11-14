// Every model id and list price used by this spike lives here.
// Sources (read 2026-11-14):
//  - Claude ids and prices: Anthropic model table (claude-api skill, cached 2026-11-03).
//  - OpenRouter embedding ids and prices: GET https://openrouter.ai/api/v1/embeddings/models
//  - gemini-embedding-001 price: Gemini API pricing page ($0.15 / 1M input tokens); the same
//    figure is what OpenRouter lists. The Vertex pricing table could not be fetched, so the
//    text-multilingual-embedding-002 price below is NOT verified.
export type EmbeddingModel = {
  key: string;
  provider: "vertex" | "openrouter";
  id: string;
  dims: number;
  usdPerMTok: number;
  priceVerified: boolean;
  batch: number; // texts per request
};

export const EMBEDDING_MODELS: EmbeddingModel[] = [
  { key: "gemini-001", provider: "vertex", id: "gemini-embedding-001", dims: 3072, usdPerMTok: 0.15, priceVerified: true, batch: 1 },
  { key: "multilingual-002", provider: "vertex", id: "text-multilingual-embedding-002", dims: 768, usdPerMTok: 0.1, priceVerified: false, batch: 20 },
  { key: "bge-m3", provider: "openrouter", id: "baai/bge-m3", dims: 1024, usdPerMTok: 0.01, priceVerified: true, batch: 32 },
  { key: "gemini-2", provider: "openrouter", id: "google/gemini-embedding-2", dims: 3072, usdPerMTok: 0.2, priceVerified: true, batch: 32 },
];

export type ClaudeModel = { key: string; id: string; inUsdPerMTok: number; outUsdPerMTok: number };
export const CLAUDE_MODELS: ClaudeModel[] = [
  { key: "opus", id: "claude-opus-5-5", inUsdPerMTok: 4, outUsdPerMTok: 20 },
  { key: "sonnet", id: "claude-sonnet-5-5", inUsdPerMTok: 2, outUsdPerMTok: 10 },
  { key: "haiku", id: "claude-haiku-5-5", inUsdPerMTok: 0.1, outUsdPerMTok: 0.5 },
];
/** Model that writes search-tool arguments in the catalogue test (the product's agent model). */
export const TOOL_ARGS_MODEL = CLAUDE_MODELS[2]!;
