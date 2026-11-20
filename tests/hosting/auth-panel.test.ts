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
  assert.equal(inApp.length, 5);
  assert.deepEqual(
    authPanel.steps.slice(0, 5).map((s) => [...s]),
    inApp,
  );
  assert.deepEqual([...authPanel.steps[5]], [
    "Take your first real call",
    "Terima panggilan sebenar pertama",
  ]);
});

test("the panel copy makes no banned claim in either language", () => {
  for (const li of [0, 1] as const) {
    const texts = [
      authPanel.heading[li],
      authPanel.intro[li],
      authPanel.stepsLabel[li],
      ...authPanel.steps.map((s) => s[li]),
    ];
    for (const t of texts) assert.deepEqual(findBannedClaims(t, "auth"), [], t);
    assert.doesNotMatch(texts.join(" "), /\b(minit|minutes?|hours?|jam)\b/i);
  }
});
