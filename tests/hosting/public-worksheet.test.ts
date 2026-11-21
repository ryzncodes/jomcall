// The missed-calls worksheet and the receptionist cost sheet (spec section 5,
// Tier 2). The arithmetic is a pure module, so it runs here without React.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clampAverageSen,
  clampPerWeek,
  clampShare,
  costCompare,
  MAX_AVERAGE_SEN,
  MAX_COST_SEN,
  MAX_PER_WEEK,
  missedValueSen,
  shareFromPercent,
} from "../../web/components/public/worksheet-math.ts";
import { estimates } from "../../web/components/public/estimates.ts";
import { publicPlans } from "../../web/lib/pricing.ts";

test("missedValueSen: calls a week, share that would have booked, average sale, to RM a month", () => {
  assert.equal(missedValueSen({ perWeek: 10, share: 0.3, averageSen: 8000 }), Math.round(10 * 52 / 12 * 0.3 * 8000));
  assert.equal(missedValueSen({ perWeek: 0, share: 0.3, averageSen: 8000 }), 0);
  assert.equal(missedValueSen({ perWeek: 7, share: 1, averageSen: 15000 }), Math.round(7 * 52 / 12 * 1 * 15000));
  // Whole sen, always.
  assert.ok(Number.isInteger(missedValueSen({ perWeek: 3, share: 0.17, averageSen: 1999 })));
});

test("missedValueSen clamps bad input to safe ranges", () => {
  // Not a number, negative, or text: counts as 0.
  assert.equal(missedValueSen({ perWeek: Number.NaN, share: 0.3, averageSen: 8000 }), 0);
  assert.equal(missedValueSen({ perWeek: -5, share: 0.3, averageSen: 8000 }), 0);
  assert.equal(missedValueSen({ perWeek: 10, share: -1, averageSen: 8000 }), 0);
  assert.equal(missedValueSen({ perWeek: 10, share: 0.3, averageSen: -100 }), 0);
  assert.equal(missedValueSen({ perWeek: Infinity, share: 0.3, averageSen: 8000 }), 0);
  // A share above 1 is 1; very large inputs stop at their top.
  assert.equal(
    missedValueSen({ perWeek: 10, share: 4, averageSen: 8000 }),
    missedValueSen({ perWeek: 10, share: 1, averageSen: 8000 }),
  );
  assert.equal(
    missedValueSen({ perWeek: 1e9, share: 1, averageSen: 1e12 }),
    Math.round(MAX_PER_WEEK * 52 / 12 * 1 * MAX_AVERAGE_SEN),
  );
  assert.ok(Number.isSafeInteger(missedValueSen({ perWeek: 1e9, share: 1, averageSen: 1e12 })));
});

test("the field clamps: whole calls, a share from a percentage, sen from ringgit", () => {
  assert.equal(clampPerWeek("12"), 12);
  assert.equal(clampPerWeek("12.6"), 13);
  assert.equal(clampPerWeek(""), 0);
  assert.equal(clampPerWeek("abc"), 0);
  assert.equal(clampPerWeek(-3), 0);
  assert.equal(clampPerWeek(1e6), MAX_PER_WEEK);
  assert.equal(shareFromPercent("30"), 0.3);
  assert.equal(shareFromPercent("150"), 1);
  assert.equal(shareFromPercent("-4"), 0);
  assert.equal(shareFromPercent("x"), 0);
  assert.equal(clampShare(0.25), 0.25);
  assert.equal(clampShare(Number.NaN), 0);
  assert.equal(clampAverageSen("80"), 8000);
  assert.equal(clampAverageSen("19.99"), 1999);
  assert.equal(clampAverageSen("-1"), 0);
  assert.equal(clampAverageSen("1e12"), MAX_AVERAGE_SEN);
});

test("costCompare: the visitor's figure beside JomCall's month at the same minutes, nothing invented", () => {
  const result = costCompare({ costSen: 250000, minutes: 300 });
  const est = estimates(300);
  const cheapest = est.rows.find((r) => r.code === est.cheapest)!;
  assert.equal(result.costSen, 250000);
  assert.equal(result.plan, est.cheapest);
  assert.equal(result.jomcallSen, cheapest.sen);
  // An empty figure stays empty: no default salary.
  assert.equal(costCompare({ costSen: Number.NaN, minutes: 300 }).costSen, 0);
  assert.equal(costCompare({ costSen: 1e15, minutes: 300 }).costSen, MAX_COST_SEN);
  // The plan comes from the price table.
  assert.ok(publicPlans.some((p) => p.code === result.plan));
});

test("the worksheet island keeps its arithmetic in the pure module and announces politely", () => {
  const src = readFileSync("web/components/public/worksheet.tsx", "utf8");
  assert.match(src, /^"use client";/);
  assert.match(src, /from "\.\/worksheet-math"/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /setTimeout\([\s\S]{0,80}?,\s*500\)/);
  assert.doesNotMatch(src, /\* 52|\/ 12/, "the island repeats the arithmetic");
  assert.doesNotMatch(readFileSync("web/components/public/worksheet-math.ts", "utf8"), /use client/);
});

test("every worksheet field says its unit to a screen reader, in both languages", async () => {
  const { worksheetCopy } = await import("../../web/content/public/guides.ts");
  for (const locale of ["en", "ms"] as const) {
    const { missed, cost } = worksheetCopy[locale];
    const fields = [missed.perWeek, missed.share, missed.average, cost.cost, cost.minutes];
    for (const field of fields) assert.ok(field.said.trim().length > 2, `${locale} ${field.label}`);
    // The share is a percentage from 0 to 100, so 0.3 is not read as 30%.
    assert.match(missed.share.said, /(percentage|peratus)[^)]*100/);
    assert.match(missed.average.said, /ringgit/);
    assert.match(cost.cost.said, /ringgit/);
  }
  // The visible unit is decoration; the label carries the spoken unit.
  const src = readFileSync("web/components/public/worksheet.tsx", "utf8");
  assert.match(src, /<label className="ws-label" htmlFor=\{id\}>\s*\{label\}\s*<span className="sr-only"> \{said\}<\/span>\s*<\/label>/);
  assert.equal(src.match(/said=\{t\.\w+\.said\}/g)?.length, 5);
});

test("both sheets say their starting figures are an example", async () => {
  const { worksheetCopy } = await import("../../web/content/public/guides.ts");
  assert.match(worksheetCopy.en.cost.example, /example/i);
  assert.match(worksheetCopy.ms.cost.example, /contoh/i);
  const src = readFileSync("web/components/public/worksheet.tsx", "utf8");
  assert.equal(src.match(/<p className="ws-example t-small">\{t\.example\}<\/p>/g)?.length, 2);
});
