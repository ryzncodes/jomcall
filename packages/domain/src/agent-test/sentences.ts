// Splits streamed model text into sentences that can be spoken as soon as
// they are complete. The unfinished tail is returned so the caller can keep
// appending to it.
const MIN_LENGTH = 12;
const MIN_LENGTH_CJK = 2;
const CJK_END = "。！？";
const CLOSERS = new Set(['"', "'", ")", "”", "’", "」", "』", "）"]);

export function splitSentences(buffer: string): {
  sentences: string[];
  rest: string;
} {
  const chars = Array.from(buffer);
  const sentences: string[] = [];
  let start = 0;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    const cjk = CJK_END.includes(ch);
    const ascii = ch === "." || ch === "!" || ch === "?";
    if (!cjk && !ascii) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < chars.length && CLOSERS.has(chars[end + 1])) end++;
    const next = chars[end + 1];
    // A "." inside a number or abbreviation has no space after it, and a "."
    // at the very end may still be the start of "80.50".
    const complete = cjk
      ? true
      : ch === "."
        ? next !== undefined && /\s/.test(next)
        : next === undefined || /\s/.test(next);
    if (complete) {
      const candidate = chars
        .slice(start, end + 1)
        .join("")
        .trim();
      const min = cjk ? MIN_LENGTH_CJK : MIN_LENGTH;
      if (Array.from(candidate).length >= min) {
        sentences.push(candidate);
        start = end + 1;
      }
    }
    i = end + 1;
  }
  return { sentences, rest: chars.slice(start).join("").trimStart() };
}
