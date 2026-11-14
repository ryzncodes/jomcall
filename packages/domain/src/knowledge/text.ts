import { createHash } from "node:crypto";

export const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

// A lookup key is a code in upper case with letters and digits only:
// "ns-60 l" and "NS60L" both become "NS60L".
export const normaliseCode = (text: string) =>
  text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

// Keys come from every alias and from tokens of the item name that look like
// codes (contain a digit), plus the whole item name squashed.
export function lookupKeys(item: string, aliases: string[]): string[] {
  const keys = new Set<string>();
  for (const text of [item, ...aliases]) {
    const whole = normaliseCode(text);
    if (whole && whole.length <= 60) keys.add(whole);
    for (const token of text.split(/[\s,/()]+/))
      if (/\d/.test(token)) {
        const k = normaliseCode(token);
        if (k.length >= 2) keys.add(k);
      }
  }
  return [...keys].slice(0, 40);
}

const flat = (value: unknown): string[] =>
  value === null || value === undefined
    ? []
    : Array.isArray(value)
      ? value.flatMap(flat)
      : typeof value === "object"
        ? Object.values(value as object).flatMap(flat)
        : typeof value === "string"
          ? [value]
          : [];

export function catalogueSearchText(
  item: string,
  aliases: string[],
  attributes: Record<string, unknown>,
): string {
  return Array.from(
    [item, ...aliases, ...flat(attributes)]
      .join(" ")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 2000)
    .join("");
}

export const formatSen = (sen: number | null | undefined) =>
  sen === null || sen === undefined
    ? null
    : `RM ${Math.floor(sen / 100).toLocaleString("en-MY")}.${String(sen % 100).padStart(2, "0")}`;

// Gap dedupe: same words, same question.
export const questionKey = (question: string) =>
  sha256(
    question
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim(),
  );

// The gap log keeps the question, never the caller's contact details.
export const maskContact = (text: string) =>
  text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?:\+?\d[\d\s-]{6,}\d)/g, "[number]");
