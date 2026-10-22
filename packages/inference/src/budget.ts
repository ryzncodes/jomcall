import { z } from "zod";
import { modelDecisionSchema } from "../../contracts/src/agent-test.ts";
import type { ModelInput } from "./index.ts";
export const decisionFormat = z.toJSONSchema(modelDecisionSchema);
export function packModelInput(
  required: ModelInput["messages"],
  optional: ModelInput["messages"] = [],
): ModelInput {
  const messages = [...required];
  const bytes = () =>
    Buffer.byteLength(JSON.stringify({ messages, format: decisionFormat }));
  if (bytes() > 6000) throw Error("INPUT_BUDGET_EXCEEDED");
  for (const message of optional) {
    messages.push(message);
    if (bytes() > 6000) messages.pop();
  }
  return { messages };
}

// Required policy/question and the latest tool exchange cannot be truncated.
// Earlier evidence is optional once a bounded tool result needs the space.
export function advanceModelInput(
  required: ModelInput["messages"],
  previous: ModelInput["messages"],
  latest: ModelInput["messages"],
): ModelInput {
  const packed = packModelInput([...required, ...latest], previous);
  return {
    messages: [
      ...required,
      ...packed.messages.slice(required.length + latest.length),
      ...latest,
    ],
  };
}

// History is optional context, never a source of authority. Keep complete recent
// exchanges in chronological order, before the current question. Latest tool
// results and required policy/question always have priority over history.
export function packConversationInput(
  required: ModelInput["messages"],
  optional: ModelInput["messages"],
  latest: ModelInput["messages"],
  history: { input: string; answer: string }[],
): ModelInput {
  let pairs: ModelInput["messages"] = [];
  for (const turn of history.slice(-6).reverse()) {
    const pair: ModelInput["messages"] = [
      { role: "user", content: turn.input },
      { role: "assistant", content: turn.answer },
    ];
    try {
      packModelInput([...required, ...pair, ...pairs, ...latest]);
      pairs = [...pair, ...pairs];
    } catch {
      break;
    }
  }
  const prefix = [required[0], ...pairs, ...required.slice(1)];
  return advanceModelInput(prefix, optional, latest);
}
