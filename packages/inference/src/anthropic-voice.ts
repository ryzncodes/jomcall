import Anthropic from "@anthropic-ai/sdk";
import { toolCallSchema } from "../../contracts/src/agent-test.ts";
import { splitSentences } from "../../domain/src/agent-test/sentences.ts";
import { voiceTools } from "../../domain/src/agent-test/voice-prompt.ts";

// Spoken-path model call. Calls Anthropic directly (key from ANTHROPIC_API_KEY)
// and streams plain speech so the voice can start on the first sentence. Every
// request sends the prompt and the caller's words to api.anthropic.com.

export const voiceModel = "claude-haiku-5-5";

export type VoiceModelEvent =
  | { type: "sentence"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | {
      type: "end";
      text: string;
      content: unknown[];
      usage: { input: number; output: number; cacheRead: number };
    };

function mapError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError)
    return Error("HOSTED_MODEL_REQUIRED");
  return Error("MODEL_UNAVAILABLE");
}

export async function* streamVoiceModel(
  input: { stable: string; volatile: string; messages: unknown[] },
  signal: AbortSignal,
  client: Pick<Anthropic, "messages"> = new Anthropic(),
): AsyncIterable<VoiceModelEvent> {
  if (signal.aborted) return;
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
        tools: voiceTools as Anthropic.Tool[],
        messages: input.messages as Anthropic.MessageParam[],
      },
      { signal },
    );
    for await (const event of stream) {
      if (signal.aborted) return;
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
    const parsed = toolCallSchema.safeParse({
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
    },
  };
}
