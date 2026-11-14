// The short setup interview, built from the pattern packs' own interview
// lists. Pure functions, no database. At most MAX_QUESTIONS questions.
import { activePacks, basePack, packById, type Pack } from "../packs/index.ts";

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
          ms: "Apa yang agen patut sebut dahulu apabila menjawab?",
          fills: ["settings"],
        },
      ];
  const budget = MAX_QUESTIONS - head.length - tail.length;

  // Candidates per pack: in `order`, skipping filled facts and a second
  // question about a fact already asked.
  const seen = new Set<string>();
  const candidates = orderedPacks(input).map((pack) => {
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
      if (key && (input.filled.has(key) || seen.has(key))) continue;
      if (key) seen.add(key);
      list.push(question);
    }
    return list;
  });

  // Cut to the budget fairly: round-robin, main pack first, so a long base
  // pack list cannot crowd out the business-specific questions.
  const priority = candidates.map((_, i) => i);
  if (priority.length > 1) priority.unshift(priority.splice(1, 1)[0]!);
  const taken = candidates.map(() => 0);
  let total = 0;
  for (let progress = true; progress && total < budget; ) {
    progress = false;
    for (const i of priority) {
      if (total >= budget) break;
      if (taken[i]! < candidates[i]!.length) {
        taken[i]!++;
        total++;
        progress = true;
      }
    }
  }
  const middle = candidates.flatMap((list, i) => list.slice(0, taken[i]));
  return [...head, ...middle, ...tail];
}

export function missingFacts(
  input: Input,
): { pack: string; key: string; en: string; ms: string }[] {
  const out: { pack: string; key: string; en: string; ms: string }[] = [];
  for (const pack of activePacks([input.mainPack, ...input.extraPacks]))
    for (const f of pack.facts)
      if (f.required && !input.filled.has(f.key))
        out.push({ pack: pack.id, key: f.key, en: f.label.en, ms: f.label.ms });
  return out;
}
