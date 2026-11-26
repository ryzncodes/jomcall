// What the call page shows for a call's AI summary: nothing, "writing",
// "not available", or the three lines in the viewer's language.
import type { CallAiSummary } from "../../../packages/contracts/src/phone";

export type SummaryView =
  | { kind: "hidden" }
  | { kind: "writing" }
  | { kind: "unavailable" }
  | {
      kind: "shown";
      reason: string | null;
      outcome: string | null;
      nextStep: string | null;
      edited: boolean;
      cleared: boolean;
    };

// A summary still queued or running after this long means the writer is off
// or stuck; the page then says nothing rather than "writing" for ever.
export const WRITING_MAX_MS = 10 * 60_000;

export function summaryView(s: CallAiSummary | null, lang: "en" | "ms", now: number): SummaryView {
  if (!s || s.state === "skipped") return { kind: "hidden" };
  if (s.state === "pending" || s.state === "running")
    return now - Date.parse(s.created_at) < WRITING_MAX_MS ? { kind: "writing" } : { kind: "hidden" };
  if (s.state === "failed") return { kind: "unavailable" };
  const cleared = [s.reason_en, s.reason_ms, s.outcome_en, s.outcome_ms, s.next_step_en, s.next_step_ms].every(
    (v) => v === null,
  );
  const ms = lang === "ms";
  return {
    kind: "shown",
    reason: ms ? s.reason_ms : s.reason_en,
    outcome: ms ? s.outcome_ms : s.outcome_en,
    nextStep: ms ? s.next_step_ms : s.next_step_en,
    edited: s.edited,
    cleared,
  };
}
