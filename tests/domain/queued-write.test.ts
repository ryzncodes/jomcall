import { test } from "node:test";
import assert from "node:assert/strict";
import { createSaveQueue } from "../../web/lib/core/save-queue.ts";
import { queuedWrite, stored } from "../../web/lib/core/queued-write.ts";

class Conflict extends Error {}
function queue(same = false) {
  return createSaveQueue({
    revision: 1,
    newKey: () => "k",
    isConflict: (e) => e instanceof Conflict,
    isLost: () => false,
    wait: async () => {},
    reread: async () => ({ revision: 5, same }),
    onStatus: () => {},
  });
}

test("a stored write resolves with its result and carries the revision on", async () => {
  const q = queue();
  const r = await queuedWrite(q, async (rev) => ({ revision: rev + 1, id: "a" }));
  assert.equal(r.id, "a");
  assert.equal(q.revision(), 2);
});

test("a failed write rejects, so a form does not clear its text", async () => {
  const q = queue();
  await assert.rejects(
    queuedWrite(q, async () => {
      throw new Conflict();
    }),
  );
  assert.equal(await stored(undefined, async () => assert.fail("no reload")), false);
});

test("an earlier settings job's conflict rejects a queued row write", async () => {
  const q = queue();
  const settings = q
    .push({
      slot: "settings",
      run: async () => {
        throw new Conflict();
      },
    })
    .catch(() => "rejected");
  const row = queuedWrite(q, async (rev) => ({ revision: rev + 1 }));
  await assert.rejects(row);
  assert.equal(await settings, "rejected");
});

test("stored runs the reload and answers true only for a result", async () => {
  let reloaded = 0;
  assert.equal(await stored({ revision: 2 }, async () => void reloaded++), true);
  assert.equal(reloaded, 1);
});
