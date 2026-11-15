// Pure rules behind the WhatsApp inbox screen. Fake numbers only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  displayName,
  keepAttempt,
  maskedNumber,
  nextAttempt,
  snippet,
  utf8Bytes,
} from "../../web/lib/core/inbox-rules.ts";
import { CoreError } from "../../web/lib/core/client.ts";

test("numbers are masked to the last four digits", () => {
  assert.equal(maskedNumber("60111234567"), "•••• 4567");
  assert.equal(maskedNumber("12025550123"), "•••• 0123");
  assert.equal(maskedNumber("123"), "••••");
});

test("a name that is the number is treated as no name", () => {
  assert.equal(displayName("+60111234567", "60111234567"), "•••• 4567");
  assert.equal(displayName("60111234567", "60111234567"), "•••• 4567");
  assert.equal(displayName("+60 11-123 4567", "60111234567"), "•••• 4567");
  assert.equal(displayName("", "60111234567"), "•••• 4567");
  assert.equal(displayName("Siti Contoh", "60111234567"), "Siti Contoh");
  assert.equal(displayName("Kedai 24", "60111234567"), "Kedai 24");
});

test("snippets never split an emoji", () => {
  const text = "a".repeat(89) + "😀😀";
  const out = snippet(text);
  assert.equal(out, "a".repeat(89) + "😀…");
  assert.equal(snippet("short"), "short");
});

test("the reply size is counted in UTF-8 bytes", () => {
  assert.equal(utf8Bytes("abc"), 3);
  assert.equal(utf8Bytes("😀"), 4);
  assert.equal(utf8Bytes("é"), 2);
});

test("one key per draft: a retry resends the exact first request", () => {
  let n = 0;
  const key = () => `k${++n}`;
  const first = nextAttempt(null, "Hello", 3, key);
  assert.deepEqual(first, { key: "k1", text: "Hello", expectedRevision: 3 });
  // A poll moved the revision on; the retry still sends revision 3.
  assert.equal(nextAttempt(first, "Hello", 5, key), first);
  // An edited draft is a new reply.
  assert.deepEqual(nextAttempt(first, "Hello!", 5, key), {
    key: "k2",
    text: "Hello!",
    expectedRevision: 5,
  });
});

test("only a lost or failed response keeps the attempt", () => {
  assert.equal(keepAttempt(new TypeError("Failed to fetch")), true);
  assert.equal(keepAttempt(new CoreError("REQUEST_FAILED", 502)), true);
  assert.equal(keepAttempt(new CoreError("CONFLICT", 409)), false);
  assert.equal(keepAttempt(new CoreError("DO_NOT_CONTACT", 409)), false);
});
