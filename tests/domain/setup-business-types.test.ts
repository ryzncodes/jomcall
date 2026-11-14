import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessTypeText,
  businessTypes,
  typeIdForSaved,
} from "../../packages/domain/src/setup/business-types.ts";

test("the stored business type is the picked label, or the owner's own words for Something else", () => {
  assert.equal(businessTypeText("clinic", "ignored"), "Clinic or dental clinic");
  assert.equal(businessTypeText("other", "  Kedai bunga  "), "Kedai bunga");
  assert.equal(businessTypeText("other", "   "), "");
  assert.equal(businessTypeText("nope", "x"), "");
  // Never the "Something else" label itself.
  assert.notEqual(businessTypeText("other", "Kedai bunga"), "Something else");
});

test("the type to preselect comes from the stored text, not from the words typed", () => {
  for (const t of businessTypes) assert.equal(typeIdForSaved(t.en), t.id);
  // Own words were typed for Something else, whatever they say.
  assert.equal(typeIdForSaved("Kedai bunga"), "other");
  assert.equal(typeIdForSaved("Hair salon"), "other");
  assert.equal(typeIdForSaved(""), undefined);
  assert.equal(typeIdForSaved("  "), undefined);
  assert.equal(typeIdForSaved(undefined), undefined);
});
