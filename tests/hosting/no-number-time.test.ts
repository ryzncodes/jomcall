// Phone numbers are set up by a person, so the app must not promise how
// long that takes. Owner rule, 2026-11-21.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const file of [
  "web/components/core/phone.tsx",
  "web/components/core/plan-card.tsx",
  "web/components/core/setup/finish.tsx",
  "web/lib/core/home-rules.ts",
]) {
  test(`${file} promises no time for a phone number`, () => {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /working hours?|jam bekerja/i);
  });
}
