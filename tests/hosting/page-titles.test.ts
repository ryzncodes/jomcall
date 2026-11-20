// Every page names itself in the browser tab, in English and Bahasa Melayu,
// so an owner with several tabs open can tell them apart.
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

// Static public pages (English under app/(public), Bahasa Melayu under
// app/ms) take a fixed title per language from pageMetadata, because reading
// the query string would make them dynamic. Every other page keeps pageTitle.
const isPublic = (p: string) =>
  p.startsWith(join("web/app", "(public)") + "/") || p.startsWith(join("web/app", "ms") + "/");

for (const page of pages("web/app")) {
  test(`${page} has its own title`, () => {
    const src = readFileSync(page, "utf8");
    // A public page under a [param] folder has one title per param, so it
    // exports generateMetadata, which must return pageMetadata(...).
    if (isPublic(page) && /\/\[[^/]+\]\//.test(page))
      assert.match(src, /export async function generateMetadata\([\s\S]*?return pageMetadata\(/);
    else if (isPublic(page))
      assert.match(src, /export const metadata(?::\s*Metadata)?\s*=\s*pageMetadata\(/);
    else assert.match(src, /export const generateMetadata = pageTitle\("[^"]+", "[^"]+"/);
  });
}
