import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  packs,
  packSchema,
  activePacks,
  packEvaluationFixture,
} from "../../packages/domain/src/packs/index.ts";

const dir = new URL("../../packages/domain/src/packs/", import.meta.url);

test("every pack file validates and is loaded", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 9);
  for (const f of files) {
    const parsed = packSchema.parse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    assert.equal(parsed.id + ".json", f);
    assert.ok(packs.some((p) => p.id === parsed.id));
  }
});

test("research copies are gone, so product and research cannot diverge", () => {
  const research = new URL("../../docs/research/pattern-packs/", import.meta.url);
  assert.deepEqual(
    readdirSync(research).filter((f) => f.endsWith(".json")),
    [],
  );
  assert.match(
    readFileSync(new URL("README.md", research), "utf8"),
    /packages\/domain\/src\/packs/,
  );
});

test("every-business is always active and unknown ids are ignored", () => {
  assert.deepEqual(
    activePacks(["stock-price", "nope"]).map((p) => p.id),
    ["every-business", "stock-price"],
  );
});

test("evaluation fixtures keep 12 cases per pack, 3 per language", () => {
  for (const p of packs) {
    const f = packEvaluationFixture(p);
    assert.equal(f.cases.length, 12);
    for (const lang of ["ms", "en", "manglish", "zh"])
      assert.equal(f.cases.filter((c) => c.language === lang).length, 3, p.id);
    for (const c of f.cases.filter((c) => c.kind === "faq"))
      assert.match(
        f.knowledge[c.sourceOrdinal!].content,
        new RegExp(c.contains!.replace(/^\(\?i\)/, ""), "i"),
        c.id,
      );
  }
  assert.ok(existsSync(new URL("../fixtures/pack-evaluation.json", import.meta.url)));
  const written = JSON.parse(
    readFileSync(new URL("../fixtures/pack-evaluation.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(written, packs.map(packEvaluationFixture));
});
