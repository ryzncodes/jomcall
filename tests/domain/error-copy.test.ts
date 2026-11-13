import test from "node:test";
import assert from "node:assert/strict";
import { contextCopy } from "../../web/components/core/error-copy.ts";

test("a voice test refused for a missing AI introduction says so, not 'before publishing'", () => {
  const copy = contextCopy("DISCLOSURE_REQUIRED", "voice");
  assert.ok(copy);
  const [en, ms] = copy;
  assert.match(en, /AI introduction/);
  assert.match(en, /voice test/);
  assert.doesNotMatch(en, /publish/i);
  assert.match(ms, /pengenalan AI/);
  assert.match(ms, /ujian suara/);
  assert.doesNotMatch(ms, /terbit/i);
});

test("other codes and other screens keep the shared wording", () => {
  assert.equal(contextCopy("DISCLOSURE_REQUIRED", undefined), undefined);
  assert.equal(contextCopy("CONFLICT", "voice"), undefined);
});
