import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chooseCopy, contextCopy, moreCopy } from "../../web/components/core/error-copy.ts";

test("a voice test refused for a missing AI introduction says so, not 'before publishing'", () => {
  const copy = contextCopy("DISCLOSURE_REQUIRED", "voice");
  assert.ok(copy);
  const [en, ms] = copy;
  assert.match(en, /AI introduction/);
  assert.match(en, /voice test/);
  assert.doesNotMatch(en, /publish/i);
  assert.match(ms, /pengenalan AI/);
  assert.match(ms, /ujian suara/);
  assert.doesNotMatch(ms, /terbit/i);
});

test("other codes and other screens keep the shared wording", () => {
  assert.equal(contextCopy("DISCLOSURE_REQUIRED", undefined), undefined);
  assert.equal(contextCopy("CONFLICT", "voice"), undefined);
});

test("an invitation opened without signing in asks for sign-in, not 'Session ended'", () => {
  const copy = contextCopy("UNAUTHORIZED", "invite");
  assert.ok(copy);
  assert.match(copy[0], /invited email/);
  assert.doesNotMatch(copy[0], /ended/i);
  assert.match(copy[1], /e-mel jemputan/);
  assert.equal(contextCopy("UNAUTHORIZED", undefined), undefined);
});


// Codes a person can meet. The rest are developer or protocol errors (bad
// JSON, unknown fields, webhook signatures) and the setup screen's upload
// codes, which setup words itself; they read as the general sentence.
const generic = new Set([
  "ACCESS_TOKEN_REQUIRED", "ANSWER_KIND_MISMATCH", "BAD_SIGNATURE", "EMPTY_CHUNK",
  "EMPTY_UPDATE", "INVALID_CITATION", "INVALID_CURSOR", "INVALID_JSON",
  "JSON_REQUIRED", "METHOD_NOT_ALLOWED", "OCTET_STREAM_REQUIRED", "TOOL_LIMIT",
  "UNKNOWN_FIELD", "UPLOAD_INCOMPLETE", "UPLOAD_LIMIT", "UPLOAD_RATE",
  "UPLOAD_SIZE_MISMATCH", "UPLOAD_STORE_FULL", "UPLOAD_TOO_LARGE",
]);

test("every error code a person can meet has a sentence in both languages", () => {
  const codes = new Set(
    execFileSync("git", ["grep", "-h", "-o", "-E", 'AppError\\("[A-Z_]+"', "--", "web/lib/server", "packages/domain/src"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^AppError\("/, "").replace(/"$/, "")),
  );
  assert.ok(codes.size > 50);
  const shared = readFileSync("web/components/core/state.tsx", "utf8");
  const missing = [...codes].filter(
    (c) => !generic.has(c) && !moreCopy[c] && !new RegExp(`(^|[^A-Z_])${c}: \\[`).test(shared),
  );
  assert.deepEqual(missing, []);
  for (const [code, [en, ms]] of Object.entries(moreCopy)) {
    assert.ok(en && ms && en !== ms, code);
    assert.doesNotMatch(en + ms, /[A-Z]{3,}_[A-Z]/, code);
  }
});

test("a wrong password reads as a sentence", () => {
  assert.match(moreCopy.INVALID_CREDENTIALS[0], /email or password/);
  assert.match(moreCopy.INVALID_CREDENTIALS[1], /e-mel atau kata laluan/i);
});

test("an unknown code reads as a general sentence with the code kept small", () => {
  const [en, ms] = chooseCopy(new Error("x"), "SOMETHING_NEW", {});
  assert.equal(en, "Something went wrong. Try again. (SOMETHING_NEW)");
  assert.equal(ms, "Ada masalah. Cuba lagi. (SOMETHING_NEW)");
});
