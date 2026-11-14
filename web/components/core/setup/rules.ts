// Pure decisions of the guided setup screens, kept apart so they can be
// tested without a browser.

type TestLike = {
  id: string;
  source: "draft" | "published";
  turns: { state: string }[];
};

// Publish unlocks only from a draft test session created after the finish
// stage opened (not among the sessions listed then) that has a completed
// answer. No baseline (it could not be loaded) means no unlock.
export function unlocksPublish(
  baseline: ReadonlySet<string> | null,
  session: TestLike | null | undefined,
): boolean {
  return (
    !!baseline &&
    !!session &&
    !baseline.has(session.id) &&
    session.source === "draft" &&
    session.turns.some((t) => t.state === "completed")
  );
}

// Every 3 s for the first minute, then every 10 s.
export const pollDelay = (elapsedMs: number) =>
  elapsedMs < 60_000 ? 3000 : 10_000;

// The workspace name is offered only for a question that fills exactly one
// fact, business_name, and has no answer yet (no item, or a skipped one). A
// question that also asks something else is never prefilled, so Continue
// cannot keep half an answer.
export function namePrefill(
  fills: readonly string[],
  item: { state: string } | null | undefined,
  name: string,
): string {
  const answered = !!item && item.state !== "removed";
  const facts = fills.filter((f) => f.startsWith("facts."));
  return !answered && facts.length === 1 && facts[0] === "facts.business_name"
    ? name
    : "";
}

// "Use new" ids to send with applySetup: only conflicts whose item is still
// live (not removed since the choice was made).
export function replaceIds(
  conflicts: readonly { itemId: string }[],
  items: readonly { id: string; state: string }[],
  choices: Readonly<Record<string, "keep" | "new">>,
): string[] {
  return conflicts
    .filter(
      (c) =>
        choices[c.itemId] === "new" &&
        items.some((i) => i.id === c.itemId && i.state !== "removed"),
    )
    .map((c) => c.itemId);
}
