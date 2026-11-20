// The Home loader: one read per fact, each allowed to fail on its own.
import test from "node:test";
import assert from "node:assert/strict";
import { loadHomeFacts } from "../../web/components/core/home/load.ts";

const now = new Date("2026-11-20T03:00:00Z");
type Call = [string, Record<string, unknown>];
function fake(fail: string[] = []) {
  const calls: Call[] = [];
  const answers: Record<string, unknown> = {
    setup: { session: null, items: [] },
    agentTests: [],
    plan: { plan: "starter", periodState: "none" },
    wallet: { state: "ok", balanceSen: 100 },
    phoneNumbers: { items: [], request: null, provider: { configured: true, reason: null } },
    channels: { phone: true, whatsapp: false, integrations: false },
    calls: { items: [{ id: "c1" }], nextCursor: null },
    conversations: [{ id: "w1" }],
    knowledgeGaps: [{ id: "g1" }],
  };
  return {
    calls,
    client: {
      async execute(name: string, input: Record<string, unknown>) {
        calls.push([name, input]);
        if (fail.includes(name)) throw new Error("nope");
        if (name === "bookings")
          return {
            items: input.status
              ? [{ id: "r1", status: "requested" }]
              : [
                  { id: "b1", status: "confirmed" },
                  { id: "b2", status: "cancelled" },
                ],
            nextCursor: null,
          };
        return answers[name];
      },
    },
  };
}
const names = (c: Call[]) => c.map(([n]) => n).sort();

test("manager reads", async () => {
  const f = fake();
  await loadHomeFacts(f.client, { manager: true, published: false, agentId: "a1" }, now);
  assert.deepEqual(
    names(f.calls),
    ["agentTests", "bookings", "bookings", "calls", "channels", "conversations", "knowledgeGaps", "phoneNumbers", "plan", "setup", "wallet"],
  );
  const input = (n: string, pick = (i: Record<string, unknown>) => true) =>
    f.calls.find(([k, i]) => k === n && pick(i))![1];
  assert.deepEqual(input("calls"), { limit: 100 });
  assert.deepEqual(input("setup"), { id: "a1" });
  assert.deepEqual(input("conversations"), { attention: "needs" });
  assert.deepEqual(input("knowledgeGaps"), { id: "a1", status: "open" });
  assert.deepEqual(input("bookings", (i) => !i.status), {
    from: "2026-11-19T16:00:00.000Z",
    to: "2026-11-20T16:00:00.000Z",
    limit: 100,
  });
  assert.deepEqual(input("bookings", (i) => !!i.status), {
    status: "requested",
    from: "2026-11-20T03:00:00.000Z",
    to: "2026-12-20T03:00:00.000Z",
    limit: 100,
  });
});

test("staff never read billing or phone numbers", async () => {
  const f = fake();
  await loadHomeFacts(f.client, { manager: false, published: false, agentId: "a1" }, now);
  for (const n of ["plan", "wallet", "phoneNumbers"])
    assert.ok(!names(f.calls).includes(n), n);
});

test("no agent id skips setup and gaps", async () => {
  const f = fake();
  const v = await loadHomeFacts(f.client, { manager: true, published: false, agentId: null }, now);
  assert.ok(!names(f.calls).includes("knowledgeGaps"));
  assert.ok(!names(f.calls).includes("setup"));
  assert.equal(v.gaps, undefined);
});

test("one failed read leaves the others", async () => {
  const f = fake(["wallet"]);
  const v = await loadHomeFacts(f.client, { manager: true, published: true, agentId: "a1" }, now);
  assert.equal(v.wallet, undefined);
  assert.equal(v.published, true);
  assert.deepEqual(v.plan, { plan: "starter", periodState: "none" });
});

test("shapes", async () => {
  const v = await loadHomeFacts(fake().client, { manager: true, published: false, agentId: "a1" }, now);
  assert.deepEqual(v.calls, [{ id: "c1" }]);
  assert.deepEqual(v.bookingsToday!.map((b) => b.id), ["b1"]);
  assert.deepEqual(v.toConfirm!.map((b) => b.id), ["r1"]);
});
