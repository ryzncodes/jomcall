import type { ModelDecision } from "../../contracts/src/agent-test.ts";
import type { CoreDecision } from "../../contracts/src/knowledge.ts";
export type ModelInput = {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  // "core": the knowledge-core tool set (browser tests). Omitted: the shared
  // tool set, exactly as before.
  decision?: "core";
};
export interface ModelClient {
  usage?: { promptTokens: number; outputTokens: number };
  generate(
    input: ModelInput,
    signal: AbortSignal,
  ): Promise<ModelDecision | CoreDecision>;
}
export {
  createOllamaClient,
  getModelReadiness,
  configuredModel,
} from "./ollama.ts";
export {
  configuredProvider,
  createModelClient,
  getReadiness,
  defaultHostedModel,
} from "./provider.ts";
export {
  streamVoiceModel,
  voiceModel,
  type VoiceModelEvent,
} from "./anthropic-voice.ts";
