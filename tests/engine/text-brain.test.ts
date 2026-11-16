import { test } from "node:test";
import assert from "node:assert/strict";
import { runTextBrain } from "../../engine/src/agent/brain.ts";
import type { ModelClient, ModelInput } from "../../packages/inference/src/index.ts";
import type { ToolAccess } from "../../packages/domain/src/agent-test/tools.ts";
import { agentRules } from "../../packages/domain/src/agent-test/prompt.ts";
import { coreAgentRules, TRUNCATED_RETRY } from "../../packages/domain/src/knowledge/tools.ts";

// No database and no model: a scripted model and in-memory tool access.
const resource = { id: "00000000-0000-4000-8000-000000000001", name: "QA Room", duration_minutes: 30, location_id: "loc", active: true };
const coreSnapshot = {
  settings: { name: "Agent" },
  knowledge: [],
  packs: [],
  facts: [],
  rules: [],
  catalogue: null,
  context: { business: { name: "Studio Contoh", type: "other" }, location: { name: "Cawangan Contoh" } },
};
const oldSnapshot = { settings: { name: "Agent" }, knowledge: [] };
const access = (snapshot: object): ToolAccess => ({
  read: async () => ({ snapshot: snapshot as never, locationId: "loc", resources: [resource as never] }),
  availability: async () => [],
  record: async (step, _call, effect) =>
    effect.kind === "proposal"
      ? { kind: "proposal", proposal: { id: "p1", session_id: "s1", turn_id: "t1", attempt: 1, revision: 1, applied_booking_id: null, step, ...effect.proposal } as never }
      : (effect as never),
});
const knowledge = { catalogue: async () => [], units: async () => [], gap: async () => ({}) };
const book = { kind: "tool", call: { name: "book_slot", args: { resourceId: resource.id, startAt: "2026-11-17T10:00:00+08:00", title: "Consultation" } } };
const answer = { kind: "answer", text: "Noted for staff to review; it is not confirmed yet.", citations: [] };
const question = "Please propose a consultation at QA Room on 2026-11-17 at 10:00 Kuala Lumpur time.";

function scripted(steps: (object | Error)[]) {
  const seen: ModelInput["messages"][] = [];
  const model: ModelClient = {
    usage: undefined,
    generate: async (input) => {
      seen.push(input.messages);
      const next = steps.shift();
      if (next instanceof Error) throw next;
      return next as never;
    },
  };
  return { model, seen };
}
const run = (model: ModelClient, snapshot: object) =>
  runTextBrain({
    model,
    signal: new AbortController().signal,
    rules: agentRules,
    snapshot: snapshot as never,
    text: question,
    history: [],
    resources: [resource],
    access: access(snapshot),
    budget: 48000,
    core: { rules: coreAgentRules, knowledge },
  });

test("core snapshot: a proposal is shown without ids, with the noted wording and the language reminder", async () => {
  const { model, seen } = scripted([book, answer]);
  const out = await run(model, coreSnapshot);
  assert.equal(out.text, answer.text);
  assert.ok(seen[0][0].content.startsWith(coreAgentRules));
  const last = seen[1].at(-1)!.content;
  assert.match(last, /"kind":"proposal","recorded":"booking","status":"noted_for_staff_review","confirmed":false/);
  assert.doesNotMatch(last, /"id"|session_id|turn_id|resourceId/);
  assert.match(last, /Noted for staff to review, not confirmed\. Say only that, in at most two short sentences/);
  assert.ok(last.includes(`(it begins "Please propose a consultation at QA Room")`));
});

test("old snapshot: the prompt, the raw result and the old tail are unchanged", async () => {
  const { model, seen } = scripted([book, answer]);
  await run(model, oldSnapshot);
  assert.ok(seen[0][0].content.startsWith(agentRules + "\nBusiness configuration: "));
  const last = seen[1].at(-1)!.content;
  assert.match(last, /"proposal":\{"id":"p1"/);
  assert.ok(last.endsWith("\nNow answer the original question using this result, or make the remaining booking proposal. Do not repeat a completed tool."));
});

test("a reply cut off at the output limit is asked again once, without a new tool step", async () => {
  const { model, seen } = scripted([book, Error("MODEL_OUTPUT_TRUNCATED"), answer]);
  const out = await run(model, coreSnapshot);
  assert.equal(out.text, answer.text);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[2].at(-1), { role: "user", content: TRUNCATED_RETRY });
  assert.deepEqual(seen[2].slice(0, -1), seen[1]);
});

test("a second cut-off reply in the same turn fails the turn, and other errors are not retried", async () => {
  const twice = scripted([Error("MODEL_OUTPUT_TRUNCATED"), book, Error("MODEL_OUTPUT_TRUNCATED")]);
  await assert.rejects(run(twice.model, coreSnapshot), /MODEL_OUTPUT_TRUNCATED/);
  assert.equal(twice.seen.length, 3);
  const invalid = scripted([Error("MODEL_OUTPUT_INVALID"), answer]);
  await assert.rejects(run(invalid.model, coreSnapshot), /MODEL_OUTPUT_INVALID/);
  assert.equal(invalid.seen.length, 1);
});

test("an empty answer is never accepted", async () => {
  const { model } = scripted([book, { kind: "answer", text: "", citations: [] }]);
  await assert.rejects(run(model, coreSnapshot));
});
