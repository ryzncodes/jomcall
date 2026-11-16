// Pure rules behind the WhatsApp template list.
import test from "node:test";
import assert from "node:assert/strict";
import {
  syncLine,
  templateNote,
} from "../../web/lib/core/whatsapp-template-rules.ts";

const at = "2026-11-16T03:00:00.000Z";

const now = new Date("2026-11-16T03:02:00.000Z");

test("a claimed check reads as checking, then as failed after five minutes", () => {
  assert.equal(syncLine(at, "TEMPLATE_SYNC_PENDING", true, now), "checking");
  // Exactly five minutes is still checking; more is failed.
  assert.equal(
    syncLine("2026-11-16T02:57:00.000Z", "TEMPLATE_SYNC_PENDING", true, now),
    "checking",
  );
  assert.equal(
    syncLine("2026-11-16T02:56:59.000Z", "TEMPLATE_SYNC_PENDING", true, now),
    "failed",
  );
  assert.equal(syncLine(null, "TEMPLATE_SYNC_PENDING", true, now), "failed");
  assert.equal(syncLine(at, "META_190", true, now), "failed");
  assert.equal(syncLine(null, "TEMPLATE_SYNC_STALE", true, now), "failed");
  assert.equal(syncLine(at, null, true, now), "checked");
  assert.equal(syncLine(null, null, true, now), null);
});

test("no sync line when the channel is not connected", () => {
  assert.equal(syncLine(at, null, false, now), null);
  assert.equal(syncLine(at, "TEMPLATE_SYNC_PENDING", false, now), null);
  assert.equal(syncLine(at, "META_190", false, now), null);
});

test("each template says what WhatsApp said of it", () => {
  const t = (provider_status: string | null) => ({ provider_status });
  assert.equal(templateNote(t("NOT_FOUND"), at, null, true, now), "not_found");
  assert.equal(templateNote(t("NOT_FOUND"), at, "META_190", true, now), "not_found");
  assert.equal(templateNote(t("APPROVED"), at, null, true, now), "from_provider");
  // Never listed: said only after a check that succeeded.
  assert.equal(templateNote(t(null), at, null, true, now), "not_listed");
  assert.equal(templateNote(t(null), at, "TEMPLATE_SYNC_PENDING", true, now), null);
  assert.equal(templateNote(t(null), at, "META_190", true, now), null);
  assert.equal(templateNote(t(null), null, null, true, now), null);
  assert.equal(templateNote(t(null), at, null, false, now), null);
});
