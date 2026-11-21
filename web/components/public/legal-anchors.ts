import type { LegalDocument } from "../../messages/legal.ts";

// A stable, readable anchor for each section heading: lower-case words joined
// by hyphens, with a number added when two headings would give the same one.
// The heading text itself is never changed.
export function legalAnchors(doc: LegalDocument): { id: string; heading: string }[] {
  const seen = new Map<string, number>();
  return doc.sections.map(({ heading }) => {
    const base =
      heading
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "section";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}-${n}`, heading };
  });
}
