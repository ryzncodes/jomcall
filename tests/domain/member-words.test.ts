import test from "node:test";
import assert from "node:assert/strict";
import { roleWords, inviteWords, deliveryWords } from "../../web/lib/core/member-words.ts";

test("roles read as words in both languages", () => {
  assert.deepEqual(roleWords("owner"), ["Owner", "Pemilik"]);
  assert.deepEqual(roleWords("admin"), ["Admin", "Pentadbir"]);
  assert.deepEqual(roleWords("staff"), ["Staff", "Kakitangan"]);
});

test("invitation and email states read as words", () => {
  assert.deepEqual(inviteWords("pending"), ["Waiting", "Menunggu"]);
  assert.deepEqual(inviteWords("accepted"), ["Joined", "Telah menyertai"]);
  assert.deepEqual(inviteWords("revoked"), ["Cancelled", "Dibatalkan"]);
  assert.deepEqual(deliveryWords("pending"), ["Email sending", "E-mel sedang dihantar"]);
  assert.deepEqual(deliveryWords("sent"), ["Email sent", "E-mel dihantar"]);
  assert.deepEqual(deliveryWords("failed"), ["Email failed", "E-mel gagal"]);
});

test("an unknown value is shown as it came, never blank", () => {
  assert.deepEqual(inviteWords("other"), ["other", "other"]);
  assert.deepEqual(deliveryWords("skipped"), ["Email not sent", "E-mel tidak dihantar"]);
});
