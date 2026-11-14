import { test } from "node:test";
import assert from "node:assert/strict";
import {
  namePrefill,
  pollDelay,
  replaceIds,
  unlocksPublish,
} from "../../web/components/core/setup/rules.ts";

const done = [{ state: "completed" }];

test("publish unlocks only from a draft test created after the finish stage opened", () => {
  const baseline = new Set(["old"]);
  assert.equal(
    unlocksPublish(baseline, { id: "new", source: "draft", turns: done }),
    true,
  );
  // A session listed when the stage opened never counts, even with new answers.
  assert.equal(
    unlocksPublish(baseline, { id: "old", source: "draft", turns: done }),
    false,
  );
  // No baseline (it could not be loaded): no unlock.
  assert.equal(
    unlocksPublish(null, { id: "new", source: "draft", turns: done }),
    false,
  );
  assert.equal(
    unlocksPublish(baseline, { id: "new", source: "published", turns: done }),
    false,
  );
  assert.equal(
    unlocksPublish(baseline, {
      id: "new",
      source: "draft",
      turns: [{ state: "running" }, { state: "failed" }],
    }),
    false,
  );
  assert.equal(unlocksPublish(baseline, null), false);
});

test("polling is every 3 s for a minute, then every 10 s", () => {
  assert.equal(pollDelay(0), 3000);
  assert.equal(pollDelay(59_999), 3000);
  assert.equal(pollDelay(60_000), 10_000);
});

test("only a question that fills business_name alone is prefilled with the name", () => {
  assert.equal(
    namePrefill(["facts.business_name"], false, "Kedai Contoh"),
    "Kedai Contoh",
  );
  assert.equal(
    namePrefill(["facts.business_name", "rules.x"], false, "Kedai Contoh"),
    "Kedai Contoh",
  );
  assert.equal(
    namePrefill(
      ["facts.business_name", "facts.what_we_do"],
      false,
      "Kedai Contoh",
    ),
    "",
  );
  assert.equal(namePrefill(["facts.business_name"], true, "Kedai Contoh"), "");
  assert.equal(namePrefill(["facts.address"], false, "Kedai Contoh"), "");
});

test("only live items chosen as Use new are sent in replace", () => {
  const conflicts = [{ itemId: "a" }, { itemId: "b" }, { itemId: "c" }];
  const items = [
    { id: "a", state: "pending" },
    { id: "b", state: "removed" },
    { id: "c", state: "pending" },
  ];
  assert.deepEqual(
    replaceIds(conflicts, items, { a: "new", b: "new", c: "keep" }),
    ["a"],
  );
});
