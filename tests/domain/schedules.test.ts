import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scheduleInput,
  knowledgeInput,
} from "../../packages/contracts/src/agent.ts";
test("hours reject overlap, reversed intervals and impossible dates", () => {
  const base = {
    expectedRevision: 0,
    timezone: "Asia/Kuala_Lumpur",
    weekdays: [[], [], [], [], [], [], []],
    closures: [],
  };
  assert.equal(scheduleInput.safeParse(base).success, true);
  for (const change of [
    { timezone: "Invalid/Zone" },
    { weekdays: [[{ start: "20:00", end: "09:00" }], [], [], [], [], [], []] },
    {
      weekdays: [
        [
          { start: "09:00", end: "12:00" },
          { start: "11:00", end: "13:00" },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    },
    { closures: [{ date: "2026-02-30", reason: "Invalid" }] },
  ])
    assert.equal(
      scheduleInput.safeParse({ ...base, ...change }).success,
      false,
    );
  assert.equal(
    scheduleInput.safeParse({
      ...base,
      weekdays: [[{ start: "20:00", end: "24:00" }], [], [], [], [], [], []],
    }).success,
    true,
  );
});
test("knowledge enforces byte size, safe text and upload extension", () => {
  const base = {
    expectedAgentRevision: 1,
    kind: "text-document",
    name: "Contoh",
    content: "你好",
    filename: "sample.txt",
  };
  assert.equal(knowledgeInput.safeParse(base).success, true);
  for (const change of [
    { content: "你".repeat(33334) },
    { content: "\0" },
    { content: "\ud800" },
    { filename: "file.pdf" },
  ])
    assert.equal(
      knowledgeInput.safeParse({ ...base, ...change }).success,
      false,
    );
});
