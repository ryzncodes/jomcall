import test from "node:test";
import assert from "node:assert/strict";
import { toolCallSchema } from "../../packages/contracts/src/agent-test.ts";
import { agentRules } from "../../packages/domain/src/agent-test/prompt.ts";
import { packModelInput } from "../../packages/inference/src/budget.ts";

// The response schema constrains decoding but is not shown to the model as
// text. A tool the rules do not name is a tool the model cannot choose.
test("agent rules name every callable tool and its arguments", () => {
  for (const option of toolCallSchema.options) {
    const name = option.shape.name.value;
    assert.ok(agentRules.includes(name), `rules omit tool ${name}`);
    for (const arg of Object.keys(option.shape.args.shape))
      assert.ok(
        agentRules.includes(`"${arg}"`),
        `rules omit ${name} argument ${arg}`,
      );
  }
  assert.match(agentRules, /"kind":"tool"/);
});

test("agent rules leave room for a full question inside the input budget", () => {
  const packed = packModelInput([
    { role: "system", content: agentRules + "x".repeat(300) },
    { role: "user", content: "x".repeat(500) },
  ]);
  assert.equal(packed.messages.length, 2);
});
