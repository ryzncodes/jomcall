import type {
  Readiness,
  VoiceReadiness,
} from "../../contracts/src/agent-test.ts";
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

export type VoiceConfig = { url: string; apiKey: string; apiSecret: string };

const livekitNames = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
] as const;

// A voice test needs the hosted voice provider switch and all three LiveKit
// values. The reason names what is missing and never echoes a value.
export function voiceConfig(
  env: Env = process.env,
): { config: VoiceConfig; reason: null } | { config: null; reason: string } {
  const missing: string[] = [];
  if (env.JOMCALL_VOICE_PROVIDER !== "hosted")
    missing.push("JOMCALL_VOICE_PROVIDER=hosted");
  for (const name of livekitNames) if (!env[name]) missing.push(name);
  if (missing.length)
    return { config: null, reason: "Voice needs " + missing.join(", ") };
  return {
    config: {
      url: env.LIVEKIT_URL!,
      apiKey: env.LIVEKIT_API_KEY!,
      apiSecret: env.LIVEKIT_API_SECRET!,
    },
    reason: null,
  };
}

export function voiceReadiness(env: Env = process.env): VoiceReadiness {
  const { config, reason } = voiceConfig(env);
  return { configured: config !== null, reason };
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
