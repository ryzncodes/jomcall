// Every page except the home page names itself in the browser tab, in
// English and Bahasa Melayu, so an owner with several tabs open can tell
// them apart.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

test("the layout adds JomCall to every page title", () => {
  const src = readFileSync("web/app/layout.tsx", "utf8");
  assert.match(src, /template: "%s · JomCall"/);
});

for (const page of pages("web/app").filter((p) => p !== join("web/app", "page.tsx"))) {
  test(`${page} has its own title`, () => {
    assert.match(
      readFileSync(page, "utf8"),
      /export const generateMetadata = pageTitle\("[^"]+", "[^"]+"/,
    );
  });
}
