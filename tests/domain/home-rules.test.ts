// Rules behind the Home screen: checklist before live, today line and the
// "Needs you" list after.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checklist,
  homeState,
  isLive,
  liveFrom,
  stepsFrom,
  klDayRange,
  needsYou,
  keepLastGood,
  todayCounts,
  type HomeFacts,
} from "../../web/lib/core/home-rules.ts";
import { needText, todayParts } from "../../web/components/core/home/copy.ts";

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
    "/app/phone-numbers",
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
  assert.equal(isLive(fullOwner({ plan: plan("charged"), published: true, phones: phones([{ active: true }]) })), true);
  assert.equal(
    isLive(fullOwner({ plan: plan("charged"), published: true, channels: channels(false), phones: phones([], null, false) })),
    true,
  );
  assert.equal(isLive(fullOwner({ plan: plan("charged"), published: true, phones: phones([], { state: "open" }) })), false);
  assert.equal(isLive(owner({ manager: false, published: true, channels: channels(false) })), true);
  assert.equal(isLive(owner({ manager: false, published: true, channels: channels(true) })), true);
  assert.equal(isLive(owner({ manager: false, published: false })), false);
  assert.equal(isLive(fullOwner({ plan: plan("charged"), published: true, phones: undefined })), true);
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
  assert.equal(homeState(fullOwner({ plan: plan("charged"), published: true, phones: phones([{ active: true }]) })), "today");
});

test("review: a manager without a chosen plan is not live", () => {
  const f = fullOwner({ published: true, channels: channels(false), phones: phones([], null, false) });
  assert.equal(isLive(f), false);
  assert.equal(isLive({ ...f, plan: plan("charged") }), true);
  assert.equal(isLive({ ...f, plan: undefined }), true);
  assert.equal(homeState(f), "checklist");
});

test("review: unpaid date is the last day of grace in KL", () => {
  const f = fullOwner({ plan: plan("unpaid", "starter", { graceUntil: "2026-11-26T16:00:00.000Z" }) });
  assert.equal(needsYou(f).find((n) => n.id === "plan_unpaid")!.date, "2026-11-26");
});

test("review: phone button only when the plan includes a number", () => {
  const p = any({ items: [], request: null, provider: { configured: true, reason: null }, planIncludesNumber: false });
  const s = step(fullOwner({ phones: p }), "phone")!;
  assert.equal(s.state, "todo");
  assert.equal(s.href, null);
});

test("minors: plan step knows an unpaid fee", () => {
  const s = step(fullOwner({ plan: plan("unpaid") }), "plan")!;
  assert.equal(s.state, "todo");
  assert.equal(s.unpaid, true);
  assert.equal(step(fullOwner({ plan: plan("none") }), "plan")!.unpaid, undefined);
});

test("minors: a failed poll keeps the last good value", () => {
  const prev = fullOwner({ published: true, phones: phones([]) });
  const next = { ...prev, phones: undefined, wallet: undefined };
  const kept = keepLastGood(prev, next);
  assert.deepEqual(kept.phones, prev.phones);
  assert.deepEqual(kept.wallet, prev.wallet);
  assert.equal(keepLastGood(undefined, next).phones, undefined);
  // A new value always wins, and the viewer's role and publish come from now.
  const changed = { ...next, plan: plan("charged"), published: false };
  assert.equal(keepLastGood(prev, changed).plan!.periodState, "charged");
  assert.equal(keepLastGood(prev, changed).published, false);
  // A change of viewer role drops what the other role read.
  assert.equal(keepLastGood(prev, { ...next, manager: false }).phones, undefined);
});

const en = (a: string, _b: string) => a;
const bm = (_a: string, b: string) => b;
test("minors: plurals in the today line", () => {
  assert.deepEqual(todayParts({ calls: 1, missed: 1, bookings: 1, balanceSen: null }, en).map((p) => p.text), [
    "1 call",
    "1 not answered",
    "1 booking",
  ]);
  assert.deepEqual(todayParts({ calls: 2, missed: 0, bookings: 0, balanceSen: 4210 }, en).map((p) => p.text), [
    "2 calls",
    "0 not answered",
    "0 bookings",
    "RM 42.10",
  ]);
  assert.equal(todayParts({ calls: null, missed: null, bookings: null, balanceSen: 4210 }, en)[0].label, "Wallet");
  assert.equal(todayParts({ calls: null, missed: null, bookings: null, balanceSen: 4210 }, bm)[0].label, "Dompet");
});

test("minors: plurals in the needs list", () => {
  const n = (id: string, count: number) => needText(any({ id, count, href: "" }), en, null);
  assert.equal(n("bookings", 1), "1 booking to confirm");
  assert.equal(n("bookings", 2), "2 bookings to confirm");
  assert.equal(n("chats", 1), "1 WhatsApp chat waiting for you");
  assert.equal(n("chats", 3), "3 WhatsApp chats waiting for you");
  assert.equal(n("gaps", 1), "1 question the agent could not answer");
  assert.equal(n("gaps", 2), "2 questions the agent could not answer");
  assert.equal(needText(any({ id: "bookings", count: 1, href: "" }), bm, null), "1 tempahan perlu disahkan");
});

// First-run design (2026-11-21): step six and live after the first call.
const call = { id: "c1", startedAt: "2026-11-21T02:00:00.000Z" };
const withRun = (firstCall: unknown, f: Partial<HomeFacts> = {}) =>
  fullOwner({ firstRun: any({ firstCall }), ...f });

test("checklist: call step follows the phone step", () => {
  const active = withRun(null, { phones: phones([{ active: true, e164: "+60311112222" }]) });
  const last = checklist(active).at(-1)!;
  assert.deepEqual(last, { id: "call", state: "todo", href: "/app/phone-numbers" });
  const none = step(withRun(null), "call")!;
  assert.deepEqual(none, { id: "call", state: "todo", href: null, hint: "number_first" });
});

test("checklist: call step done on the first call", () => {
  const f = withRun(call, { phones: phones([{ active: true }]) });
  assert.equal(step(f, "call")!.state, "done");
  assert.equal(checklist(f).length, 6);
});

test("checklist: no call step without a phone line, for staff, or when firstRun failed", () => {
  assert.ok(!ids(withRun(null, { channels: channels(false), phones: phones([], null, false) })).includes("call"));
  assert.ok(!ids(owner({ manager: false, firstRun: any({ firstCall: null }) })).includes("call"));
  assert.ok(!ids(fullOwner({ firstRun: undefined })).includes("call"));
});

test("checklist: phone button goes to /app/phone-numbers; plan first otherwise", () => {
  assert.equal(step(fullOwner(), "phone")!.href, "/app/phone-numbers");
  const p = any({ items: [], request: null, provider: { configured: true, reason: null }, planIncludesNumber: false });
  assert.equal(step(fullOwner({ phones: p }), "phone")!.hint, "plan_first");
});

test("isLive: published, plan and number are not live until the first call", () => {
  const ready = { plan: plan("charged"), published: true, phones: phones([{ active: true }]) };
  assert.equal(isLive(withRun(null, ready)), false);
  assert.equal(homeState(withRun(null, ready)), "checklist");
  assert.equal(isLive(withRun(call, ready)), true);
  // A failed firstRun read falls back to the rule before step six.
  assert.equal(isLive(fullOwner(ready)), true);
});

test("stepsFrom: the firstRun read gives the same list as Home", () => {
  const c = {
    manager: true,
    published: true,
    setupApplied: true,
    tested: true,
    plan: { chosen: true, unpaid: false },
    phone: { offered: true, active: true, activeE164: "+60311112222", requestOpen: false, planIncludesNumber: true },
    firstCall: null,
  };
  const home = withRun(null, {
    published: true,
    setup: any({ session: { state: "applied" }, items: [] }),
    tests: [any({})],
    plan: plan("charged"),
    phones: phones([{ active: true, e164: "+60311112222" }]),
  });
  assert.deepEqual(stepsFrom(c), checklist(home));
  assert.equal(liveFrom(c), false);
  assert.equal(liveFrom({ ...c, firstCall: call }), true);
});

test("checklist: an active number counts as a phone line without a provider, as on the server", () => {
  const f = withRun(null, {
    plan: plan("charged"),
    published: true,
    channels: channels(false),
    phones: phones([{ active: true, e164: "+60311112222" }], null, false),
  });
  assert.equal(step(f, "phone")!.state, "done");
  assert.equal(step(f, "call")!.state, "todo");
  assert.equal(isLive(f), false);
});

test("needsYou: open follow-ups, with the ones assigned to you", () => {
  const f = fullOwner({ followUps: { open: 3, mine: 1 }, chats: [any({})] });
  const need = needsYou(f).find((n) => n.id === "follow_ups");
  assert.deepEqual(need, { id: "follow_ups", count: 3, mine: 1, href: "/app/follow-ups" });
  // Before the chats: a follow-up is the item to act on.
  assert.deepEqual(needsYou(f).map((n) => n.id), ["follow_ups", "chats"]);
  assert.deepEqual(needsYou({ ...f, manager: false }).map((n) => n.id), ["follow_ups", "chats"]);
  assert.deepEqual(needsYou(fullOwner({ followUps: { open: 0, mine: 0 } })), []);
  assert.deepEqual(needsYou(fullOwner({ followUps: undefined })), []);
  assert.equal(needText(need!, en, null), "3 to follow up · 1 assigned to you");
  assert.equal(needText(need!, bm, null), "3 untuk disusuli · 1 diserahkan kepada anda");
  assert.equal(needText({ ...need!, count: 1, mine: 0 }, en, null), "1 to follow up");
  assert.equal(needText({ ...need!, count: 1, mine: 0 }, bm, null), "1 untuk disusuli");
});
