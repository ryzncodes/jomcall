import test from "node:test";
import assert from "node:assert/strict";
import { splitSentences } from "../../packages/domain/src/agent-test/sentences.ts";

test("splits a finished sentence and keeps the unfinished rest", () => {
  assert.deepEqual(splitSentences("Kami buka 9 pagi. Tutup pukul 6"), {
    sentences: ["Kami buka 9 pagi."],
    rest: "Tutup pukul 6",
  });
});

test("a decimal point does not end a sentence", () => {
  assert.deepEqual(splitSentences("RM 80.50 sahaja"), {
    sentences: [],
    rest: "RM 80.50 sahaja",
  });
});

test("Chinese full stop ends a sentence without a following space", () => {
  assert.deepEqual(splitSentences("好的。请稍等"), {
    sentences: ["好的。"],
    rest: "请稍等",
  });
});

test("a sentence under 12 characters waits for the next one", () => {
  assert.deepEqual(splitSentences("Ya. Kami buka pukul 9 pagi. Tutup"), {
    sentences: ["Ya. Kami buka pukul 9 pagi."],
    rest: "Tutup",
  });
  assert.deepEqual(splitSentences("Ya. Tutup"), {
    sentences: [],
    rest: "Ya. Tutup",
  });
});

test("question and exclamation marks end sentences", () => {
  assert.deepEqual(splitSentences("Boleh saya bantu anda? Sila beritahu"), {
    sentences: ["Boleh saya bantu anda?"],
    rest: "Sila beritahu",
  });
});
