import type { Readiness } from "../../contracts/src/agent-test.ts";
import type { ModelClient } from "./index.ts";
import {
  configuredModel,
  createOllamaClient,
  getModelReadiness,
  type ModelConfig,
} from "./ollama.ts";
import { createOpenRouterClient } from "./openrouter.ts";

// The only place the default hosted model is named. ID taken from
// OpenRouter's model list on 2026-11-13; it passed the 48-case gate.
export const defaultHostedModel = "anthropic/claude-haiku-5.5";

type Env = Record<string, string | undefined>;
export type ProviderConfig =
  | { provider: "ollama"; identity: string; local: ModelConfig }
  | { provider: "openrouter"; identity: string; model: string };

// identity is what a test session pins on its first turn. A local model pins
// its weight digest; a hosted model pins provider and model ID.
export async function configuredProvider(
  env: Env = process.env,
): Promise<ProviderConfig | null> {
  const provider = env.JOMCALL_MODEL_PROVIDER ?? "disabled";
  if (provider === "disabled") return null;
  if (provider === "ollama") {
    const local = await configuredModel();
    if (!local) throw Error("LOCAL_MODEL_REQUIRED");
    return { provider, identity: local.digest, local };
  }
  if (provider !== "openrouter") throw Error("MODEL_PROVIDER_UNKNOWN");
  const model = env.JOMCALL_HOSTED_MODEL || defaultHostedModel;
  if (!/^[a-z0-9-]+\/[a-z0-9.:_-]+$/i.test(model))
    throw Error("HOSTED_MODEL_REQUIRED");
  return { provider, model, identity: "openrouter:" + model };
}

// The web process answers readiness and must not hold the hosted key, so
// hosted readiness reports configuration only. A worker without the key
// fails the turn closed instead.
export async function getReadiness(env: Env = process.env): Promise<Readiness> {
  if (env.JOMCALL_MODEL_PROVIDER !== "openrouter") {
    if ((env.JOMCALL_MODEL_PROVIDER ?? "disabled") === "disabled")
      return {
        configured: false,
        available: false,
        modelDigest: null,
        reason: "MODEL_DISABLED",
      };
    return getModelReadiness();
  }
  try {
    const config = await configuredProvider(env);
    return {
      configured: true,
      available: true,
      modelDigest: config!.identity,
      reason: null,
    };
  } catch {
    return {
      configured: true,
      available: false,
      modelDigest: null,
      reason: "HOSTED_MODEL_REQUIRED",
    };
  }
}

export async function createModelClient(
  config: ProviderConfig,
  env: Env = process.env,
): Promise<ModelClient> {
  if (config.provider === "ollama") return createOllamaClient(config.local);
  return createOpenRouterClient({
    model: config.model,
    apiKey: env.OPENROUTER_API_KEY ?? "",
  });
}
