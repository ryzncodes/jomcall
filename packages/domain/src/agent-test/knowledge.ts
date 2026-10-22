import { createHash } from "node:crypto";
import { AppError } from "../../../contracts/src/index.ts";
import type { KnowledgeHit } from "../../../contracts/src/agent-test.ts";
export type Snapshot = {
  settings?: Record<string, unknown>;
  knowledge: { kind: string; name: string; content: string }[];
};
export function snapshotHash(snapshot: Snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
const tokens = (text: string) => {
  const v = text.normalize("NFKC").toLowerCase();
  const words = v.match(/[\p{L}\p{N}]+/gu) ?? [];
  const han = v.match(/\p{Script=Han}+/gu) ?? [];
  return [
    ...new Set([
      ...words,
      ...han.flatMap((run) =>
        Array.from(run)
          .slice(0, -1)
          .map((c, i) => c + Array.from(run)[i + 1]),
      ),
    ]),
  ];
};
export function buildKnowledgeIndex(snapshot: Snapshot): KnowledgeHit[] {
  const hash = snapshotHash(snapshot).slice(0, 24);
  return snapshot.knowledge.flatMap((doc, d) => {
    const chars = Array.from(doc.content);
    const chunks: KnowledgeHit[] = [];
    for (let at = 0; at < chars.length; at += 1080) {
      chunks.push({
        sourceId: `${hash}:${d}:${chunks.length}`,
        title: doc.name,
        excerpt: chars.slice(at, at + 1200).join(""),
        score: 0,
      });
      if (at + 1200 >= chars.length) break;
    }
    return chunks;
  });
}
export function searchKnowledge(index: KnowledgeHit[], query: string) {
  const q = tokens(query);
  if (!q.length) return [];
  return index
    .map((hit) => {
      const document = new Set(tokens(hit.title + " " + hit.excerpt));
      return {
        ...hit,
        score: q.reduce(
          (score, token) => score + (document.has(token) ? 1 : 0),
          0,
        ),
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
    .slice(0, 5);
}
export function validateCitations(ids: string[], hits: KnowledgeHit[]) {
  if (ids.some((id) => !hits.some((hit) => hit.sourceId === id)))
    throw new AppError("INVALID_CITATION", 422);
}
