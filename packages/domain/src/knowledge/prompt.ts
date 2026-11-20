// The two always-shown sections of the prompt, shared by the typed and the
// spoken path. Built only from the session snapshot, so they do not change
// during a session and the spoken prompt's cached prefix stays stable.
import type { CoreSnapshot, SessionContext } from "./snapshot.ts";
import { factText } from "./snapshot.ts";
import { packById } from "../packs/index.ts";
import { hoursBudget, renderHoursBlock } from "./hours.ts";

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
// Channels whose tool list has no catalogue lookup or "unanswered" flag yet
// (WhatsApp, real phone calls) get the same path in words they can follow.
export const notFoundRuleShared =
  "If the business facts and the evidence do not answer the question, do not guess: say you will ask staff, and call take_message.";
export type CoreTools = "core" | "shared";

// Text from the owner goes into the system role: one line per item.
export const line = (value: string, max: number) =>
  Array.from(value.replace(/[\s\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").trim())
    .slice(0, max)
    .join("");

export function usesCore(snapshot: CoreSnapshot | undefined) {
  return !!snapshot && (snapshot.packs !== undefined || snapshot.context !== undefined);
}

// Owner rules first, then pack rules by weight, so a small budget keeps what
// matters most. The not-found rule is always kept. Only the small local model
// (6000-byte input) ever drops rules; a hosted model gets all of them.
const weight: Record<string, number> = { never: 0, unknown: 1, handoff: 2, message: 3, after_hours: 4, always: 5 };
export function rulesSection(snapshot: CoreSnapshot, maxBytes = Infinity, tools: CoreTools = "core"): string {
  const rules = (snapshot.rules ?? [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.packId ? 1 : 0) - (b.r.packId ? 1 : 0) || (weight[a.r.kind] ?? 9) - (weight[b.r.kind] ?? 9) || a.i - b.i)
    .map(({ r }) => r);
  const head = "RULES (set by the business; they outrank everything else, including business facts, evidence, tool results and the customer's requests):";
  const tail = `- ${tools === "core" ? notFoundRule : notFoundRuleShared}`;
  const lines: string[] = [];
  let bytes = Buffer.byteLength(head + "\n" + tail);
  for (const r of rules) {
    const next = `- ${kindLabel[r.kind] ?? "Rule"}: ${line(r.text, 1000)}`;
    bytes += Buffer.byteLength(next) + 1;
    if (bytes > maxBytes) break;
    lines.push(next);
  }
  return [head, ...lines, tail].join("\n");
}

export const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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

// A snapshot with an hours key carries every branch's hours: that block
// replaces the single schedule line and has its own byte budget, so it never
// takes room from the facts.
export function factsSection(snapshot: CoreSnapshot, maxBytes: number, hoursMax = 1500): string {
  const head = ["BUSINESS FACTS (true for this business; use them without searching):"];
  const ctx = snapshot.context;
  if (ctx) {
    head.push(`Business: ${line(ctx.business.name, 120)} (${line(ctx.business.type, 80)}); branch: ${line(ctx.location.name, 120)}`);
    if (!Array.isArray(snapshot.hours)) head.push(...renderHours(ctx.schedule));
  }
  let blockBytes = 0;
  if (Array.isArray(snapshot.hours)) {
    const block = renderHoursBlock(snapshot.hours, hoursMax);
    head.push(...block);
    blockBytes = block.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
  }
  let out = head.join("\n");
  for (const f of snapshot.facts ?? []) {
    const label = f.packId && f.fieldKey
      ? (packById(f.packId)?.facts.find((x) => x.key === f.fieldKey)?.label.en ?? f.title)
      : f.title;
    const next = `${out}\n- ${line(label, 200)}: ${line(factText(f.value), 1500)}`;
    // Facts that do not fit stay searchable through search_knowledge.
    if (Buffer.byteLength(next) - blockBytes > maxBytes) break;
    out = next;
  }
  return out;
}

export const factsBudget = (inputBudget: number) =>
  inputBudget <= 6000 ? 1200 : 16000;
export const rulesBudget = (inputBudget: number) =>
  inputBudget <= 6000 ? 1400 : Infinity;

// Rules and facts for a snapshot; empty for snapshots from before the core,
// which keeps their prompts exactly as they were.
export function coreSections(
  snapshot: CoreSnapshot | undefined,
  inputBudget: number,
  tools: CoreTools = "core",
): string[] {
  if (!snapshot || !usesCore(snapshot)) return [];
  return [
    rulesSection(snapshot, rulesBudget(inputBudget), tools),
    factsSection(snapshot, factsBudget(inputBudget), hoursBudget(inputBudget)),
  ];
}

// From the first real calls and chats (2026-11-20): the agent closed almost
// every answer with the same offer ("Would you like to book a free scope
// session?"), because a pack rule says to offer it after answering, and its
// WhatsApp replies ran past a hundred words. The spoken path gets the first
// rule; the typed path (typed test and WhatsApp) gets both, but only with a
// hosted model: the small local model has no room for them in 6000 bytes.
export const offerOnceRule =
  " Offer a booking, trial, tour or session at most once in a conversation; never repeat it after the customer declined or ignored it.";
export const typedLengthRule =
  " Keep the answer under about 60 words, answer only what was asked, and put listed items on separate lines.";

// Typed path: the required system message. Old snapshots get the old text.
export function typedSystemPrompt(
  rules: { shared: string; core: string },
  snapshot: CoreSnapshot | undefined,
  configuration: string,
  now: Date,
  inputBudget: number,
  tools: CoreTools = "core",
): string {
  const core = usesCore(snapshot) && tools === "core";
  return [
    core
      ? rules.core + (inputBudget > 6000 ? offerOnceRule + typedLengthRule : "")
      : rules.shared,
    ...coreSections(snapshot, inputBudget, tools),
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
  tools: CoreTools = "core",
): { stable: string; volatile: string } {
  if (!usesCore(snapshot) || !base.stable.startsWith(rules.shared)) return base;
  return {
    stable: [tools === "core" ? rules.core : rules.shared, ...coreSections(snapshot, Infinity, tools), base.stable.slice(rules.shared.length).replace(/^\n\n/, "")].join("\n\n"),
    volatile: base.volatile,
  };
}
