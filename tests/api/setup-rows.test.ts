// The price-row planner on its own: no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRows,
  rowKey,
  stagedRow,
  type ExistingRow,
  type StagedInput,
} from "../../packages/domain/src/setup/rows.ts";

let n = 0;
const staged = (
  item: string,
  o: { priceSen?: number | null; state?: string; flag?: boolean; variant?: string; id?: string } = {},
): StagedInput => ({
  id: o.id ?? `s${++n}`,
  state: o.state ?? "pending",
  needsCheck: !!o.flag,
  payload: {
    uploadId: "00000000-0000-4000-8000-000000000000",
    item,
    variant: o.variant ?? "",
    priceSen: o.priceSen === undefined ? 100 : o.priceSen,
    unit: "",
    notes: "",
  },
});
const existing = (id: string, item: string, aliases: string[] = []): ExistingRow => ({
  id,
  item,
  aliases,
  priceSen: 500,
  attributes: {},
});
const outcomes = (r: ReturnType<typeof planRows>) =>
  r.plans.map((p) => [p.id, p.outcome, p.duplicateOf ?? p.target?.id ?? null]);

test("rowKey: punctuation, case and spacing do not matter; marks, letters and digits do", () => {
  assert.equal(rowKey("Kopi O"), rowKey("kopi-o"));
  assert.equal(rowKey("  KOPI   o "), "kopi o");
  assert.notEqual(rowKey("பால்"), rowKey("பல்"));
  assert.equal(rowKey("😀"), "");
  assert.equal(rowKey("❤️"), "");
  assert.equal(rowKey("---"), "");
  assert.equal(rowKey("ｋｏｐｉ"), "kopi");
  const long = "Minyak enjin sintetik penuh 5W-30 untuk kereta Perodua dan Proton 4 liter";
  assert.ok(long.length > 60);
  assert.equal(rowKey(long), rowKey(long.toUpperCase()));
});

test("stagedRow joins item and variant, collapses whitespace and cuts to the columns", () => {
  const r = stagedRow({ item: "  Syampu \t herba ", variant: " 500  ml", priceSen: 1200, unit: " botol ", notes: "" });
  assert.equal(r.item, "Syampu herba 500 ml");
  assert.deepEqual(r.attributes, { unit: "botol" });
  assert.equal(r.key, "syampu herba 500 ml");
  assert.equal(stagedRow({ item: "😀".repeat(250), priceSen: 1 }).item, "😀".repeat(200));
  assert.equal(stagedRow({ item: "x", priceSen: "12" }).priceSen, null);
  assert.equal(stagedRow({ item: "x", priceSen: 1.5 }).priceSen, null);
});

test("planRows: skips, duplicates in document order, confirmed beats pending", () => {
  const a = staged("Kopi O", { priceSen: 250 });
  const b = staged("kopi-o", { priceSen: 300, state: "confirmed" });
  const c = staged("Teh", { flag: true });
  const d = staged("Gel", { priceSen: null, state: "confirmed" });
  const e = staged("😀");
  const f = staged("😀");
  const r = planRows([a, b, c, d, e, f], [], new Set());
  assert.deepEqual(outcomes(r), [
    [a.id, "duplicate", b.id],
    [b.id, "write", null],
    [c.id, "unconfirmed", null],
    [d.id, "no_price", null],
    // An empty key never de-duplicates.
    [e.id, "write", null],
    [f.id, "write", null],
  ]);
  assert.deepEqual(r.totals, { total: 6, flagged: 1, noPrice: 1, willWrite: 3, duplicates: 1, conflicts: 0 });
});

test("planRows: a row named in replace wins its key and target; others on it are duplicates", () => {
  const old = existing("e1", "Kopi O");
  const older = staged("Kopi O", { priceSen: 250 });
  const newer = staged("Kopi O", { priceSen: 280 });
  // With nothing named, both keep the current row.
  assert.deepEqual(outcomes(planRows([older, newer], [old], new Set())), [
    [older.id, "conflict", "e1"],
    [newer.id, "conflict", "e1"],
  ]);
  const r = planRows([older, newer], [old], new Set([newer.id]));
  assert.deepEqual(outcomes(r), [
    [older.id, "duplicate", newer.id],
    [newer.id, "update", "e1"],
  ]);
  assert.equal(r.totals.willWrite, 1);
  // Two different names on one existing row (item and alias): one update.
  const alias = existing("e2", "Bateri Amaron NS60L", ["NS60L"]);
  const byItem = staged("bateri amaron ns60l");
  const byAlias = staged("NS60L");
  assert.deepEqual(
    outcomes(planRows([byItem, byAlias], [alias], new Set([byItem.id, byAlias.id]))),
    [
      [byItem.id, "update", "e2"],
      [byAlias.id, "duplicate", byItem.id],
    ],
  );
});

test("planRows: a row sharing a target with a kept-current row is a conflict, not a duplicate", () => {
  const old = existing("e1", "Cuci rambut", ["CR"]);
  const one = staged("Cuci rambut");
  const two = staged("cr");
  assert.deepEqual(outcomes(planRows([one, two], [old], new Set())), [
    [one.id, "conflict", "e1"],
    [two.id, "conflict", "e1"],
  ]);
});

test("planRows: existing rows match on the whole item or alias, never on a code token", () => {
  const tyre = existing("t", "Tayar A 195/55R15");
  const battery = existing("b", "Bateri Amaron NS60L");
  const r = planRows([staged("195/55R15"), staged("NS60L")], [tyre, battery], new Set());
  assert.deepEqual(r.plans.map((p) => p.outcome), ["write", "write"]);
  const withAlias = existing("b2", "Bateri Amaron NS60L", ["NS60L"]);
  assert.equal(planRows([staged("ns60l")], [withAlias], new Set()).plans[0]!.target?.id, "b2");
  // An item match beats an alias match; then the oldest (given first).
  const aliasFirst = existing("a1", "Lain", ["Kopi O"]);
  const itemOld = existing("i1", "Kopi O");
  const itemNew = existing("i2", "kopi o");
  assert.equal(
    planRows([staged("Kopi-O")], [aliasFirst, itemOld, itemNew], new Set()).plans[0]!.target?.id,
    "i1",
  );
  // A long name still matches itself; an emoji name matches nothing.
  const long = "Minyak enjin sintetik penuh 5W-30 untuk kereta Perodua dan Proton 4 liter";
  assert.equal(planRows([staged(long)], [existing("l", long)], new Set()).plans[0]!.target?.id, "l");
  assert.equal(planRows([staged("😀")], [existing("x", "😀")], new Set()).plans[0]!.target, undefined);
  // The variant is part of the name.
  assert.equal(
    planRows([staged("Syampu", { variant: "500ml" })], [existing("s", "Syampu 500ml")], new Set()).plans[0]!.target?.id,
    "s",
  );
});

test("planRows: skipped rows never claim a key or show as conflicts", () => {
  const old = existing("e1", "Kopi O");
  const flagged = staged("Kopi O", { flag: true });
  const noPrice = staged("Kopi O", { priceSen: null });
  const r = planRows([flagged, noPrice], [old], new Set());
  assert.deepEqual(r.plans.map((p) => p.outcome), ["unconfirmed", "no_price"]);
  assert.equal(r.totals.conflicts, 0);
  // They still show the current row.
  assert.equal(r.plans[0]!.target?.id, "e1");
});
