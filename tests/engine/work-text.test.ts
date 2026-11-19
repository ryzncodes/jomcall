import assert from "node:assert/strict";
import test from "node:test";
import { failureCode, invitationText } from "../../engine/src/work-text.ts";

test("the invitation email carries the link in English and in BM", () => {
  const link = "https://app.example.test/invite?token=" + "a".repeat(64);
  const text = invitationText(link);
  assert.equal(text.split(link).length - 1, 2);
  assert.match(text, /You have been invited to a workspace on JomCall\./);
  assert.match(text, /Anda telah dijemput ke satu ruang kerja di JomCall\./);
  assert.ok(
    text.indexOf("You have been invited") < text.indexOf("Anda telah dijemput"),
  );
});

test("a failed job is logged with a code and never with the error message", () => {
  const timeout = Object.assign(
    new Error("connect to person@example.test timed out"),
    {
      code: "ETIMEDOUT",
    },
  );
  assert.equal(failureCode(timeout), "ETIMEDOUT");
  assert.equal(failureCode(new Error("MAIL_UNAVAILABLE")), "MAIL_UNAVAILABLE");
  assert.equal(
    failureCode(new TypeError("could not send to person@example.test")),
    "TypeError",
  );
  assert.equal(
    failureCode(Object.assign(new Error("x"), { code: "bad code!" })),
    "Error",
  );
  assert.equal(failureCode("person@example.test"), "UNKNOWN");
  assert.equal(failureCode(undefined), "UNKNOWN");
});
