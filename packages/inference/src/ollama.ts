import { verifyProjectRuntime } from "./runtime.mjs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { modelDecisionSchema } from "../../contracts/src/agent-test.ts";
import type { Readiness } from "../../contracts/src/agent-test.ts";
import { decisionFormat, packModelInput } from "./budget.ts";
import type { ModelClient, ModelInput } from "./index.ts";
export type ModelConfig = {
  url: string;
  model: string;
  digest: string;
  version: string;
};
function localURL(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "http:" ||
    u.hostname !== "127.0.0.1" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    (u.port !== "11434" && process.env.NODE_ENV !== "test")
  )
    throw Error("LOCAL_MODEL_REQUIRED");
  return u.origin;
}
export async function boundedJSON(
  url: string,
  body: unknown,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal,
  });
  if (!response.ok) throw Error("MODEL_UNAVAILABLE");
  const reader = response.body?.getReader();
  if (!reader) throw Error("MODEL_OUTPUT_INVALID");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 256 * 1024) throw Error("MODEL_RESPONSE_TOO_LARGE");
      parts.push(r.value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
    );
  } catch {
    throw Error("MODEL_OUTPUT_INVALID");
  }
}
export async function verifyModel(
  config: ModelConfig,
  signal: AbortSignal,
  ownership = verifyProjectRuntime,
) {
  if (ownership !== verifyProjectRuntime && process.env.NODE_ENV !== "test")
    throw Error("TEST_ONLY");
  await ownership(Number(new URL(config.url).port));
  const base = localURL(config.url);
  const tags = await boundedJSON(base + "/api/tags", undefined, signal);
  if (
    !Array.isArray(tags.models) ||
    !tags.models.some(
      (m: { name: string; digest: string }) =>
        m.name === config.model && m.digest === config.digest,
    )
  )
    throw Error("MODEL_CHANGED");
  const version = await boundedJSON(base + "/api/version", undefined, signal);
  if (version.version !== config.version) throw Error("MODEL_RUNTIME_CHANGED");
  const info = await boundedJSON(
    base + "/api/show",
    { model: config.model },
    signal,
  );
  if (
    !info.capabilities?.includes("completion") ||
    !info.capabilities?.includes("thinking")
  )
    throw Error("MODEL_CAPABILITY_UNAVAILABLE");
}
export async function createOllamaClient(
  config: ModelConfig,
  ownership = verifyProjectRuntime,
): Promise<ModelClient> {
  if (ownership !== verifyProjectRuntime && process.env.NODE_ENV !== "test")
    throw Error("TEST_ONLY");
  const base = localURL(config.url);
  if (config.model !== "qwen3:4b" || !/^[a-f0-9]{64}$/.test(config.digest))
    throw Error("LOCAL_MODEL_REQUIRED");
  const client: ModelClient = {
    usage: undefined,
    async generate(input: ModelInput, signal: AbortSignal) {
      signal.throwIfAborted();
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      const packed = packModelInput(input.messages);
      await verifyModel(config, deadline, ownership);
      await ownership(Number(new URL(config.url).port));
      const output = await boundedJSON(
        base + "/api/chat",
        {
          model: config.model,
          messages: packed.messages,
          stream: false,
          think: false,
          format: decisionFormat,
          keep_alive: "30s",
          options: { num_ctx: 8192, num_predict: 512, temperature: 0 },
        },
        deadline,
      );
      if (
        output.done !== true ||
        output.done_reason !== "stop" ||
        !Number.isInteger(output.prompt_eval_count) ||
        output.prompt_eval_count > 7600 ||
        output.eval_count > 512
      )
        throw Error("MODEL_OUTPUT_TRUNCATED");
      client.usage = {
        promptTokens: output.prompt_eval_count,
        outputTokens: output.eval_count ?? 0,
      };
      try {
        return modelDecisionSchema.parse(JSON.parse(output.message.content));
      } catch {
        throw Error("MODEL_OUTPUT_INVALID");
      }
    },
  };
  return client;
}
export async function configuredModel(): Promise<ModelConfig | null> {
  if ((process.env.JOMCALL_MODEL_PROVIDER ?? "disabled") === "disabled")
    return null;
  if (process.env.JOMCALL_MODEL_PROVIDER !== "ollama")
    throw Error("LOCAL_MODEL_REQUIRED");
  const lock = z
    .object({
      runtimeVersion: z.string(),
      model: z.literal("qwen3:4b"),
      modelDigest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../../../infra/local/model-lock.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  return {
    url: "http://127.0.0.1:11434",
    model: lock.model,
    digest: lock.modelDigest,
    version: lock.runtimeVersion,
  };
}
export async function getModelReadiness(): Promise<Readiness> {
  try {
    const config = await configuredModel();
    if (!config)
      return {
        configured: false,
        available: false,
        modelDigest: null,
        reason: "MODEL_DISABLED",
      };
    await verifyModel(config, AbortSignal.timeout(2000));
    return {
      configured: true,
      available: true,
      modelDigest: config.digest,
      reason: null,
    };
  } catch (e) {
    const reason =
      e instanceof Error && /^(MODEL_|LOCAL_MODEL_)/.test(e.message)
        ? e.message
        : "MODEL_UNAVAILABLE";
    return { configured: true, available: false, modelDigest: null, reason };
  }
}
