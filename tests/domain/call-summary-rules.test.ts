// What the call page shows for a call's AI summary. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { summaryView } from "../../web/lib/core/call-summary-rules.ts";
import type { CallAiSummary } from "../../packages/contracts/src/phone.ts";

const NOW = Date.parse("2026-11-26T10:00:00Z");
const row = (o: Partial<CallAiSummary> = {}): CallAiSummary => ({
  state: "done",
  reason_en: "Asked about opening hours",
  reason_ms: "Bertanya waktu operasi",
  outcome_en: "Hours given",
  outcome_ms: "Waktu diberi",
  next_step_en: null,
  next_step_ms: null,
  edited: false,
  created_at: "2026-11-26T09:58:00Z",
  completed_at: "2026-11-26T09:59:00Z",
  revision: 1,
  ...o,
});

test("no summary or skipped is hidden", () => {
  assert.deepEqual(summaryView(null, "en", NOW), { kind: "hidden" });
  assert.deepEqual(summaryView(row({ state: "skipped" }), "en", NOW), { kind: "hidden" });
});

test("pending and running read as writing when young", () => {
  for (const state of ["pending", "running"] as const)
    assert.deepEqual(summaryView(row({ state }), "en", NOW), { kind: "writing" });
});

test("old pending reads as hidden", () => {
  const created_at = new Date(NOW - 11 * 60_000).toISOString();
  assert.deepEqual(summaryView(row({ state: "pending", created_at }), "en", NOW), { kind: "hidden" });
  assert.deepEqual(summaryView(row({ state: "running", created_at }), "ms", NOW), { kind: "hidden" });
});

test("failed is unavailable", () => {
  assert.deepEqual(summaryView(row({ state: "failed" }), "en", NOW), { kind: "unavailable" });
});

test("done shows the viewer's language", () => {
  assert.deepEqual(summaryView(row(), "en", NOW), {
    kind: "shown",
    reason: "Asked about opening hours",
    outcome: "Hours given",
    nextStep: null,
    edited: false,
    cleared: false,
  });
  const ms = summaryView(row({ edited: true, next_step_ms: "Hubungi balik" }), "ms", NOW);
  assert.deepEqual(ms, {
    kind: "shown",
    reason: "Bertanya waktu operasi",
    outcome: "Waktu diberi",
    nextStep: "Hubungi balik",
    edited: true,
    cleared: false,
  });
});

test("a cleared row has all six fields empty", () => {
  const v = summaryView(
    row({
      edited: true,
      reason_en: null,
      reason_ms: null,
      outcome_en: null,
      outcome_ms: null,
    }),
    "en",
    NOW,
  );
  assert.equal(v.kind, "shown");
  assert.equal((v as { cleared: boolean }).cleared, true);
});
