// Preview-only pages describe sample features. On the hosted site they must
// answer "not found" instead of showing them to customers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const page of ["docs", "admin", "self-host", "app/outbound", "app/integrations"]) {
  test(`/${page} is not found on the hosted site`, () => {
    const src = readFileSync(`web/app/${page}/page.tsx`, "utf8");
    assert.match(src, /import \{ notFound \} from "next\/navigation";/);
    assert.match(src, /if \(mode\(\) === "hosted"\) notFound\(\);/);
  });
}

// A wrong link must land on a JomCall page in both languages with a way
// home, not the framework's default black page.
test("the not-found page is JomCall's own, in English and BM", () => {
  const src = readFileSync("web/app/not-found.tsx", "utf8");
  assert.match(src, /We could not find that page\./);
  assert.match(src, /Kami tidak menemui halaman itu\./);
  assert.match(src, /href="\/"/);
});
