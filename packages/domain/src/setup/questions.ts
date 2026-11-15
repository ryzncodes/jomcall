// The short setup interview, built from the pattern packs' own interview
// lists. Pure functions, no database. At most MAX_QUESTIONS questions.
import { basePack, packById, type Pack } from "../packs/index.ts";

export type SetupQuestion = {
  id: string;
  kind: "hours" | "first_words" | "fact";
  en: string;
  ms: string;
  fills: string[];
};
type Input = {
  mainPack: string;
  extraPacks: string[];
  filled: ReadonlySet<string>;
};

export const MAX_QUESTIONS = 8;

export function factKeyOf(question: SetupQuestion): string | null {
  const hit = question.fills.find((f) => f.startsWith("facts."));
  return hit ? hit.slice("facts.".length) : null;
}

// Base pack, then main, then extras; each pack once.
function orderedPacks(input: Pick<Input, "mainPack" | "extraPacks">): Pack[] {
  const ids = [basePack, input.mainPack, ...input.extraPacks];
  const out: Pack[] = [];
  for (const id of ids) {
    if (out.some((p) => p.id === id)) continue;
    const pack = packById(id);
    if (!pack) throw new Error(`unknown pack ${id}`);
    out.push(pack);
  }
  return out;
}

export function setupQuestions(input: Input): SetupQuestion[] {
  const head: SetupQuestion[] = input.filled.has("schedule")
    ? []
    : [
        {
          id: "hours",
          kind: "hours",
          en: "When are you open?",
          ms: "Bila anda buka?",
          fills: ["schedule"],
        },
      ];
  const tail: SetupQuestion[] = input.filled.has("settings")
    ? []
    : [
        {
          id: "first_words",
          kind: "first_words",
          en: "What should the agent say first when it answers?",
          ms: "Apa yang ejen patut sebut dahulu apabila menjawab?",
          fills: ["settings"],
        },
      ];
  const budget = MAX_QUESTIONS - head.length - tail.length;

  // Candidates per pack: in `order`, only questions that fill a fact (an
  // answer with no fact has nowhere to be stored) and whose fact is not filled.
  const packsInOrder = orderedPacks(input);
  const candidates = packsInOrder.map((pack) => {
    const list: SetupQuestion[] = [];
    for (const q of [...pack.interview].sort((a, b) => a.order - b.order)) {
      const question: SetupQuestion = {
        id: `${pack.id}:${q.order}`,
        kind: "fact",
        en: q.en,
        ms: q.ms,
        fills: [...q.fills],
      };
      const key = factKeyOf(question);
      // Saved hours make a text question that fills only opening_hours moot.
      const onlyHours =
        question.fills.length === 1 && question.fills[0] === "facts.opening_hours";
      if (onlyHours && input.filled.has("schedule")) continue;
      if (key && !input.filled.has(key)) list.push(question);
    }
    return list;
  });

  // Cut to the budget fairly: round-robin, main pack first, then base, then
  // the extras, so a long base list cannot crowd out business-specific
  // questions. A fact key is marked asked only when its question is kept, so
  // a later pack can still ask a fact whose earlier question was cut.
  const main = packsInOrder.findIndex((p) => p.id === input.mainPack);
  const priority = [
    main,
    ...packsInOrder.map((_, i) => i).filter((i) => i !== main),
  ];
  const kept: SetupQuestion[][] = candidates.map(() => []);
  const next = candidates.map(() => 0);
  const asked = new Set<string>();
  let total = 0;
  for (let progress = true; progress && total < budget; ) {
    progress = false;
    for (const i of priority) {
      if (total >= budget) break;
      const list = candidates[i]!;
      while (next[i]! < list.length) {
        const q = list[next[i]!++]!;
        const key = factKeyOf(q)!;
        if (asked.has(key)) continue;
        asked.add(key);
        kept[i]!.push(q);
        total++;
        progress = true;
        break;
      }
    }
  }
  const middle = kept.flat();
  return [...head, ...middle, ...tail];
}

// Required facts not yet filled. A fact key that several active packs
// require is listed once (staged answers are one row per key): under the pack
// named in `prefer` when that pack requires it, else the first pack in order.
export function missingFacts(
  input: Input & { prefer?: ReadonlyMap<string, string> },
): { pack: string; key: string; en: string; ms: string }[] {
  const packs = orderedPacks(input);
  const owner = new Map<string, string>();
  for (const pack of packs)
    for (const f of pack.facts)
      if (f.required && !input.filled.has(f.key))
        if (!owner.has(f.key) || input.prefer?.get(f.key) === pack.id)
          owner.set(f.key, pack.id);
  const out: { pack: string; key: string; en: string; ms: string }[] = [];
  for (const pack of packs)
    for (const f of pack.facts)
      if (f.required && owner.get(f.key) === pack.id)
        out.push({ pack: pack.id, key: f.key, en: f.label.en, ms: f.label.ms });
  return out;
}

// Rebuild a question from its id (the id of a frozen list entry). Null when
// the id names nothing: unknown pack, missing order, or a malformed id.
export function questionById(id: string): SetupQuestion | null {
  const hours = setupQuestions({
    mainPack: basePack,
    extraPacks: [],
    filled: new Set(),
  });
  const fixed = hours.find((q) => q.id === id && q.kind !== "fact");
  if (fixed) return fixed;
  const m = id.match(/^([a-z][a-z0-9-]{1,40}):(\d{1,3})$/);
  if (!m) return null;
  const pack = packById(m[1]!);
  const q = pack?.interview.find((x) => x.order === Number(m[2]));
  if (!pack || !q) return null;
  const question: SetupQuestion = {
    id,
    kind: "fact",
    en: q.en,
    ms: q.ms,
    fills: [...q.fills],
  };
  return factKeyOf(question) ? question : null;
}
