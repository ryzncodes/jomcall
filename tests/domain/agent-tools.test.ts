import test from "node:test";
import assert from "node:assert/strict";
import {
  executeTestTool,
  type ToolAccess,
  type ToolEffect,
} from "../../packages/domain/src/agent-test/tools.ts";
import { agentFixture } from "../helpers/agent-test.ts";
test("sandbox tools reject invented scope and persist proposals without creating appointments", async () => {
  const f = await agentFixture();
  try {
    const access: ToolAccess = {
      read: async () => ({
        snapshot: { knowledge: [] },
        locationId: f.h.orgA.locationId,
        resources: [f.resource],
      }),
      availability: async () => [],
      record: async (step, call, effect) => {
        if (effect.kind !== "proposal") return effect;
        const p = (
          await f.h.cleanup.query(
            "insert into app.test_proposal(org_id,session_id,turn_id,attempt,step,kind,details)values($1,$2,$3,1,$4,$5,$6)returning *",
            [
              f.h.orgA.id,
              f.session.id,
              f.turn.id,
              step,
              effect.proposal.kind,
              effect.proposal.details,
            ],
          )
        ).rows[0];
        return { kind: "proposal", proposal: p };
      },
    };
    await assert.rejects(
      executeTestTool(access, 0, {
        name: "book_slot",
        args: { ...f.input, orgId: f.h.orgB.id },
      }),
    );
    await assert.rejects(
      executeTestTool(access, 0, { name: "transfer_call", args: {} }),
    );
    await assert.rejects(
      executeTestTool(access, 0, {
        name: "check_availability",
        args: { resourceId: crypto.randomUUID(), fromDate: f.day, days: 1 },
      }),
      /NOT_FOUND/,
    );
    const r = await executeTestTool(access, 0, {
      name: "book_slot",
      args: {
        resourceId: f.resource.id,
        startAt: f.slotStart,
        title: "Proposed",
      },
    });
    assert.equal(r.kind, "proposal");
    assert.equal(
      (
        await f.h.cleanup.query(
          "select count(*) from app.booking where org_id=$1",
          [f.h.orgA.id],
        )
      ).rows[0].count,
      "0",
    );
    await assert.rejects(
      executeTestTool(access, 4, {
        name: "take_message",
        args: { text: "Test" },
      }),
      /TOOL_LIMIT/,
    );
  } finally {
    await f.close();
  }
});
