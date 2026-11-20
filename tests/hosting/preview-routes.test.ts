// Preview-only pages describe sample features. On the hosted site they must
// answer "not found" instead of showing them to customers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const page of ["docs", "admin", "self-host"]) {
  test(`/${page} is not found on the hosted site`, () => {
    const src = readFileSync(`web/app/${page}/page.tsx`, "utf8");
    assert.match(src, /import \{ notFound \} from "next\/navigation";/);
    assert.match(src, /if \(mode\(\) === "hosted"\) notFound\(\);/);
  });
}
