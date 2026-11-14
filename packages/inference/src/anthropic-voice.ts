import Anthropic from "@anthropic-ai/sdk";
import { toolCallSchema } from "../../contracts/src/agent-test.ts";
import { splitSentences } from "../../domain/src/agent-test/sentences.ts";
import { voiceTools } from "../../domain/src/agent-test/voice-prompt.ts";
import { coreVoiceTools } from "../../domain/src/knowledge/tools.ts";
import { coreToolCallSchema } from "../../contracts/src/knowledge.ts";

// Spoken-path model call. Calls Anthropic directly (key from ANTHROPIC_API_KEY)
// and streams plain speech so the voice can start on the first sentence. Every
// request sends the prompt and the caller's words to api.anthropic.com.

export const voiceModel = "claude-haiku-5-5";

export type VoiceModelEvent =
  | { type: "sentence"; text: string }
  // The model has started calling a tool; the validated `tool` follows once
  // the whole round is complete.
  | { type: "tool_start"; name: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | {
      type: "end";
      text: string;
      content: unknown[];
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
    };

function mapError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError)
    return Error("HOSTED_MODEL_REQUIRED");
  return Error("MODEL_UNAVAILABLE");
}

// One client per process: building one per call would repeat its setup on
// every spoken turn.
const toolNames = new Set(voiceTools.map((t) => t.name));
const coreToolNames = new Set(coreVoiceTools.map((t) => t.name));
let shared: Anthropic | undefined;
const sharedClient = () => (shared ??= new Anthropic());

export async function* streamVoiceModel(
  input: {
    stable: string;
    volatile: string;
    messages: unknown[];
    // "core": knowledge-core tools (browser tests). Omitted: shared tools.
    tools?: "core";
  },
  signal: AbortSignal,
  client: Pick<Anthropic, "messages"> = sharedClient(),
): AsyncIterable<VoiceModelEvent> {
  if (signal.aborted) return;
  const core = input.tools === "core";
  const names = core ? coreToolNames : toolNames;
  // The stable block carries the cache breakpoint; the volatile block (date and
  // time) follows it so a changing clock never invalidates the cached prefix.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: input.stable,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (input.volatile) system.push({ type: "text", text: input.volatile });
  let message: Anthropic.Message;
  let pending = "";
  try {
    // No `thinking` key: the adaptive default must stay on, because turning it
    // off leaks reasoning into the spoken text. No temperature either.
    const stream = client.messages.stream(
      {
        model: voiceModel,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system,
        tools: (core ? coreVoiceTools : voiceTools) as Anthropic.Tool[],
        messages: input.messages as Anthropic.MessageParam[],
      },
      { signal },
    );
    for await (const event of stream) {
      if (signal.aborted) return;
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        // Only a known tool name may be announced; anything else is left to
        // the validated path, which fails the turn.
        if (!names.has(event.content_block.name)) continue;
        // Text always comes before a tool call: speak what is pending first,
        // so the caller hears the lead-in before the tool is announced.
        const lead = pending.trim();
        pending = "";
        if (lead) yield { type: "sentence", text: lead };
        yield { type: "tool_start", name: event.content_block.name };
        continue;
      }
      if (
        event.type !== "content_block_delta" ||
        event.delta.type !== "text_delta"
      )
        continue;
      pending += event.delta.text;
      const { sentences, rest } = splitSentences(pending);
      pending = rest;
      for (const text of sentences) {
        yield { type: "sentence", text };
      }
    }
    message = await stream.finalMessage();
  } catch (error) {
    if (signal.aborted) return;
    throw mapError(error);
  }
  if (signal.aborted) return;
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens")
    throw Error("MODEL_OUTPUT_TRUNCATED");
  // A trailing "." is held back waiting for more text; the stream is over, so
  // speak whatever is left.
  const tail = pending.trim();
  if (tail) yield { type: "sentence", text: tail };
  for (const block of message.content) {
    if (block.type !== "tool_use") continue;
    const parsed = (core ? coreToolCallSchema : toolCallSchema).safeParse({
      name: block.name,
      args: block.input,
    });
    if (!parsed.success) throw Error("MODEL_OUTPUT_INVALID");
    yield {
      type: "tool",
      id: block.id,
      name: parsed.data.name,
      input: parsed.data.args,
    };
  }
  yield {
    type: "end",
    text: message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join(""),
    content: message.content,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
