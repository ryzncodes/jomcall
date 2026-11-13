import { modelDecisionSchema } from "../../contracts/src/agent-test.ts";
import { decisionFormat } from "./budget.ts";
import type { ModelClient } from "./index.ts";

// EVALUATION ONLY. This client is not wired into the worker: sessions,
// readiness and the loopback guards still assume the local model. It sends
// prompt text to openrouter.ai, so use it with synthetic fixtures only.

const unsupported = new Set([
  "$schema",
  "pattern",
  "format",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
]);
// Hosted strict modes accept a smaller JSON Schema subset than the local
// runtime. Loosening here is safe: every reply is re-validated with the full
// contract schema below.
function portable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(portable);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !unsupported.has(key))
      .map(([key, value]) => [
        key === "oneOf" ? "anyOf" : key,
        portable(value),
      ]),
  );
}
// Strict modes also need an object at the root, not a union.
export const hostedDecisionFormat = {
  type: "object",
  properties: { decision: portable(decisionFormat) },
  required: ["decision"],
  additionalProperties: false,
};

export function createOpenRouterClient(
  config: { model: string; apiKey: string },
  send: typeof fetch = fetch,
): ModelClient {
  if (!/^[a-z0-9-]+\/[a-z0-9.:_-]+$/i.test(config.model) || !config.apiKey)
    throw Error("HOSTED_MODEL_REQUIRED");
  const client: ModelClient = {
    usage: undefined,
    async generate(input, signal) {
      signal.throwIfAborted();
      const response = await send(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + config.apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            messages: input.messages,
            // No temperature: several hosted models reject the parameter, and
            // require_parameters then leaves no provider to route to.
            max_tokens: 1024,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "decision",
                strict: true,
                schema: hostedDecisionFormat,
              },
            },
            // Never route to a provider that would silently ignore the schema.
            provider: { require_parameters: true },
          }),
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        },
      );
      if (!response.ok) {
        // Status and provider message only; never the request or the key.
        const detail = await response.text().catch(() => "");
        console.error(
          "HOSTED_MODEL_ERROR",
          response.status,
          detail.slice(0, 300),
        );
        throw Error("MODEL_UNAVAILABLE");
      }
      const output = await response.json();
      const choice = output.choices?.[0];
      if (choice?.finish_reason !== "stop")
        throw Error("MODEL_OUTPUT_TRUNCATED");
      client.usage = {
        promptTokens: output.usage?.prompt_tokens ?? 0,
        outputTokens: output.usage?.completion_tokens ?? 0,
      };
      try {
        return modelDecisionSchema.parse(
          JSON.parse(choice.message.content).decision,
        );
      } catch {
        throw Error("MODEL_OUTPUT_INVALID");
      }
    },
  };
  return client;
}
