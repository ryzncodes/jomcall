import type { ModelDecision } from "../../contracts/src/agent-test.ts";
export type ModelInput = {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
};
export interface ModelClient {
  usage?: { promptTokens: number; outputTokens: number };
  generate(input: ModelInput, signal: AbortSignal): Promise<ModelDecision>;
}
export {
  createOllamaClient,
  getModelReadiness,
  configuredModel,
} from "./ollama.ts";
