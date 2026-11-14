// Scores results/extraction/*.json against the hand-written truth.
// Writes results/extraction.json (with every miss listed for manual review) and results/extraction.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_MODELS } from "../models.ts";
import { DOCS, type Doc, type TruthRow } from "./truth.ts";

const here = dirname(fileURLToPath(import.meta.url));
const RES = join(here, "..", "results");
type ERow = { item: string; variant: string | null; price_sen: number | null; unit: string | null; notes: string | null; confidence?: string; needs_owner_check?: boolean; check_reason?: string | null };
type EOut = { rows: ERow[]; facts: { kind: string; text: string; needs_owner_check?: boolean }[]; unreadable?: string[] };

const toks = (s: string) =>
  (s.normalize("NFKC").toLowerCase().replace(/[–—]/g, "-").match(/\p{Script=Han}|[\p{L}\p{N}]+(?:\.\d+)?/gu) ?? []).map((t) => t.replace(/^(\d+)\.0$/, "$1"));
const cont = (a: string[], b: string[]) => (a.length ? a.filter((t) => b.includes(t)).length / a.length : 0);
const f1 = (a: string[], b: string[]) => {
  const p = cont(a, b);
  const q = cont(b, a);
  return p + q ? (2 * p * q) / (p + q) : 0;
};
const truthNames = (t: TruthRow) => [t.variant, ...(t.variantAlt ?? [])].map((v) => `${t.item} ${v ?? ""}`);
const eName = (e: ERow) => `${e.item} ${e.variant ?? ""}`;
const nameSim = (t: TruthRow, e: ERow) => Math.max(...truthNames(t).map((n) => f1(toks(n), toks(eName(e)))), ...truthNames(t).map((n) => 0.9 * cont(toks(n), toks(`${eName(e)} ${e.notes ?? ""}`))));

function match(truth: TruthRow[], rows: ERow[]) {
  const pairs: { t: number; e: number; s: number; sim: number }[] = [];
  truth.forEach((t, ti) =>
    rows.forEach((e, ei) => {
      const sim = nameSim(t, e);
      const priceEq = t.priceSen !== null && e.price_sen === t.priceSen;
      if (sim >= 0.5 || (sim >= 0.3 && priceEq)) pairs.push({ t: ti, e: ei, s: sim + (priceEq ? 0.3 : 0), sim });
    }),
  );
  pairs.sort((a, b) => b.s - a.s);
  const tm = new Map<number, number>();
  const used = new Set<number>();
  for (const p of pairs) if (!tm.has(p.t) && !used.has(p.e)) (tm.set(p.t, p.e), used.add(p.e));
  return { tm, used };
}

type Score = ReturnType<typeof scoreDoc>;
function scoreDoc(doc: Doc, out: EOut, prompt: string) {
  const rows = out.rows ?? [];
  const { tm, used } = match(doc.rows, rows);
  const flagged = (t: TruthRow, e: ERow) =>
    e.price_sen === null || (prompt === "checked" ? e.needs_owner_check === true : (out.unreadable ?? []).some((line) => cont(toks(t.item), toks(line)) >= 0.5));
  const s = {
    truthRows: 0, matched: 0, missed: [] as string[], invented: [] as string[],
    nameOk: 0, variantN: 0, variantOk: 0, unitN: 0, unitOk: 0,
    priceN: 0, priceOk: 0, priceMissing: 0, priceErr: [] as string[], priceErrUnflagged: 0,
    cleanN: 0, cleanFlagged: 0,
    hidden: { n: 0, leftBlank: 0, guessedFlagged: 0, guessedSilently: 0 },
    ambiguous: { n: 0, right: 0, wrongFlagged: 0, wrongSilent: 0 },
    approx: { n: 0, flagged: 0, silent: 0 },
    corrected: { n: 0, right: 0 },
    factsN: doc.facts.length, factsFound: 0, factsMissed: [] as string[], leaks: 0,
    extractedRows: rows.length, flaggedRows: rows.filter((e) => e.needs_owner_check || e.price_sen === null).length,
  };
  doc.rows.forEach((t, ti) => {
    const ei = tm.get(ti);
    if (ei === undefined) {
      if (!t.optional) (s.truthRows++, s.missed.push(truthNames(t)[0]!.trim()));
      return;
    }
    const e = rows[ei]!;
    s.truthRows++;
    s.matched++;
    if (cont(toks(t.item), toks(`${eName(e)} ${e.notes ?? ""}`)) >= 0.6) s.nameOk++;
    if (t.variant) {
      s.variantN++;
      if ([t.variant, ...(t.variantAlt ?? [])].some((v) => cont(toks(v), toks(`${e.variant ?? ""} ${e.item} ${e.unit ?? ""}`)) >= 0.6)) s.variantOk++;
    }
    if (t.unit) {
      s.unitN++;
      const u = toks(`${e.unit ?? ""}`).join(" ");
      if (t.unit.some((a) => new RegExp(`(^| )${a.replace(/[.²]/g, "\\$&")}( |$)`).test(u) || u.replace(/^se/, "") === a)) s.unitOk++;
    }
    const f = flagged(t, e);
    const label = `${truthNames(t)[0]!.trim()}: truth ${t.priceSen} got ${e.price_sen}${f ? " (flagged)" : ""}`;
    if (t.trap === "unreadable" || t.trap === "no-price") {
      s.hidden.n++;
      if (e.price_sen === null) s.hidden.leftBlank++;
      else if (f) s.hidden.guessedFlagged++;
      else (s.hidden.guessedSilently++, s.priceErr.push(`[hidden] ${label}`));
      return;
    }
    if (t.trap === "ambiguous") {
      s.ambiguous.n++;
      if (e.price_sen === t.priceSen) s.ambiguous.right++;
      else if (f) s.ambiguous.wrongFlagged++;
      else (s.ambiguous.wrongSilent++, s.priceErr.push(`[ambiguous] ${label}`));
      return;
    }
    if (t.trap === "approx") {
      s.approx.n++;
      f ? s.approx.flagged++ : s.approx.silent++;
      return;
    }
    if (t.trap === "corrected") {
      s.corrected.n++;
      if (e.price_sen === t.priceSen) s.corrected.right++;
    }
    s.priceN++;
    if (e.price_sen === t.priceSen) {
      s.priceOk++;
      if (!t.trap) (s.cleanN++, f && s.cleanFlagged++);
    } else if (e.price_sen === null) s.priceMissing++;
    else {
      s.priceErr.push(label);
      if (!f) s.priceErrUnflagged++;
    }
  });
  rows.forEach((e, ei) => !used.has(ei) && s.invented.push(`${eName(e).trim()} = ${e.price_sen}`));
  const factText = [...(out.facts ?? []).map((f) => f.text), ...rows.map((e) => `${e.notes ?? ""} ${e.unit ?? ""}`), ...(out.unreadable ?? [])].join("\n");
  for (const f of doc.facts) f.must.every((re) => re.test(factText)) ? s.factsFound++ : s.factsMissed.push(f.label);
  const all = factText + "\n" + rows.map(eName).join("\n");
  s.leaks = (doc.mustNot ?? []).filter((re) => re.test(all)).length;
  return s;
}

const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(n === d || n === 0 ? 0 : 1)}%` : "–");
const table: string[] = [];
const detail: Record<string, unknown> = {};
const byKind: string[] = [];
let totalUsd = 0;

for (const model of CLAUDE_MODELS)
  for (const prompt of ["plain", "checked"]) {
    const per: { doc: Doc; s: Score; ms: number; usd: number }[] = [];
    const failed: string[] = [];
    for (const doc of DOCS) {
      const file = join(RES, "extraction", `${model.key}.${prompt}.${doc.id}.json`);
      if (!existsSync(file)) {
        failed.push(`${doc.id}: no result`);
        continue;
      }
      const rec = JSON.parse(readFileSync(file, "utf8"));
      totalUsd += rec.usd ?? 0;
      if (!rec.output) {
        failed.push(`${doc.id}: ${rec.error ?? rec.stop_reason}`);
        continue;
      }
      per.push({ doc, s: scoreDoc(doc, rec.output, prompt), ms: rec.ms, usd: rec.usd });
    }
    if (!per.length) continue;
    const sum = (f: (s: Score) => number, set = per) => set.reduce((a, x) => a + f(x.s), 0);
    const key = `${model.id} / ${prompt}`;
    table.push(
      `| ${key} | ${per.length}/12 | ${sum((s) => s.matched)}/${sum((s) => s.truthRows)} | ${sum((s) => s.missed.length)} | ${sum((s) => s.invented.length)} | ${pct(sum((s) => s.nameOk), sum((s) => s.matched))} | ${pct(sum((s) => s.variantOk), sum((s) => s.variantN))} | ${pct(sum((s) => s.unitOk), sum((s) => s.unitN))} | ${pct(sum((s) => s.priceOk), sum((s) => s.priceN))} | ${sum((s) => s.priceMissing)} | ${sum((s) => s.priceErr.length)} (${sum((s) => s.priceErrUnflagged) + sum((s) => s.hidden.guessedSilently) + sum((s) => s.ambiguous.wrongSilent)} unflagged) | ${sum((s) => s.hidden.leftBlank)} / ${sum((s) => s.hidden.guessedFlagged)} / ${sum((s) => s.hidden.guessedSilently)} of ${sum((s) => s.hidden.n)} | ${sum((s) => s.ambiguous.right)} / ${sum((s) => s.ambiguous.wrongFlagged)} / ${sum((s) => s.ambiguous.wrongSilent)} of ${sum((s) => s.ambiguous.n)} | ${sum((s) => s.approx.flagged)}/${sum((s) => s.approx.n)} | ${sum((s) => s.corrected.right)}/${sum((s) => s.corrected.n)} | ${pct(sum((s) => s.cleanFlagged), sum((s) => s.cleanN))} | ${sum((s) => s.factsFound)}/${sum((s) => s.factsN)} | ${sum((s) => s.leaks)} | $${(per.reduce((a, x) => a + x.usd, 0) / per.length).toFixed(4)} | ${(q(per.map((x) => x.ms), 0.5) / 1000).toFixed(1)} / ${(q(per.map((x) => x.ms), 0.9) / 1000).toFixed(1)} |`,
    );
    for (const kind of ["image", "pdf", "xlsx", "chat"]) {
      const set = per.filter((x) => x.doc.kind === kind);
      if (!set.length) continue;
      byKind.push(
        `| ${key} | ${kind} | ${sum((s) => s.matched, set)}/${sum((s) => s.truthRows, set)} | ${sum((s) => s.invented.length, set)} | ${pct(sum((s) => s.priceOk, set), sum((s) => s.priceN, set))} | ${sum((s) => s.priceErr.length, set)} | ${sum((s) => s.factsFound, set)}/${sum((s) => s.factsN, set)} | $${(set.reduce((a, x) => a + x.usd, 0) / set.length).toFixed(4)} | ${(q(set.map((x) => x.ms), 0.5) / 1000).toFixed(1)} |`,
      );
    }
    detail[key] = { failed, docs: Object.fromEntries(per.map((x) => [x.doc.id, { ms: x.ms, usd: x.usd, ...x.s }])) };
  }

const md = [
  `| Model / prompt | Docs | Rows found | Missed | Invented | Name ok | Variant ok | Unit ok | Price exact | Readable price left blank | Price errors | Hidden price: blank / guessed+flagged / guessed silently | Smudged: right / wrong+flagged / wrong silently | "About" price flagged | Corrections right | Clean rows flagged | Facts found | Clutter leaked | $ / doc | Time p50 / p90 s |`,
  `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ...table,
  ``,
  `| Model / prompt | Source kind | Rows found | Invented | Price exact | Price errors | Facts found | $ / doc | Time p50 s |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...byKind,
  ``,
  `Total extraction spend recorded: $${totalUsd.toFixed(2)}`,
].join("\n");
writeFileSync(join(RES, "extraction.json"), JSON.stringify(detail, null, 1));
writeFileSync(join(RES, "extraction.md"), md);
console.log(md);
