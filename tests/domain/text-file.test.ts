import { test } from "node:test";
import assert from "node:assert/strict";
import { readKnowledgeText } from "../../web/lib/core/text-file.ts";
test("knowledge import rejects invalid UTF-8 without changing its prior content", async () => {
  let draft = "Existing trusted draft";
  await assert.rejects(async () => {
    draft = await readKnowledgeText(
      new Blob([new Uint8Array([0x43, 0x61, 0x66, 0xe9])]),
    );
  }, /UTF|encoded data/);
  assert.equal(draft, "Existing trusted draft");
  assert.equal(
    await readKnowledgeText(new Blob(["Bahasa Melayu, 中文, Café"])),
    "Bahasa Melayu, 中文, Café",
  );
});
