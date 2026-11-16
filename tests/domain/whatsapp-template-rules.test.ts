// Pure rules behind the WhatsApp template list.
import test from "node:test";
import assert from "node:assert/strict";
import {
  syncLine,
  templateNote,
} from "../../web/lib/core/whatsapp-template-rules.ts";

const at = "2026-11-16T03:00:00.000Z";

test("a claimed check reads as checking, not as a failure", () => {
  assert.equal(syncLine(at, "TEMPLATE_SYNC_PENDING"), "checking");
  assert.equal(syncLine(null, "TEMPLATE_SYNC_PENDING"), "checking");
  assert.equal(syncLine(at, "META_190"), "failed");
  assert.equal(syncLine(null, "TEMPLATE_SYNC_STALE"), "failed");
  assert.equal(syncLine(at, null), "checked");
  assert.equal(syncLine(null, null), null);
});

test("each template says what WhatsApp said of it", () => {
  const t = (provider_status: string | null) => ({ provider_status });
  assert.equal(templateNote(t("NOT_FOUND"), at, null), "not_found");
  assert.equal(templateNote(t("NOT_FOUND"), at, "META_190"), "not_found");
  assert.equal(templateNote(t("APPROVED"), at, null), "from_provider");
  // Never listed: said only after a check that succeeded.
  assert.equal(templateNote(t(null), at, null), "not_listed");
  assert.equal(templateNote(t(null), at, "TEMPLATE_SYNC_PENDING"), null);
  assert.equal(templateNote(t(null), at, "META_190"), null);
  assert.equal(templateNote(t(null), null, null), null);
});
