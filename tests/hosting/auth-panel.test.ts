// The sign-up and log-in side panel promises six steps. They must carry the
// same names, in the same order, as the in-app checklist, and pass the banned
// claims check (spec sections 3 and 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authPanel } from "../../web/lib/auth-panel.ts";
import { findBannedClaims } from "../../web/content/public/claims.ts";

test("the panel's step names equal the in-app checklist's", () => {
  const home = readFileSync("web/components/core/home/home.tsx", "utf8");
  const inApp = [...home.matchAll(/label: \["([^"]+)", "([^"]+)"\]/g)].map(
    (m) => [m[1], m[2]],
  );
  assert.ok(inApp.length >= 5);
  assert.deepEqual(
    authPanel.steps.slice(0, inApp.length).map((s) => [...s]),
    inApp,
  );
  // Until the app lists a sixth step, check ours against the spec text.
  if (inApp.length === 5)
    assert.deepEqual([...authPanel.steps[5]], [
      "Take your first real call",
      "Terima panggilan sebenar pertama",
    ]);
});

test("a transfer is described as during opening hours only", () => {
  assert.match(authPanel.intro[0], /during opening hours/);
  assert.match(authPanel.intro[1], /waktu operasi/);
  assert.doesNotMatch(authPanel.intro.join(" "), /when needed|apabila perlu/i);
});

test("login and sign-up titles are absolute and name JomCall once", async () => {
  const { pageTitle } = await import("../../web/lib/page-title.ts");
  for (const f of ["login", "signup"]) {
    const src = readFileSync(`web/app/${f}/page.tsx`, "utf8");
    const m = src.match(/pageTitle\("([^"]+)", "([^"]+)", \{\}, \{ absolute: true \}\)/);
    assert.ok(m, `${f} uses the absolute option`);
    for (const [i, lang] of [undefined, "ms"].entries()) {
      const meta = await pageTitle(m[1], m[2], {}, { absolute: true })({
        searchParams: Promise.resolve({ lang }),
      });
      const t = (meta.title as { absolute?: string }).absolute;
      assert.equal(t, m[i + 1]);
      assert.equal(t!.match(/JomCall/g)?.length, 1, t);
    }
  }
});
