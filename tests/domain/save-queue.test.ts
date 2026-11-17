import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSaveQueue,
  type QueueStatus,
} from "../../web/lib/core/save-queue.ts";

class Lost extends Error {}
class Conflict extends Error {}

function setup(
  over: Partial<{
    reread: () => Promise<{ revision: number; same: boolean }>;
  }> = {},
) {
  let n = 0;
  const statuses: QueueStatus[] = [],
    errors: unknown[] = [],
    waits: number[] = [];
  const queue = createSaveQueue({
    revision: 1,
    newKey: () => "k" + ++n,
    isConflict: (e) => e instanceof Conflict,
    isLost: (e) => e instanceof Lost,
    reread: over.reread ?? (async () => ({ revision: 9, same: false })),
    onStatus: (s, e) => {
      statuses.push(s);
      if (e !== undefined) errors.push(e);
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  return { queue, statuses, errors, waits };
}

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

test("two quick edits go one at a time and the second carries the first's revision", async () => {
  const { queue, statuses } = setup();
  const seen: number[] = [];
  const a = queue.push({
    run: async (rev) => (seen.push(rev), 2),
  });
  const b = queue.push({
    run: async (rev) => (seen.push(rev), 3),
  });
  await Promise.all([a, b]);
  await queue.idle();
  assert.deepEqual(seen, [1, 2]);
  assert.equal(queue.revision(), 3);
  assert.deepEqual(statuses, ["saving", "saving", "saved"]);
});

test("a queued settings save is replaced by a newer one in the same slot", async () => {
  const { queue } = setup();
  const g = gate();
  const ran: string[] = [];
  const first = queue.push({
    run: async () => (await g.p, ran.push("first"), 2),
  });
  const s1 = queue.push({
    slot: "settings",
    run: async () => (ran.push("s1"), 3),
  });
  const s2 = queue.push({
    slot: "settings",
    run: async () => (ran.push("s2"), 3),
  });
  const s3 = queue.push({
    slot: "settings",
    run: async () => (ran.push("s3"), 3),
  });
  g.open();
  await Promise.all([first, s1, s2, s3]);
  assert.deepEqual(ran, ["first", "s3"]);
});

test("a lost answer is sent again with the same key before anything newer", async () => {
  const { queue, waits } = setup();
  const keys: string[] = [];
  let lose = 1;
  const a = queue.push({
    run: async (_r, key) => {
      keys.push(key);
      if (lose-- > 0) throw new Lost();
      return 2;
    },
  });
  const b = queue.push({
    run: async (_r, key) => (keys.push(key), 3),
  });
  await Promise.all([a, b]);
  assert.deepEqual(keys, ["k1", "k1", "k2"]);
  assert.deepEqual(waits, [500]);
});

test("after three retries of a lost answer the job fails and the status is error", async () => {
  const { queue, statuses, errors, waits } = setup();
  let calls = 0;
  const err = new Lost();
  const a = queue.push({
    run: async () => {
      calls++;
      throw err;
    },
  });
  const queued = queue.push({ run: async () => 2 });
  await assert.rejects(a, (e) => e === err);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 2000, 5000]);
  assert.equal(statuses.at(-1), "error");
  assert.equal(errors.at(-1), err);
  // The queued job stays and runs on the next push.
  assert.equal(queue.pending(), true);
  const c = queue.push({ run: async () => 3 });
  await Promise.all([queued, c]);
  assert.equal(queue.revision(), 3);
  assert.equal(statuses.at(-1), "saved");
});

test("an error that is neither lost nor a conflict rejects without a retry", async () => {
  const { queue, statuses, errors, waits } = setup();
  const err = new Error("BAD");
  await assert.rejects(
    queue.push({
      run: async () => {
        throw err;
      },
    }),
    (e) => e === err,
  );
  assert.deepEqual(waits, []);
  assert.equal(statuses.at(-1), "error");
  assert.equal(errors.at(-1), err);
});

test("a conflict where the server already has our content carries on silently", async () => {
  const { queue, statuses } = setup({
    reread: async () => ({ revision: 5, same: true }),
  });
  const seen: number[] = [];
  const a = queue.push({
    run: async () => {
      throw new Conflict();
    },
  });
  const b = queue.push({ run: async (rev) => (seen.push(rev), 6) });
  await Promise.all([a, b]);
  assert.deepEqual(seen, [5]);
  assert.equal(queue.revision(), 6);
  assert.ok(!statuses.includes("conflict"));
  assert.equal(statuses.at(-1), "saved");
});

test("a conflict with different content rejects the queued jobs and reports conflict", async () => {
  const { queue, statuses, errors } = setup();
  const boom = new Conflict();
  let ranB = false;
  const a = queue.push({
    run: async () => {
      throw boom;
    },
  });
  const b = queue.push({
    run: async () => ((ranB = true), 3),
  });
  await assert.rejects(a, (e) => e === boom);
  await assert.rejects(b);
  assert.equal(ranB, false);
  assert.equal(queue.revision(), 9);
  assert.equal(statuses.at(-1), "conflict");
  assert.equal(errors.at(-1), boom);
  assert.equal(queue.pending(), false);
});

test("idle resolves only when the queue is empty", async () => {
  const { queue } = setup();
  const g = gate();
  let idled = false;
  const a = queue.push({ run: async () => (await g.p, 2) });
  const i = queue.idle().then(() => (idled = true));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(idled, false);
  assert.equal(queue.pending(), true);
  g.open();
  await a;
  await i;
  assert.equal(idled, true);
  assert.equal(queue.pending(), false);
});

test("last is the newest queued job, else the running one", async () => {
  const { queue } = setup();
  assert.equal(queue.last(), undefined);
  const g = gate();
  const running = { run: async () => (await g.p, 2) };
  const queued = { run: async () => 3 };
  const a = queue.push(running);
  assert.equal(queue.last(), running);
  const b = queue.push(queued);
  assert.equal(queue.last(), queued);
  g.open();
  await Promise.all([a, b]);
  assert.equal(queue.last(), undefined);
});

test("setRevision changes the revision the next job sends", async () => {
  const { queue } = setup();
  queue.setRevision(7);
  let seen = 0;
  await queue.push({ run: async (r) => ((seen = r), 8) });
  assert.equal(seen, 7);
});

function reentrant(on: QueueStatus, extra: () => void = () => {}) {
  let n = 0,
    fired = false;
  const ran: string[] = [];
  let push!: (label: string, run?: () => Promise<number>) => Promise<void>;
  const queue = createSaveQueue({
    revision: 1,
    newKey: () => "k" + ++n,
    isConflict: (e) => e instanceof Conflict,
    isLost: () => false,
    reread: async () => ({ revision: 9, same: false }),
    onStatus: (s) => {
      if (s === on && !fired) {
        fired = true;
        extra();
      }
    },
  });
  push = (label, run) =>
    queue.push({
      run:
        run ??
        (async () => {
          ran.push(label);
          return 5;
        }),
    });
  return { queue, push, ran };
}

test("a save pushed from the saved callback runs and idle resolves after it", async () => {
  let second: Promise<void> | undefined;
  const h = reentrant("saved", () => {
    second = h.push("second");
  });
  await h.push("first");
  await h.queue.idle();
  await second;
  assert.deepEqual(h.ran, ["first", "second"]);
  assert.equal(h.queue.pending(), false);
});

test("a save pushed from the error callback restarts the queue, queued jobs first", async () => {
  let third: Promise<void> | undefined;
  const h = reentrant("error", () => {
    third = h.push("third");
  });
  const a = h.push("a", async () => {
    throw new Error("BAD");
  });
  const b = h.push("b");
  await assert.rejects(a);
  await h.queue.idle();
  await Promise.all([b, third]);
  assert.deepEqual(h.ran, ["b", "third"]);
});

test("a save pushed from the conflict callback runs", async () => {
  let next: Promise<void> | undefined;
  const h = reentrant("conflict", () => {
    next = h.push("next");
  });
  await assert.rejects(
    h.push("a", async () => {
      throw new Conflict();
    }),
  );
  await h.queue.idle();
  await next;
  assert.deepEqual(h.ran, ["next"]);
});

test("an onStatus that throws still lets idle resolve and a later push run", async () => {
  const ran: string[] = [];
  const queue = createSaveQueue({
    revision: 1,
    newKey: () => "k",
    isConflict: () => false,
    isLost: () => false,
    reread: async () => ({ revision: 1, same: false }),
    onStatus: () => {
      throw new Error("callback broke");
    },
    wait: async () => {},
  });
  await queue.push({ run: async () => (ran.push("a"), 2) });
  await queue.idle();
  await queue.push({ run: async () => (ran.push("b"), 3) });
  await queue.idle();
  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(queue.pending(), false);
});
