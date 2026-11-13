import test from "node:test";
import assert from "node:assert/strict";
import {
  createOpenRouterClient,
  hostedDecisionFormat,
} from "../../packages/inference/src/openrouter.ts";

const reply = (decision: unknown, finish = "stop") =>
  new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finish,
          message: { content: JSON.stringify({ decision }) },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }),
  );
const input = { messages: [{ role: "user" as const, content: "hello" }] };
const signal = () => new AbortController().signal;

test("hosted client sends a strict portable schema and returns a validated decision", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const client = createOpenRouterClient(
    { model: "vendor/model-1", apiKey: "test-key" },
    async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return reply({
        kind: "tool",
        call: { name: "take_message", args: { text: "late" } },
      });
    },
  );
  const decision = await client.generate(input, signal());
  assert.deepEqual(decision, {
    kind: "tool",
    call: { name: "take_message", args: { text: "late" } },
  });
  assert.deepEqual(client.usage, { promptTokens: 11, outputTokens: 7 });
  assert.equal(seen[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(
    (seen[0].init.headers as Record<string, string>).authorization,
    "Bearer test-key",
  );
  const body = JSON.parse(String(seen[0].init.body));
  assert.equal(body.model, "vendor/model-1");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.provider, { require_parameters: true });
  assert.deepEqual(body.messages, input.messages);
  assert.equal("temperature" in body, false);
  const schema = JSON.stringify(hostedDecisionFormat);
  assert.equal(hostedDecisionFormat.type, "object");
  assert.doesNotMatch(schema, /"(oneOf|pattern|format|maxLength|\$schema)"/);
  assert.match(schema, /handoff_to_human/);
});

test("hosted client fails closed on invalid, truncated or refused output", async () => {
  const make = (r: () => Response) =>
    createOpenRouterClient({ model: "vendor/model-1", apiKey: "k" }, async () =>
      r(),
    );
  await assert.rejects(
    make(() =>
      reply({ kind: "tool", call: { name: "delete_all", args: {} } }),
    ).generate(input, signal()),
    /MODEL_OUTPUT_INVALID/,
  );
  await assert.rejects(
    make(() =>
      reply({ kind: "answer", text: "x", citations: [] }, "length"),
    ).generate(input, signal()),
    /MODEL_OUTPUT_TRUNCATED/,
  );
  const error = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      make(() => new Response("no", { status: 401 })).generate(input, signal()),
      /MODEL_UNAVAILABLE/,
    );
  } finally {
    console.error = error;
  }
  assert.throws(
    () => createOpenRouterClient({ model: "vendor/model-1", apiKey: "" }),
    /HOSTED_MODEL_REQUIRED/,
  );
});
