// Pure rules for the agent page: no React, no DOM, so they run under node:test.
import { agentSettings } from "../../../../packages/contracts/src/agent.ts";
import type { AgentSettings } from "../../../../packages/contracts/src/core.ts";
import { voiceFor } from "../../../../packages/contracts/src/voices.ts";

// An empty, old free-text or unknown voice is the voice the picker shows.
export const withVoice = (s: AgentSettings): AgentSettings => ({
  ...s,
  voicePreference: voiceFor(s.voicePreference),
});

export type View =
  | "home"
  | "questions"
  | "knowledge"
  | "hours"
  | "greeting"
  | "more"
  | "publish";
const VIEWS: View[] = [
  "questions",
  "knowledge",
  "hours",
  "greeting",
  "more",
  "publish",
];

// "#hours" gives "hours"; anything else gives "home".
export function viewOf(hash: string): View {
  const name = hash.replace(/^#/, "");
  return (VIEWS as string[]).includes(name) ? (name as View) : "home";
}

export type Status = {
  state: "unpublished" | "live" | "pending";
  changes: number;
};
export function statusOf(
  publishedVersionId: string | null,
  changes: number,
): Status {
  if (!publishedVersionId) return { state: "unpublished", changes };
  return { state: changes > 0 ? "pending" : "live", changes };
}

type Interval = { start: string; end: string };
const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_MS = ["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Aha"];
const clock = (t: string) => t.replace(/^0/, "");

// weekdays[0] is Monday.
export function weekSummary(weekdays: Interval[][] | null): {
  en: string;
  ms: string;
} {
  if (!weekdays)
    return { en: "Hours not set yet", ms: "Waktu belum ditetapkan" };
  const open = weekdays
    .map((blocks, i) => ({ blocks, i }))
    .filter((d) => d.blocks.length > 0);
  if (!open.length)
    return { en: "Closed every day", ms: "Tutup setiap hari" };
  const key = (b: Interval[]) => JSON.stringify(b.map((x) => [x.start, x.end]));
  if (open.some((d) => key(d.blocks) !== key(open[0]!.blocks)))
    return { en: "Hours vary by day", ms: "Waktu berbeza mengikut hari" };
  const idx = open.map((d) => d.i);
  const contiguous = idx.every((v, n) => n === 0 || v === idx[n - 1]! + 1);
  const range = (names: string[], joiner: string) =>
    contiguous && idx.length > 1
      ? `${names[idx[0]!]} ${joiner} ${names[idx.at(-1)!]}`
      : idx.map((i) => names[i]).join(", ");
  const times = (joiner: string) =>
    open[0]!.blocks
      .map((b) => `${clock(b.start)} ${joiner} ${clock(b.end)}`)
      .join(", ");
  return {
    en: `${range(DAYS_EN, "to")} ${times("to")}`,
    ms: `${range(DAYS_MS, "hingga")} ${times("hingga")}`,
  };
}

// Each field that agentSettings refuses is replaced by its last valid value
// in what is sent, and listed in `invalid`.
export function validSettings(
  next: AgentSettings,
  lastValid: AgentSettings,
): { send: AgentSettings; invalid: (keyof AgentSettings)[] } {
  const send = { ...withVoice(next) } as Record<string, unknown>;
  const invalid: (keyof AgentSettings)[] = [];
  for (const key of Object.keys(agentSettings.shape) as (keyof AgentSettings)[]) {
    const field = agentSettings.shape[key] as {
      safeParse: (v: unknown) => { success: boolean };
    };
    if (!field.safeParse(next[key]).success) {
      invalid.push(key);
      send[key] = lastValid[key];
    }
  }
  return { send: send as AgentSettings, invalid };
}

export function sameSettings(a: AgentSettings, b: AgentSettings): boolean {
  const keys = Object.keys(agentSettings.shape) as (keyof AgentSettings)[];
  return keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

// After a conflict: the server's settings, except the fields the owner is
// typing in or typed in whose send has not settled yet (kept).
export function afterConflict(
  server: AgentSettings,
  local: AgentSettings,
  kept: keyof AgentSettings | null | Iterable<keyof AgentSettings>,
): AgentSettings {
  const fields: (keyof AgentSettings)[] =
    kept === null
      ? []
      : typeof kept === "string"
        ? [kept]
        : [...(kept as Iterable<keyof AgentSettings>)];
  const out = { ...server } as Record<string, unknown>;
  for (const f of fields) out[f] = local[f];
  return out as AgentSettings;
}

// Which line the save line shows. "Saving…" wins while a save is in flight
// and no newer edit waits; "Not saved yet" is an invalid field, an edit not
// sent yet, or an edit left unsaved outside a send (a kept field after a
// conflict).
export function saveLineOf(s: {
  status: "idle" | "saving" | "saved" | "error" | "conflict";
  invalid: readonly string[];
  waiting: boolean;
  unsaved: boolean;
}): "none" | "saving" | "saved" | "notSaved" | "error" {
  if (s.status === "error") return "error";
  if (s.invalid.length || s.waiting) return "notSaved";
  if (s.status === "saving") return "saving";
  if (s.unsaved) return "notSaved";
  return s.status === "saved" ? "saved" : "none";
}

// The title of a fact made from an answered gap. It comes from the owner
// (the topic, else the start of the answer), never from the customer's
// question, so customer words are not copied into a published version.
export function gapTitle(topic: string, answer: string): string {
  const t = topic.trim();
  if (t) return t.slice(0, 200);
  return answer.replace(/\s+/g, " ").trim().slice(0, 60);
}

const CHANNEL_WORDS: Record<string, { en: string; ms: string }> = {
  text: { en: "Typed test", ms: "Ujian taip" },
  voice: { en: "Voice test", ms: "Ujian suara" },
  phone: { en: "Phone", ms: "Telefon" },
  whatsapp: { en: "WhatsApp", ms: "WhatsApp" },
};
// Names the channels a question was asked on; unknown values are dropped.
export function channelWords(channels: string[]): { en: string; ms: string } {
  const known = [...new Set(channels)]
    .map((c) => CHANNEL_WORDS[c])
    .filter((c): c is { en: string; ms: string } => !!c);
  return {
    en: known.map((c) => c.en).join(", "),
    ms: known.map((c) => c.ms).join(", "),
  };
}

// A 409 on resolving a gap is either a stale gap (someone answered or skipped
// it) or a stale agent revision. Both look the same, so the draft is read
// again: when its revision is still the one that was sent, the agent did not
// move and the gap is the stale part.
export function gapConflictKind(
  sentRevision: number,
  draftRevision: number,
): "gap" | "agent" {
  return draftRevision === sentRevision ? "gap" : "agent";
}

// Typed text per gap id, kept by the view so a list reload or a remount
// never loses it. Only dropDraft removes one, after its save was stored.
export type GapDraft = { answer: string; topic: string };
export type GapDrafts = Record<string, GapDraft>;
export function setDraft(
  drafts: GapDrafts,
  id: string,
  part: Partial<GapDraft>,
): GapDrafts {
  const cur = drafts[id] ?? { answer: "", topic: "" };
  return { ...drafts, [id]: { ...cur, ...part } };
}
export function dropDraft(drafts: GapDrafts, id: string): GapDrafts {
  const { [id]: _gone, ...rest } = drafts;
  return rest;
}

// After a 409 on a gap write that did not move the agent: the fresh list of
// open gaps says what happened. A gap still open only had a newer ask, so
// the same action is tried once more with its fresh revision; a gap that is
// not open any more was handled by someone else. No fresh list, or a second
// failure, is an error the card shows with the text kept.
export function gapConflictAction(
  fresh: { id: string; status: string; revision: number }[] | undefined,
  id: string,
  attempt: number,
): { kind: "retry"; revision: number } | { kind: "handled" } | { kind: "error" } {
  if (!fresh) return { kind: "error" };
  const g = fresh.find((x) => x.id === id);
  if (!g || g.status !== "open") return { kind: "handled" };
  return attempt === 0 ? { kind: "retry", revision: g.revision } : { kind: "error" };
}
