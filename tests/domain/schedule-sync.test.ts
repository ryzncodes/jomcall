import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHoursStore,
  createScheduleSync,
  type ScheduleBody,
  type ScheduleData,
} from "../../web/components/core/agent/schedule-sync.ts";
import { closedWeek } from "../../web/components/core/agent/rules.ts";

class Conflict extends Error {}
class Refused extends Error {}
class Lost extends Error {}

const nine = [{ start: "09:00", end: "17:00" }];
const start = (): ScheduleData => ({
  timezone: "Asia/Kuala_Lumpur",
  weekdays: closedWeek.map((d, i) => (i < 5 ? nine : d)),
  closures: [],
  revision: 3,
});

function setup(
  o: {
    send?: (b: ScheduleBody, rev: number, key: string) => Promise<ScheduleData>;
    read?: () => ScheduleData;
  } = {},
) {
  const sent: { body: ScheduleBody; rev: number; key: string }[] = [];
  let n = 0;
  const events = { conflicts: 0, saved: 0 };
  const sync = createScheduleSync({
    initial: start(),
    newKey: () => "k" + ++n,
    isConflict: (e) => e instanceof Conflict,
    isLost: (e) => e instanceof Lost,
    wait: async () => {},
    send:
      o.send ??
      (async (body, rev, key) => {
        sent.push({ body, rev, key });
        return { ...body, revision: rev + 1 };
      }),
    read: async () => o.read?.() ?? start(),
    onChange: () => {},
    onSaved: () => {
      events.saved++;
    },
    onConflict: () => {
      events.conflicts++;
    },
  });
  return { sync, sent, events };
}

test("two quick changes are sent one after the other, carrying the revision", async () => {
  const t = setup();
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[5] = [{ start: "10:00", end: "14:00" }];
  t.sync.setWeek(w);
  t.sync.save();
  const w2 = w.map((d) => d.map((b) => ({ ...b })));
  w2[6] = [{ start: "11:00", end: "13:00" }];
  t.sync.setWeek(w2);
  t.sync.save();
  await t.sync.idle();
  assert.deepEqual(
    t.sent.map((s) => s.rev),
    [3, 4],
  );
  assert.equal(t.sent[0]!.body.weekdays[6]!.length, 0);
  assert.equal(t.sent[1]!.body.weekdays[6]!.length, 1);
  assert.equal(t.sync.revision(), 5);
  assert.equal(t.events.saved, 2);
  assert.equal(t.sync.state().unsaved, false);
});

test("a day that cannot be sent keeps its text; the other days are sent", async () => {
  const t = setup();
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[0] = [{ start: "17:00", end: "09:00" }];
  w[5] = [{ start: "10:00", end: "14:00" }];
  t.sync.setWeek(w);
  t.sync.save();
  await t.sync.idle();
  assert.deepEqual(t.sent[0]!.body.weekdays[0], nine);
  assert.deepEqual(t.sent[0]!.body.weekdays[5], w[5]);
  const s = t.sync.state();
  assert.deepEqual(s.weekdays[0], [{ start: "17:00", end: "09:00" }]);
  assert.deepEqual(s.invalid, [0]);
  assert.equal(s.unsaved, true);
});

test("a lost answer is sent again with the same key and body", async () => {
  const seen: { key: string; body: ScheduleBody }[] = [];
  let calls = 0;
  const t = setup({
    send: async (body, rev, key) => {
      seen.push({ key, body });
      if (calls++ === 0) throw new Lost();
      return { ...body, revision: rev + 1 };
    },
  });
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[5] = [{ start: "10:00", end: "14:00" }];
  t.sync.setWeek(w);
  t.sync.save();
  // Typed while the first try is being retried: not part of that body.
  const w2 = w.map((d) => d.map((b) => ({ ...b })));
  w2[6] = [{ start: "10:00", end: "12:00" }];
  t.sync.setWeek(w2);
  await t.sync.idle();
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.key, seen[1]!.key);
  assert.deepEqual(seen[0]!.body, seen[1]!.body);
});

test("a refusal leaves the row as typed and keeps the error", async () => {
  const t = setup({
    send: async () => {
      throw new Refused();
    },
  });
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[0] = [];
  t.sync.setWeek(w);
  t.sync.save();
  await t.sync.idle();
  const s = t.sync.state();
  assert.ok(s.error instanceof Refused);
  assert.deepEqual(s.weekdays[0], []);
  assert.equal(s.unsaved, true);
  assert.equal(s.conflicted, false);
  assert.equal(t.events.conflicts, 0);
});

test("a 409 that left the same schedule on the server is no conflict", async () => {
  const typed = start();
  typed.weekdays[5] = [{ start: "10:00", end: "14:00" }];
  const t = setup({
    send: async () => {
      throw new Conflict();
    },
    read: () => ({ ...typed, revision: 9 }),
  });
  t.sync.setWeek(typed.weekdays);
  t.sync.save();
  await t.sync.idle();
  assert.equal(t.events.conflicts, 0);
  assert.equal(t.sync.revision(), 9);
  assert.equal(t.sync.state().unsaved, false);
});

test("a real conflict: untouched days take the server, typed days stay", async () => {
  const theirs = start();
  theirs.weekdays[1] = [{ start: "08:00", end: "12:00" }];
  theirs.weekdays[2] = [{ start: "08:00", end: "12:00" }];
  theirs.revision = 8;
  const t = setup({
    send: async () => {
      throw new Conflict();
    },
    read: () => theirs,
  });
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[2] = [{ start: "10:00", end: "11:00" }];
  t.sync.setWeek(w);
  t.sync.save();
  await t.sync.idle();
  const s = t.sync.state();
  assert.equal(t.events.conflicts, 1);
  assert.equal(s.conflicted, true);
  assert.deepEqual(s.weekdays[1], theirs.weekdays[1]);
  assert.deepEqual(s.weekdays[2], [{ start: "10:00", end: "11:00" }]);
  assert.equal(s.unsaved, true);
  assert.equal(t.sync.revision(), 8);
});

test("a change that equals what the server holds sends nothing", async () => {
  const t = setup();
  t.sync.save();
  await t.sync.idle();
  assert.equal(t.sent.length, 0);
});

test("reload reads in place and keeps typed days", async () => {
  const theirs = start();
  theirs.weekdays[1] = [{ start: "08:00", end: "12:00" }];
  theirs.revision = 6;
  const t = setup({ read: () => theirs });
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[0] = [{ start: "7:00", end: "9:00" }];
  t.sync.setWeek(w);
  await t.sync.reload();
  const s = t.sync.state();
  assert.deepEqual(s.weekdays[0], [{ start: "7:00", end: "9:00" }]);
  assert.deepEqual(s.weekdays[1], theirs.weekdays[1]);
  assert.equal(t.sync.revision(), 6);
});

test("settled waits for a save in flight and does not hang after a failure", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const t = setup({
    send: async (body, rev) => {
      await gate;
      return { ...body, revision: rev + 1 };
    },
  });
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[5] = [{ start: "10:00", end: "14:00" }];
  t.sync.setWeek(w);
  t.sync.save();
  let done = false;
  void t.sync.settled().then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false);
  release();
  await t.sync.settled();
  assert.equal(t.sync.state().server.revision, 4);

  const bad = setup({
    send: async () => {
      throw new Refused();
    },
  });
  const w2 = bad.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w2[5] = [{ start: "10:00", end: "14:00" }];
  bad.sync.setWeek(w2);
  bad.sync.save();
  const w3 = w2.map((d) => d.map((b) => ({ ...b })));
  w3[6] = [{ start: "10:00", end: "12:00" }];
  bad.sync.setWeek(w3);
  bad.sync.save();
  await bad.sync.settled();
  assert.ok(bad.sync.state().error instanceof Refused);
});

test("the store keeps a sync, its typed rows and its save across leaving the view", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const t = setup({
    send: async (body, rev) => {
      await gate;
      return { ...body, revision: rev + 1 };
    },
  });
  const store = createHoursStore();
  store.set("b1", t.sync);
  const w = t.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w[5] = [{ start: "10:00", end: "14:00" }];
  t.sync.setWeek(w);
  t.sync.save();
  // The owner leaves the view; a row typed but refused stays too.
  const other = setup({
    send: async () => {
      throw new Refused();
    },
  });
  store.set("b2", other.sync);
  const w2 = other.sync.state().weekdays.map((d) => d.map((b) => ({ ...b })));
  w2[0] = [];
  other.sync.setWeek(w2);
  other.sync.save();
  assert.equal(store.get("b1"), t.sync);
  assert.equal(store.unsaved(), true);
  let left = false;
  void store.settled().then(() => (left = true));
  await Promise.resolve();
  assert.equal(left, false);
  release();
  await store.settled();
  // Back on the view: same sync, save landed on it, no false conflict.
  const again = store.get("b1")!;
  assert.equal(again.state().server.revision, 4);
  assert.equal(again.state().conflicted, false);
  assert.equal(again.state().unsaved, false);
  // The refused branch still holds its typed row.
  assert.deepEqual(store.get("b2")!.state().weekdays[0], []);
  assert.deepEqual(store.unsavedBranches(), ["b2"]);
});

test("the store tells listeners about changes and stops after unsubscribe", () => {
  const store = createHoursStore();
  let n = 0;
  const off = store.subscribe(() => n++);
  store.notify();
  off();
  store.notify();
  assert.equal(n, 1);
});
