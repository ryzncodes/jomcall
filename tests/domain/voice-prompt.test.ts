import test from "node:test";
import assert from "node:assert/strict";
import { toolCallSchema } from "../../packages/contracts/src/agent-test.ts";
import {
  voiceRules,
  voiceSystem,
  voiceTools,
} from "../../packages/domain/src/agent-test/voice-prompt.ts";

test("voice tools mirror the typed tool contract", () => {
  const expected = toolCallSchema.options.map((o) => o.shape.name.value);
  assert.deepEqual(
    voiceTools.map((t) => t.name),
    expected,
  );
  for (const option of toolCallSchema.options) {
    const tool = voiceTools.find((t) => t.name === option.shape.name.value)!;
    const schema = tool.input_schema as {
      properties: Record<string, unknown>;
      additionalProperties: unknown;
    };
    assert.deepEqual(
      Object.keys(schema.properties).sort(),
      Object.keys(option.shape.args.shape).sort(),
    );
    assert.equal(schema.additionalProperties, false);
    assert.ok(tool.description.length > 0);
    const text = JSON.stringify(schema);
    for (const key of [
      "$schema",
      "pattern",
      "format",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
    ])
      assert.ok(!text.includes(`"${key}"`), `${tool.name} keeps ${key}`);
  }
});

test("voice rules carry each anti-goal", () => {
  assert.match(voiceRules, /never.*(booked|confirmed)/i);
  assert.match(voiceRules, /one or two short sentences/i);
  assert.match(voiceRules, /read back/i);
  assert.match(voiceRules, /never say.*(tool|source)/i);
  assert.match(voiceRules, /language of the latest customer message/i);
  assert.match(voiceRules, /\+08:00/);
});

test("stable prompt does not change with the clock", () => {
  const args: Parameters<typeof voiceSystem> extends [...infer A, Date]
    ? A
    : never = [
    { name: "Klinik Sri" },
    [{ id: "r1", name: "Dr Aini", duration_minutes: 30 }],
    [{ sourceId: "s1", title: "Hours", excerpt: "Open 9 to 6" }],
  ];
  const a = voiceSystem(...args, new Date("2026-11-13T01:00:00Z"));
  const b = voiceSystem(...args, new Date("2026-11-14T09:30:00Z"));
  assert.equal(a.stable, b.stable);
  assert.notEqual(a.volatile, b.volatile);
  assert.ok(a.stable.includes(voiceRules));
  assert.ok(a.stable.includes("Klinik Sri"));
  assert.ok(a.stable.includes("Dr Aini"));
  assert.ok(a.stable.includes("s1"));
  assert.ok(!a.stable.includes("2026-11-13"));
  assert.match(a.volatile, /2026-11-13/);
});
