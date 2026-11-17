// Pure rules for the agent page: no React, no DOM, so they run under node:test.
import { agentSettings } from "../../../../packages/contracts/src/agent.ts";
import type {
  AgentChange,
  AgentSettings,
} from "../../../../packages/contracts/src/core.ts";
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

export type Interval = { start: string; end: string };
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
  if (!open.length) return { en: "Closed every day", ms: "Tutup setiap hari" };
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
  for (const key of Object.keys(
    agentSettings.shape,
  ) as (keyof AgentSettings)[]) {
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
// What a gap's draft becomes once its action ended: a stored save, a skip or
// a gap someone else already handled leave no text box, so the draft goes; a
// failed save or skip keeps the text.
export function draftsAfter(
  drafts: GapDrafts,
  id: string,
  outcome: "saved" | "skipped" | "handled" | "failed",
): GapDrafts {
  return outcome === "failed" ? drafts : dropDraft(drafts, id);
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
):
  | { kind: "retry"; revision: number }
  | { kind: "handled" }
  | { kind: "error" } {
  if (!fresh) return { kind: "error" };
  const g = fresh.find((x) => x.id === id);
  if (!g || g.status !== "open") return { kind: "handled" };
  return attempt === 0
    ? { kind: "retry", revision: g.revision }
    : { kind: "error" };
}

// ---- Opening hours ----
export type Preset = "everyday" | "weekdays" | "custom";
export type Closure = { date: string; reason: string };
export const closedWeek: Interval[][] = Array.from({ length: 7 }, () => []);
export const MAX_BLOCKS = 4;
export const MAX_CLOSURES = 366;
export const MAX_REASON = 300;

const clone = (blocks: Interval[]): Interval[] =>
  blocks.map((b) => ({ start: b.start, end: b.end }));
const same = (a: Interval[], b: Interval[]) =>
  a.length === b.length &&
  a.every((x, i) => x.start === b[i]!.start && x.end === b[i]!.end);

// The week as a shortcut chip: worked out from the blocks, never stored.
export function presetOf(weekdays: Interval[][]): Preset {
  if (weekdays.length !== 7) return "custom";
  const first = weekdays[0]!;
  if (!first.length) return "custom";
  const open = (d: number) =>
    weekdays[d]!.length > 0 && same(weekdays[d]!, first);
  const weekdaysOpen = [0, 1, 2, 3, 4].every(open);
  if (!weekdaysOpen) return "custom";
  if (!weekdays[5]!.length && !weekdays[6]!.length) return "weekdays";
  return open(5) && open(6) ? "everyday" : "custom";
}

// Fills the week from the first open day's blocks (09:00 to 17:00 when no
// day is open). Always returns new arrays.
export function applyPreset(
  weekdays: Interval[][],
  preset: "everyday" | "weekdays",
): Interval[][] {
  const source = weekdays.find((d) => d.length > 0);
  const blocks = source ?? [{ start: "09:00", end: "17:00" }];
  const days = preset === "everyday" ? 7 : 5;
  return Array.from({ length: 7 }, (_, d) => (d < days ? clone(blocks) : []));
}

// Day `from`'s blocks go to every day that is open now; closed days stay.
export function copyToOpenDays(
  weekdays: Interval[][],
  from: number,
): Interval[][] {
  const blocks = weekdays[from] ?? [];
  return weekdays.map((d, i) =>
    i === from ? clone(d) : d.length ? clone(blocks) : [],
  );
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const END = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
export const isStart = (t: string) => TIME.test(t);
export const isEnd = (t: string) => END.test(t);

// What a typed time becomes when the field loses focus. A phone's number
// pad has no colon, so "9", "900", "0900" and "1730" are read as times
// (hours 0 to 23, minutes 0 to 59), and "9:00" is "09:00". Anything else is
// left as typed so the owner sees it and fixes it.
export function normalizeTime(raw: string): string {
  const t = raw.trim();
  let h: string, m: string;
  if (/^\d{1,2}$/.test(t)) [h, m] = [t, "00"];
  else if (/^\d{3}$/.test(t)) [h, m] = [t.slice(0, 1), t.slice(1)];
  else if (/^\d{4}$/.test(t)) [h, m] = [t.slice(0, 2), t.slice(2)];
  else if (/^\d:[0-5]\d$/.test(t)) return "0" + t;
  else return t;
  if (Number(h) > 23 || Number(m) > 59) return t;
  return `${h.padStart(2, "0")}:${m}`;
}

// A day the server would refuse, by the first problem found. Only checks
// order and overlap on times that are well formed (see dayProblem).
export function dayError(
  blocks: Interval[],
): "order" | "overlap" | "tooMany" | null {
  if (blocks.length > MAX_BLOCKS) return "tooMany";
  if (blocks.some((b) => !(b.end > b.start))) return "order";
  for (let i = 1; i < blocks.length; i++)
    if (blocks[i]!.start < blocks[i - 1]!.end) return "overlap";
  return null;
}

// dayError plus "format": a time that is not hh:mm (an end may be 24:00).
export function dayProblem(
  blocks: Interval[],
): "format" | "order" | "overlap" | "tooMany" | null {
  if (blocks.some((b) => !isStart(b.start) || !isEnd(b.end))) return "format";
  return dayError(blocks);
}

// The block "Add hours" appends: it starts where the last one ends. None
// when the day already runs to midnight or its last time is not readable.
export function nextBlock(blocks: Interval[]): Interval | null {
  if (!blocks.length) return { start: "09:00", end: "17:00" };
  const last = blocks[blocks.length - 1]!;
  if (!isEnd(last.end) || last.end === "24:00") return null;
  const [h, m] = last.end.split(":").map(Number) as [number, number];
  const end =
    h + 4 >= 24
      ? "24:00"
      : `${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { start: last.end, end };
}

// Today's date in Kuala Lumpur as YYYY-MM-DD.
export function todayKL(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Why a closed date cannot be added: not a real date, in the past (before
// today in Kuala Lumpur), already listed, or the list is full.
export function closureProblem(
  date: string,
  existing: Closure[],
  today: string,
): "invalid" | "past" | "duplicate" | "full" | null {
  const real =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
  if (!real) return "invalid";
  if (date < today) return "past";
  if (existing.some((c) => c.date === date)) return "duplicate";
  if (existing.length >= MAX_CLOSURES) return "full";
  return null;
}

// What a save sends: every day the owner typed that can be sent, and the
// saved version of each day that cannot (listed in `invalid`).
export function weekToSend(
  draft: Interval[][],
  saved: Interval[][],
): { send: Interval[][]; invalid: number[] } {
  const invalid: number[] = [];
  const send = draft.map((blocks, d) => {
    if (dayProblem(blocks)) {
      invalid.push(d);
      return clone(saved[d] ?? []);
    }
    return clone(blocks);
  });
  return { send, invalid };
}

// After the server's week was read again: a day the owner did not touch
// (it still equals the week they started from) takes the server's version;
// a day with typed, unsaved changes keeps its text.
export function mergeWeek(
  before: Interval[][],
  draft: Interval[][],
  server: Interval[][],
): Interval[][] {
  return draft.map((blocks, d) =>
    same(blocks, before[d] ?? []) ? clone(server[d] ?? []) : blocks,
  );
}

// One day's blocks: equal times, whatever the order of a block's keys.
export const sameDay = same;
export const sameWeek = (a: Interval[][], b: Interval[][]) =>
  a.length === b.length && a.every((d, i) => same(d, b[i]!));
export const sameClosures = (a: Closure[], b: Closure[]) =>
  a.length === b.length &&
  a.every((c, i) => c.date === b[i]!.date && c.reason === b[i]!.reason);

// ---- Publish sheet ----

type Words = { en: string; ms: string };

export const SETTING_FIELDS: Record<keyof AgentSettings, Words> = {
  name: { en: "Name", ms: "Nama" },
  greeting: { en: "Greeting", ms: "Ucapan" },
  aiDisclosure: { en: "AI introduction", ms: "Pengenalan AI" },
  recordingEnabled: { en: "Recording", ms: "Rakaman" },
  recordingDisclosure: { en: "Recording notice", ms: "Notis rakaman" },
  languages: { en: "Languages", ms: "Bahasa" },
  manglish: { en: "Manglish", ms: "Manglish" },
  voicePreference: { en: "Voice", ms: "Suara" },
  instructions: { en: "Instructions", ms: "Arahan" },
};

const KIND_WORDS: Record<
  Exclude<AgentChange["kind"], "setting" | "hours" | "pack">,
  { one: Words; many: Words }
> = {
  knowledge: {
    one: { en: "Knowledge item", ms: "Item pengetahuan" },
    many: { en: "Knowledge items", ms: "Item pengetahuan" },
  },
  fact: {
    one: { en: "Fact", ms: "Fakta" },
    many: { en: "Facts", ms: "Fakta" },
  },
  rule: {
    one: { en: "Rule", ms: "Peraturan" },
    many: { en: "Rules", ms: "Peraturan" },
  },
  price: {
    one: { en: "Price", ms: "Harga" },
    many: { en: "Price list", ms: "Senarai harga" },
  },
};
const OP_EN = { added: "added", changed: "changed", removed: "removed" };
const OP_MS = { added: "ditambah", changed: "diubah", removed: "dibuang" };

// One line of the publish list, in both languages. A setting names its
// field only, never before or after text. `packName` gives a pack's display
// name when the page has it; the id is the fallback.
export function changeLine(
  change: AgentChange,
  packName?: (id: string) => string | undefined,
): Words {
  const { kind, op, label } = change;
  if (kind === "setting") {
    const f = (SETTING_FIELDS as Record<string, Words | undefined>)[label];
    return f
      ? { en: `${f.en} ${OP_EN[op]}`, ms: `${f.ms} ${OP_MS[op]}` }
      : { en: "Setting changed", ms: "Tetapan diubah" };
  }
  if (kind === "hours")
    return {
      en: `Opening hours changed: ${label}`,
      ms: `Waktu operasi diubah: ${label}`,
    };
  if (kind === "pack") {
    const name = packName?.(label) || label;
    if (op === "added")
      return {
        en: `Call type switched on: ${name}`,
        ms: `Jenis panggilan dihidupkan: ${name}`,
      };
    if (op === "removed")
      return {
        en: `Call type switched off: ${name}`,
        ms: `Jenis panggilan dimatikan: ${name}`,
      };
    return {
      en: `Call type changed: ${name}`,
      ms: `Jenis panggilan diubah: ${name}`,
    };
  }
  const words = KIND_WORDS[kind];
  if (change.count !== undefined && !label) {
    const n = change.count;
    const unit =
      kind === "price"
        ? { en: n === 1 ? "row" : "rows", ms: "baris" }
        : { en: n === 1 ? "item" : "items", ms: "item" };
    return {
      en: `${words.many.en} ${OP_EN[op]}, ${n} ${unit.en}`,
      ms: `${words.many.ms} ${OP_MS[op]}, ${n} ${unit.ms}`,
    };
  }
  return {
    en: `${words.one.en} ${OP_EN[op]}: ${label}`,
    ms: `${words.one.ms} ${OP_MS[op]}: ${label}`,
  };
}

const KIND_ORDER: AgentChange["kind"][] = [
  "setting",
  "hours",
  "pack",
  "knowledge",
  "fact",
  "rule",
  "price",
];
export const MAX_GROUP_LINES = 12;

export const KIND_HEADING: Record<AgentChange["kind"], Words> = {
  setting: { en: "Settings", ms: "Tetapan" },
  hours: { en: "Opening hours", ms: "Waktu operasi" },
  pack: { en: "Call types", ms: "Jenis panggilan" },
  knowledge: { en: "Knowledge", ms: "Pengetahuan" },
  fact: { en: "Facts", ms: "Fakta" },
  rule: { en: "Rules", ms: "Peraturan" },
  price: { en: "Prices", ms: "Harga" },
};

// Changes grouped by kind in a fixed order; a kind with more than 12 lines
// is collapsed to a count.
export function groupChanges(changes: AgentChange[]): {
  kind: AgentChange["kind"];
  lines: AgentChange[];
  collapsed: boolean;
}[] {
  return KIND_ORDER.flatMap((kind) => {
    const lines = changes.filter((c) => c.kind === kind);
    return lines.length
      ? [{ kind, lines, collapsed: lines.length > MAX_GROUP_LINES }]
      : [];
  });
}

// How many rows a group's lines stand for.
export const groupTotal = (lines: AgentChange[]): number =>
  lines.reduce((n, c) => n + (c.count ?? 1), 0);

export function missingDisclosure(
  s: AgentSettings,
): ("greeting" | "aiDisclosure" | "recordingDisclosure")[] {
  const out: ("greeting" | "aiDisclosure" | "recordingDisclosure")[] = [];
  if (!s.greeting.trim()) out.push("greeting");
  if (!s.aiDisclosure.trim()) out.push("aiDisclosure");
  if (s.recordingEnabled && !s.recordingDisclosure.trim())
    out.push("recordingDisclosure");
  return out;
}

// A question worth asking in a test after these changes, or null.
export function trySuggestion(changes: AgentChange[]): Words | null {
  if (changes.some((c) => c.kind === "hours"))
    return {
      en: "What time do you open on Saturday?",
      ms: "Pukul berapa anda buka pada hari Sabtu?",
    };
  if (changes.some((c) => c.kind === "fact" && c.op === "added"))
    return {
      en: "Ask the question you just answered.",
      ms: "Tanya soalan yang baru anda jawab.",
    };
  return null;
}

// publish refuses a draft that moved after the list was read. It is a plain
// refusal: the agent revision did not move, so it is not a CONFLICT and the
// queue must not treat it as someone else's edit.
export function isChangesMoved(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const x = e as { status?: unknown; code?: unknown };
  return x.status === 409 && x.code === "CHANGES_MOVED";
}

// Why the sheet does not offer Publish: "unsaved" (settings or hours the
// owner typed are not saved, so publishing would ship less) or "nothing"
// (a version is live and the draft equals it). Null: offer it.
export function publishBlock(s: {
  settingsUnsaved: boolean;
  hoursUnsaved: boolean;
  published: boolean;
  count: number;
}): "unsaved" | "nothing" | null {
  if (s.settingsUnsaved || s.hoursUnsaved) return "unsaved";
  if (s.published && s.count === 0) return "nothing";
  return null;
}

// What the publish job returns. A successful publish moves the agent
// revision by exactly one, so that is the answer; no later read, which could
// pick up another tab's save and skip a conflict. CHANGES_MOVED keeps the
// revision and marks the refusal; anything else is rethrown.
export async function runPublish(
  expectedRevision: number,
  token: string,
  send: (token: string) => Promise<unknown>,
): Promise<{ revision: number; refused: boolean }> {
  try {
    await send(token);
  } catch (e) {
    if (isChangesMoved(e)) return { revision: expectedRevision, refused: true };
    throw e;
  }
  return { revision: expectedRevision + 1, refused: false };
}
