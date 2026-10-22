import test from "node:test";
import assert from "node:assert/strict";
import {
  packModelInput,
  advanceModelInput,
} from "../../packages/inference/src/budget.ts";
test("tool exchanges retain required instructions and latest result while dropping optional context to fit", () => {
  const required = [
    { role: "system" as const, content: "rules".repeat(120) },
    { role: "user" as const, content: "question" },
  ];
  const previous = packModelInput(required, [
    { role: "user", content: "evidence".repeat(220) },
  ]).messages;
  const latest = [
    { role: "assistant" as const, content: "tool call" },
    { role: "user" as const, content: "tool result".repeat(130) },
  ];
  const packed = advanceModelInput(
    required,
    previous.slice(required.length),
    latest,
  );
  assert.deepEqual(packed.messages.slice(0, required.length), required);
  assert.deepEqual(packed.messages.slice(-latest.length), latest);
  assert.doesNotThrow(() => packModelInput(packed.messages));
  const small = advanceModelInput(
    required,
    [{ role: "user", content: "old evidence" }],
    latest,
  );
  assert.deepEqual(small.messages.slice(-latest.length), latest);
});

test("conversation packing keeps recent complete pairs before current input and drops oversized history", async () => {
  const { packConversationInput } = await import(
    "../../packages/inference/src/budget.ts"
  );
  const required = [
    { role: "system" as const, content: "Rules" },
    { role: "user" as const, content: "Now" },
  ];
  const history = [
    { input: "x".repeat(7000), answer: "old" },
    { input: "Before", answer: "Prior answer" },
  ];
  const result = packConversationInput(required, [], [], history);
  assert.deepEqual(
    result.messages.map((m) => m.content),
    ["Rules", "Before", "Prior answer", "Now"],
  );
  const withTool = packConversationInput(
    required,
    [],
    [{ role: "user", content: "tool ".repeat(400) }],
    history,
  );
  assert.equal(withTool.messages.at(-1)?.content, "tool ".repeat(400));
  assert.ok(JSON.stringify(withTool).length < 6000);
});
