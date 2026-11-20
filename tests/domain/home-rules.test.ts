// Rules behind the Home screen: checklist before live, today line and the
// "Needs you" list after.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checklist,
  homeState,
  isLive,
  klDayRange,
  needsYou,
  todayCounts,
  type HomeFacts,
} from "../../web/lib/core/home-rules.ts";

const any = (v: unknown) => v as never;
const owner = (f: Partial<HomeFacts> = {}): HomeFacts => ({
  manager: true,
  published: false,
  ...f,
});
const plan = (periodState: string, code = "starter", extra = {}) =>
  any({ plan: code, periodState, graceUntil: null, ...extra });
const phones = (items: unknown[], request: unknown = null, configured = true) =>
  any({ items, request, provider: { configured, reason: null }, planIncludesNumber: true });
const channels = (phone: boolean) =>
  any({ phone, whatsapp: false, integrations: false });
const ids = (f: HomeFacts) => checklist(f).map((s) => s.id);
const step = (f: HomeFacts, id: string) => checklist(f).find((s) => s.id === id);
const fullOwner = (f: Partial<HomeFacts> = {}) =>
  owner({
    setup: any({ session: null, items: [] }),
    tests: [],
    plan: plan("none"),
    wallet: any({ state: "ok", balanceSen: 1000 }),
    phones: phones([]),
    channels: channels(true),
    ...f,
  });

test("checklist: new owner", () => {
  const s = checklist(fullOwner());
  assert.deepEqual(s.map((x) => x.id), ["setup", "test", "publish", "plan", "phone"]);
  assert.ok(s.every((x) => x.state === "todo"));
  assert.deepEqual(s.map((x) => x.href), [
    "/app/setup",
    "/app/test",
    "/app/agent",
    "/app/billing",
    "/app/phones",
  ]);
});

test("checklist: setup done by applied session or by publish", () => {
  const applied = fullOwner({ setup: any({ session: { state: "applied" }, items: [] }) });
  assert.equal(step(applied, "setup")!.state, "done");
  assert.equal(step(fullOwner({ setup: undefined, published: true }), "setup")!.state, "done");
  assert.equal(step(fullOwner({ setup: any({ session: { state: "open" }, items: [] }) }), "setup")!.state, "todo");
});

test("checklist: test done", () => {
  assert.equal(step(fullOwner({ tests: [any({ id: "t" })] }), "test")!.state, "done");
});

test("checklist: plan done", () => {
  for (const s of ["free", "charged"])
    assert.equal(step(fullOwner({ plan: plan(s) }), "plan")!.state, "done");
  // A new workspace starts on payg; the plan card reads that as "choose".
  assert.equal(step(fullOwner({ plan: plan("none", "payg") }), "plan")!.state, "todo");
  assert.equal(step(fullOwner({ plan: plan("downgraded") }), "plan")!.state, "todo");
  for (const s of ["none", "unpaid"])
    assert.equal(step(fullOwner({ plan: plan(s) }), "plan")!.state, "todo");
});

test("checklist: phone waiting", () => {
  const w = step(fullOwner({ phones: phones([], { state: "open" }) }), "phone")!;
  assert.equal(w.state, "waiting");
  assert.equal(w.href, null);
  assert.equal(step(fullOwner({ phones: phones([{ active: true }]) }), "phone")!.state, "done");
  assert.equal(step(fullOwner({ phones: phones([{ active: false }]) }), "phone")!.state, "todo");
});

test("checklist: no phone line", () => {
  const f = fullOwner({ channels: channels(false), phones: phones([], null, false) });
  assert.ok(!ids(f).includes("phone"));
});

test("checklist: staff", () => {
  const s = checklist(owner({ manager: false, tests: [], channels: channels(true) }));
  assert.deepEqual(s.map((x) => x.id), ["setup", "test", "publish"]);
  assert.ok(s.every((x) => x.href === null));
});

test("checklist: failed read", () => {
  assert.ok(!ids(fullOwner({ plan: undefined })).includes("plan"));
  assert.ok(!ids(fullOwner({ phones: undefined })).includes("phone"));
});

test("isLive", () => {
  assert.equal(isLive(fullOwner({ phones: phones([{ active: true }]) })), false);
  assert.equal(isLive(fullOwner({ published: true, phones: phones([{ active: true }]) })), true);
  assert.equal(
    isLive(fullOwner({ published: true, channels: channels(false), phones: phones([], null, false) })),
    true,
  );
  assert.equal(isLive(fullOwner({ published: true, phones: phones([], { state: "open" }) })), false);
  assert.equal(isLive(owner({ manager: false, published: true, channels: channels(false) })), true);
  assert.equal(isLive(owner({ manager: false, published: true, channels: channels(true) })), true);
  assert.equal(isLive(owner({ manager: false, published: false })), false);
  assert.equal(isLive(fullOwner({ published: true, phones: undefined })), true);
});

test("klDayRange", () => {
  assert.deepEqual(klDayRange(new Date("2026-11-20T03:00:00Z")), {
    from: "2026-11-19T16:00:00.000Z",
    to: "2026-11-20T16:00:00.000Z",
  });
});

test("todayCounts", () => {
  const now = new Date("2026-11-20T03:00:00Z");
  const calls = [
    any({ started_at: "2026-11-19T15:30:00Z", state: "ended" }),
    any({ started_at: "2026-11-19T16:10:00Z", state: "refused" }),
  ];
  const f = fullOwner({ calls, bookingsToday: [any({}), any({})], wallet: any({ state: "ok", balanceSen: 4210 }) });
  assert.deepEqual(todayCounts(f, now), { calls: 1, missed: 1, bookings: 2, balanceSen: 4210 });
  assert.equal(todayCounts({ ...f, manager: false }, now).balanceSen, null);
  assert.equal(todayCounts({ ...f, calls: undefined }, now).calls, null);
  assert.equal(todayCounts({ ...f, calls: undefined }, now).missed, null);
});

test("needsYou order and drops", () => {
  const f = fullOwner({
    wallet: any({ state: "exhausted", balanceSen: 0 }),
    toConfirm: [any({}), any({})],
    chats: [any({})],
    gaps: [any({}), any({}), any({})],
  });
  assert.deepEqual(
    needsYou(f).map((n) => [n.id, n.count, n.href]),
    [
      ["wallet_exhausted", 1, "/app/billing"],
      ["bookings", 2, "/app/bookings"],
      ["chats", 1, "/app/inbox"],
      ["gaps", 3, "/app/agent#questions"],
    ],
  );
  assert.deepEqual(needsYou(fullOwner({ toConfirm: [], chats: [], gaps: [] })), []);
  const unpaid = needsYou(fullOwner({ plan: plan("unpaid", "starter", { graceUntil: "2026-11-27" }) }));
  assert.deepEqual(unpaid.map((n) => [n.id, n.date]), [["plan_unpaid", "2026-11-27"]]);
  assert.deepEqual(
    needsYou({ ...f, manager: false }).map((n) => n.id),
    ["bookings", "chats", "gaps"],
  );
  assert.deepEqual(needsYou(fullOwner({ wallet: any({ state: "low", balanceSen: 840 }) })).map((n) => n.id), ["wallet_low"]);
  assert.deepEqual(needsYou(fullOwner({ wallet: any({ state: "grace", balanceSen: -10 }) })).map((n) => n.id), ["wallet_grace"]);
});

test("homeState", () => {
  assert.equal(homeState(owner()), "failed");
  assert.equal(homeState(fullOwner()), "checklist");
  assert.equal(homeState(fullOwner({ published: true, phones: phones([{ active: true }]) })), "today");
});
