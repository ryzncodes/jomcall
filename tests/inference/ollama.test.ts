import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createOllamaClient } from "../../packages/inference/src/ollama.ts";
import { packModelInput } from "../../packages/inference/src/budget.ts";
test("local inference validates transport, digest, bounded input/output and structured decisions", async () => {
  process.env.NODE_ENV = "test";
  let reply: unknown = {
    message: {
      content: JSON.stringify({ kind: "answer", text: "Hello", citations: [] }),
    },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 100,
  };
  let digest = "a".repeat(64);
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags")
      res.end(JSON.stringify({ models: [{ name: "qwen3:4b", digest }] }));
    else if (req.url === "/api/version")
      res.end(JSON.stringify({ version: "fixture" }));
    else if (req.url === "/api/show")
      res.end(JSON.stringify({ capabilities: ["completion", "thinking"] }));
    else if (reply === "redirect") {
      res.writeHead(302, { location: "https://example.invalid" });
      res.end();
    } else if (reply instanceof Uint8Array) res.end(reply);
    else res.end(JSON.stringify(reply));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const config = {
      url,
      model: "qwen3:4b",
      digest,
      version: "fixture",
    };
    const unowned = await createOllamaClient(config);
    await assert.rejects(
      unowned.generate(
        { messages: [{ role: "user", content: "Private question" }] },
        new AbortController().signal,
      ),
      /MODEL_PROCESS_UNOWNED/,
    );
    assert.equal(requests, 0, "unowned runtime must receive no requests");
    const client = await createOllamaClient(config, async () => {});
    const input = { messages: [{ role: "user" as const, content: "Hello" }] };
    assert.equal(
      (await client.generate(input, new AbortController().signal)).kind,
      "answer",
    );
    reply = {
      message: {
        content: JSON.stringify({
          kind: "tool",
          call: { name: "book_slot", args: { orgId: "forged" } },
        }),
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 100,
    };
    await assert.rejects(
      client.generate(input, new AbortController().signal),
      /MODEL_OUTPUT_INVALID/,
    );
    reply = "redirect";
    await assert.rejects(client.generate(input, new AbortController().signal));
    reply = new Uint8Array([0xff, 0xfe]);
    await assert.rejects(client.generate(input, new AbortController().signal));
    reply = { message: { content: "x".repeat(270000) } };
    await assert.rejects(
      client.generate(input, new AbortController().signal),
      /MODEL_RESPONSE_TOO_LARGE/,
    );
    reply = {
      message: { content: "{}" },
      done: false,
      done_reason: "length",
      prompt_eval_count: 100,
    };
    await assert.rejects(
      client.generate(input, new AbortController().signal),
      /MODEL_OUTPUT_TRUNCATED/,
    );
    digest = "b".repeat(64);
    await assert.rejects(
      client.generate(input, new AbortController().signal),
      /MODEL_CHANGED/,
    );
    const before = requests;
    await assert.rejects(
      createOllamaClient({
        url: "https://example.invalid",
        model: "qwen3:4b",
        digest,
        version: "fixture",
      }),
      /LOCAL_MODEL_REQUIRED/,
    );
    assert.equal(requests, before);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(client.generate(input, abort.signal));
    assert.throws(
      () => packModelInput([{ role: "user", content: "x".repeat(7000) }]),
      /INPUT_BUDGET_EXCEEDED/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
