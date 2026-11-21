// The sign-up and log-in side panel promises six steps. They must carry the
// same names, in the same order, as the in-app checklist, and pass the banned
// claims check (spec sections 3 and 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authPanel } from "../../web/lib/auth-panel.ts";
import { findBannedClaims } from "../../web/content/public/claims.ts";

test("the panel's step names equal the in-app checklist's", () => {
  // The checklist's step labels live in the home copy since the first-run
  // checklist (#85).
  const copy = readFileSync("web/components/core/home/copy.ts", "utf8");
  const inApp = [...copy.matchAll(/label: \["([^"]+)", "([^"]+)"\]/g)].map(
    (m) => [m[1], m[2]],
  );
  assert.equal(inApp.length, 6);
  assert.deepEqual(
    authPanel.steps.map((s) => [...s]),
    inApp,
  );
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
      const meta: { title?: unknown } = await pageTitle(m[1], m[2], {}, { absolute: true })({
        searchParams: Promise.resolve({ lang }),
      });
      const t: string | undefined = (meta.title as { absolute?: string }).absolute;
      assert.equal(t, m[i + 1]);
      assert.equal(t!.match(/JomCall/g)?.length, 1, t);
    }
  }
});

test("the panel copy makes no banned claim and states no wait time", () => {
  const wait = /\d+\s*(minit|minutes?|hours?|jam|days?|hari)\b|\bwithin\b|\bdalam masa\b/i;
  assert.ok(wait.test("within 2 hours") && wait.test("24 jam") && wait.test("3 days"));
  assert.ok(!wait.test("during opening hours") && !wait.test("dalam waktu operasi"));
  for (const li of [0, 1] as const) {
    const texts = [
      authPanel.heading[li],
      authPanel.intro[li],
      authPanel.stepsLabel[li],
      ...authPanel.steps.map((s) => s[li]),
    ];
    for (const t of texts) {
      assert.deepEqual(findBannedClaims(t, "auth"), [], t);
      assert.doesNotMatch(t, wait, t);
    }
  }
});
