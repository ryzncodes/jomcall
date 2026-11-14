import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  streamVoiceModel,
  voiceModel,
  type VoiceModelEvent,
} from "../../packages/inference/src/anthropic-voice.ts";
import { voiceTools } from "../../packages/domain/src/agent-test/voice-prompt.ts";

type Script = {
  deltas?: string[];
  raw?: unknown[];
  content?: unknown[];
  stop_reason?: string;
  fail?: unknown;
};
const input = {
  stable: "STABLE rules",
  volatile: "NOW 2026-11-13",
  messages: [{ role: "user", content: "buka pukul berapa?" }],
};
function fake(script: Script) {
  const seen: Record<string, any>[] = [];
  const client = {
    messages: {
      stream(body: Record<string, any>, options?: { signal?: AbortSignal }) {
        seen.push({ body, options });
        const events = (script.deltas ?? []).map((text) => ({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        }));
        return {
          async *[Symbol.asyncIterator]() {
            if (script.fail) throw script.fail;
            for (const event of events) yield event;
            for (const event of script.raw ?? []) yield event;
          },
          async finalMessage() {
            return {
              content: script.content ?? [
                { type: "text", text: (script.deltas ?? []).join("") },
              ],
              stop_reason: script.stop_reason ?? "end_turn",
              usage: {
                input_tokens: 40,
                output_tokens: 9,
                cache_read_input_tokens: 30,
                cache_creation_input_tokens: 4,
              },
            };
          },
        };
      },
    },
  };
  return { client: client as any, seen };
}
async function collect(
  script: Script,
  signal: AbortSignal = new AbortController().signal,
) {
  const { client, seen } = fake(script);
  const events: VoiceModelEvent[] = [];
  for await (const event of streamVoiceModel(input, signal, client))
    events.push(event);
  return { events, seen };
}
const uuid = "123e4567-e89b-42d3-a456-426614174000";

test("request pins model, effort and caching, and never sends thinking or temperature", async () => {
  const { seen } = await collect({ deltas: ["Hai."] });
  const body = seen[0].body;
  assert.equal(voiceModel, "claude-haiku-5-5");
  assert.equal(body.model, "claude-haiku-5-5");
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal("thinking" in body, false);
  assert.equal("temperature" in body, false);
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.system[0].text, "STABLE rules");
  assert.equal(body.system[0].cache_control.type, "ephemeral");
  assert.equal(body.system[1].text, "NOW 2026-11-13");
  assert.equal("cache_control" in body.system[1], false);
  assert.deepEqual(body.tools, voiceTools);
  assert.deepEqual(body.messages, input.messages);
  assert.doesNotMatch(JSON.stringify(body.tools), /maxItems|minItems/);
});

test("text deltas become sentences in order, then end", async () => {
  const { events } = await collect({
    deltas: ["Kami buka 9 ", "pagi. ", "Tutup 6 petang."],
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ["sentence", "sentence", "end"],
  );
  assert.deepEqual(
    events.slice(0, 2).map((e) => (e as any).text),
    ["Kami buka 9 pagi.", "Tutup 6 petang."],
  );
  const end = events[2] as Extract<VoiceModelEvent, { type: "end" }>;
  assert.equal(end.text, "Kami buka 9 pagi. Tutup 6 petang.");
  assert.deepEqual(end.usage, {
    input: 40,
    output: 9,
    cacheRead: 30,
    cacheWrite: 4,
  });
});

test("a tool_use block yields a validated tool event after flushed text", async () => {
  const { events } = await collect({
    deltas: ["Sekejap saya semak"],
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Sekejap saya semak" },
      {
        type: "tool_use",
        id: "toolu_1",
        name: "check_availability",
        input: { resourceId: uuid, fromDate: "2026-11-14", days: 2 },
      },
    ],
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ["sentence", "tool", "end"],
  );
  assert.deepEqual(events[1], {
    type: "tool",
    id: "toolu_1",
    name: "check_availability",
    input: { resourceId: uuid, fromDate: "2026-11-14", days: 2 },
  });
});

test("a tool_use block start announces the tool before the round completes", async () => {
  const { events } = await collect({
    deltas: ["Sekejap saya semak"],
    raw: [
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "take_message",
          input: {},
        },
      },
    ],
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Sekejap saya semak" },
      {
        type: "tool_use",
        id: "toolu_1",
        name: "take_message",
        input: { text: "Hi" },
      },
    ],
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ["sentence", "tool_start", "tool", "end"],
  );
  assert.deepEqual(events[0], { type: "sentence", text: "Sekejap saya semak" });
  assert.deepEqual(events[1], { type: "tool_start", name: "take_message" });
});

test("an unknown tool name is not announced early", async () => {
  const { events } = await collect({
    raw: [
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "t", name: "rm_rf", input: {} },
      },
    ],
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        id: "t",
        name: "take_message",
        input: { text: "Hi" },
      },
    ],
  });
  assert.ok(!events.some((e) => e.type === "tool_start"));
});

test("invalid tool input, truncation and refusal fail closed", async () => {
  await assert.rejects(
    collect({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t", name: "take_message", input: { x: 1 } },
      ],
    }),
    /MODEL_OUTPUT_INVALID/,
  );
  for (const stop_reason of ["refusal", "max_tokens"])
    await assert.rejects(
      collect({ deltas: ["Hai."], stop_reason }),
      /MODEL_OUTPUT_TRUNCATED/,
    );
});

test("SDK errors map to stable codes", async () => {
  const h = new Headers();
  await assert.rejects(
    collect({ fail: new Anthropic.RateLimitError(429, {}, "slow", h) }),
    /MODEL_UNAVAILABLE/,
  );
  await assert.rejects(
    collect({ fail: new Anthropic.APIConnectionError({ message: "down" }) }),
    /MODEL_UNAVAILABLE/,
  );
  await assert.rejects(
    collect({ fail: new Anthropic.AuthenticationError(401, {}, "no", h) }),
    /HOSTED_MODEL_REQUIRED/,
  );
});

test("an aborted signal stops without an end event", async () => {
  const controller = new AbortController();
  controller.abort();
  const { events } = await collect(
    { deltas: ["Hai semua. "] },
    controller.signal,
  );
  assert.equal(
    events.some((e) => e.type === "end"),
    false,
  );
});

test(
  "live check is opt-in",
  { skip: !process.env.JOMCALL_LIVE_ANTHROPIC },
  async () => {
    const events: VoiceModelEvent[] = [];
    for await (const e of streamVoiceModel(
      {
        stable: "Reply in one short sentence.",
        volatile: "",
        messages: [{ role: "user", content: "Hai" }],
      },
      AbortSignal.timeout(20000),
    ))
      events.push(e);
    assert.equal(events.at(-1)?.type, "end");
  },
);
