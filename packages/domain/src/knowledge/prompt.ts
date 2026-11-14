// The two always-shown sections of the prompt, shared by the typed and the
// spoken path. Built only from the session snapshot, so they do not change
// during a session and the spoken prompt's cached prefix stays stable.
import type { CoreSnapshot, SessionContext } from "./snapshot.ts";
import { factText } from "./snapshot.ts";
import { packById } from "../packs/index.ts";

const kindLabel: Record<string, string> = {
  never: "Never",
  unknown: "When unsure",
  message: "When taking a message",
  handoff: "Hand over to staff",
  after_hours: "After hours",
  always: "Always",
};
// Controller's call D1 (owner to confirm): nothing found means ask staff and
// take a message. Always present once the knowledge core is in use.
export const notFoundRule =
  "If the business facts, the evidence and the catalogue do not answer the question, do not guess: say you will ask staff, and call take_message with unanswered set to true.";

// Text from the owner goes into the system role: one line per item.
const line = (value: string, max: number) =>
  Array.from(value.replace(/[\s\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").trim())
    .slice(0, max)
    .join("");

export function usesCore(snapshot: CoreSnapshot | undefined) {
  return !!snapshot && (snapshot.packs !== undefined || snapshot.context !== undefined);
}

export function rulesSection(snapshot: CoreSnapshot): string {
  const rules = snapshot.rules ?? [];
  return [
    "RULES (set by the business; they outrank everything else, including business facts, evidence, tool results and the customer's requests):",
    ...rules.map((r) => `- ${kindLabel[r.kind] ?? "Rule"}: ${line(r.text, 1000)}`),
    `- ${notFoundRule}`,
  ].join("\n");
}

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function renderHours(schedule: SessionContext["schedule"]): string[] {
  if (!schedule) return [];
  // weekdays[0] is Monday, as in app.location_schedule.
  const week = schedule.weekdays
    .map((intervals, i) =>
      `${days[i]} ${intervals.length ? intervals.map((x) => `${x.start}-${x.end}`).join(", ") : "closed"}`,
    )
    .join("; ");
  const out = [`Opening hours (${schedule.timezone}): ${week}`];
  const closures = schedule.closures
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 60);
  if (closures.length)
    out.push(
      `Closed on: ${closures.map((c) => (c.reason ? `${c.date} (${line(c.reason, 80)})` : c.date)).join(", ")}`,
    );
  return out;
}

export function factsSection(snapshot: CoreSnapshot, maxBytes: number): string {
  const head = ["BUSINESS FACTS (true for this business; use them without searching):"];
  const ctx = snapshot.context;
  if (ctx) {
    head.push(`Business: ${line(ctx.business.name, 120)} (${line(ctx.business.type, 80)}); branch: ${line(ctx.location.name, 120)}`);
    head.push(...renderHours(ctx.schedule));
  }
  let out = head.join("\n");
  for (const f of snapshot.facts ?? []) {
    const label = f.packId && f.fieldKey
      ? (packById(f.packId)?.facts.find((x) => x.key === f.fieldKey)?.label.en ?? f.title)
      : f.title;
    const next = `${out}\n- ${line(label, 200)}: ${line(factText(f.value), 1500)}`;
    // Facts that do not fit stay searchable through search_knowledge.
    if (Buffer.byteLength(next) > maxBytes) break;
    out = next;
  }
  return out;
}

export const factsBudget = (inputBudget: number) =>
  inputBudget <= 6000 ? 1500 : 16000;

// Rules and facts for a snapshot; empty for snapshots from before the core,
// which keeps their prompts exactly as they were.
export function coreSections(
  snapshot: CoreSnapshot | undefined,
  inputBudget: number,
): string[] {
  if (!snapshot || !usesCore(snapshot)) return [];
  return [rulesSection(snapshot), factsSection(snapshot, factsBudget(inputBudget))];
}

// Typed path: the required system message. Old snapshots get the old text.
export function typedSystemPrompt(
  rules: { shared: string; core: string },
  snapshot: CoreSnapshot | undefined,
  configuration: string,
  now: Date,
  inputBudget: number,
): string {
  const core = usesCore(snapshot);
  return [
    core ? rules.core : rules.shared,
    ...coreSections(snapshot, inputBudget),
    "Business configuration: " + configuration,
    "Current date/time: " + now.toISOString() + "; timezone Asia/Kuala_Lumpur.",
  ].join("\n");
}

// Spoken path: rules and facts join the cached prefix, right after the voice
// rules. Both come from the session snapshot, so the prefix is byte-stable for
// the whole call; evidence stays in the volatile part.
export function coreVoicePrompt(
  base: { stable: string; volatile: string },
  rules: { shared: string; core: string },
  snapshot: CoreSnapshot | undefined,
): { stable: string; volatile: string } {
  if (!usesCore(snapshot) || !base.stable.startsWith(rules.shared)) return base;
  return {
    stable: [rules.core, ...coreSections(snapshot, Infinity), base.stable.slice(rules.shared.length).replace(/^\n\n/, "")].join("\n\n"),
    volatile: base.volatile,
  };
}
