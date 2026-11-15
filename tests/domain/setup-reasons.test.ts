// The setup reader's fixed reason sentences live in one place
// (packages/contracts/src/setup-reasons.ts). The reader re-exports them,
// the setup screens translate them, and app_private.setup_read writes its
// own copies in SQL: this keeps all of them equal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as reasons from "../../packages/contracts/src/setup-reasons.ts";
import * as reader from "../../packages/inference/src/setup-reader.ts";
import { reasonParts } from "../../web/components/core/setup/rules.ts";

const ms = (_en: string, b: string) => b;

test("the reader re-exports the comparison sentences from contracts unchanged", () => {
  for (const name of [
    "READER_DISAGREE_PREFIX",
    "READER_UNIT_DISAGREE_PREFIX",
    "READER_ONE_READ_ROW",
    "READER_RENAMED_ROW",
    "READER_FACT_DISAGREE_PREFIX",
    "READER_ONE_READ_FACT",
    "READER_READ_ONCE",
  ] as const)
    assert.equal(
      (reader as Record<string, unknown>)[name],
      reasons[name],
      name,
    );
});

test("setup_read's SQL writes the same fallback and listed-twice sentences", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20261116110100_setup_read_worker.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const s of [
    `'${reasons.READER_LISTED_TWICE}'`,
    `'; ${reasons.READER_LISTED_TWICE}'`,
    `'${reasons.READER_ROW_UNSURE}'`,
    `'${reasons.READER_FACT_UNSURE}'`,
  ])
    assert.ok(sql.includes(s), s);
});

test("every whole fixed sentence is said in Bahasa Melayu", () => {
  for (const [name, text] of Object.entries(reasons)) {
    if (name.endsWith("_PREFIX") || name === "READER_NO_PRICE_AMOUNT") continue;
    const parts = reasonParts(text, ms);
    assert.equal(parts.length, 1, name);
    assert.equal(parts[0].own, true, name);
    assert.notEqual(parts[0].text, text, name);
  }
});
