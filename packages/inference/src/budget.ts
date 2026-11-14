import { z } from "zod";
import { modelDecisionSchema } from "../../contracts/src/agent-test.ts";
import { coreDecisionSchema } from "../../contracts/src/knowledge.ts";
import type { ModelInput } from "./index.ts";
export const decisionFormat = z.toJSONSchema(modelDecisionSchema);
export const coreDecisionFormat = z.toJSONSchema(coreDecisionSchema);
// Bytes of message text a model may receive. The small local model keeps its
// 6000-byte guard; a hosted model gets a realistic limit so long rules,
// facts and instructions do not break typed tests (controller's call D13).
export const LOCAL_INPUT_BUDGET = 6000;
export const HOSTED_INPUT_BUDGET = 48000;
export function inputBudget(identity: string | null | undefined): number {
  return identity?.startsWith("openrouter:")
    ? HOSTED_INPUT_BUDGET
    : LOCAL_INPUT_BUDGET;
}
export function packModelInput(
  required: ModelInput["messages"],
  optional: ModelInput["messages"] = [],
  budget = LOCAL_INPUT_BUDGET,
): ModelInput {
  const messages = [...required];
  // Message bytes only. The response schema steers decoding and is not part
  // of the text budget. At worst one token per byte, 6000 bytes stays inside
  // the local runtime's 7600-token prompt guard.
  const bytes = () => Buffer.byteLength(JSON.stringify({ messages }));
  if (bytes() > budget) throw Error("INPUT_BUDGET_EXCEEDED");
  for (const message of optional) {
    messages.push(message);
    if (bytes() > budget) messages.pop();
  }
  return { messages };
}

// Required policy/question and the latest tool exchange cannot be truncated.
// Earlier evidence is optional once a bounded tool result needs the space.
export function advanceModelInput(
  required: ModelInput["messages"],
  previous: ModelInput["messages"],
  latest: ModelInput["messages"],
  budget = LOCAL_INPUT_BUDGET,
): ModelInput {
  const packed = packModelInput([...required, ...latest], previous, budget);
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
  budget = LOCAL_INPUT_BUDGET,
): ModelInput {
  let pairs: ModelInput["messages"] = [];
  for (const turn of history.slice(-6).reverse()) {
    const pair: ModelInput["messages"] = [
      { role: "user", content: turn.input },
      { role: "assistant", content: turn.answer },
    ];
    try {
      packModelInput([...required, ...pair, ...pairs, ...latest], [], budget);
      pairs = [...pair, ...pairs];
    } catch {
      break;
    }
  }
  const prefix = [required[0], ...pairs, ...required.slice(1)];
  return advanceModelInput(prefix, optional, latest, budget);
}
