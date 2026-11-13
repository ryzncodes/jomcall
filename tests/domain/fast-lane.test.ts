import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  fastLaneKey,
  mentionsLiveState,
  spokenLanguage,
} from "../../packages/domain/src/agent-test/fast-lane.ts";

test("case, punctuation and filler particles do not change the key", () => {
  assert.equal(
    fastLaneKey("Kedai buka pukul berapa ah?"),
    fastLaneKey("kedai buka pukul berapa"),
  );
  assert.equal(
    fastLaneKey("  Kedai,  buka   pukul berapa lah kan "),
    "kedai buka pukul berapa",
  );
});

test("fewer than 4 remaining words is not served from cache", () => {
  assert.equal(fastLaneKey("Buka pukul berapa ah"), null);
  assert.equal(fastLaneKey("Buka pukul berapa ah ya lah"), null);
  assert.notEqual(fastLaneKey("Buka pukul berapa hari"), null);
});

test("digits are never served from cache", () => {
  assert.equal(fastLaneKey("Boleh tempah pukul 3 petang nanti"), null);
  assert.equal(fastLaneKey("Berapa harga untuk RM80 sahaja"), null);
});

for (const word of [
  "esok",
  "hari ini",
  "tomorrow",
  "today",
  "tadi",
  "itu",
  "that",
  "it",
  "tu",
]) {
  test(`"${word}" as a whole word is not served from cache`, () => {
    assert.equal(fastLaneKey(`Kedai buka pukul berapa ${word}`), null);
    assert.equal(
      fastLaneKey(`${word.toUpperCase()}, kedai buka pukul berapa?`),
      null,
    );
  });
}

for (const q of [
  "今天几点开门吗",
  "明天开门吗",
  "Is the shop open now",
  "Kedai buka malam ini kan",
  "Kedai buka semalam pukul berapa",
  "What about my booking please",
  "Saya nak tahu booking saya status",
  "几点开门",
  "Is the shop open on Friday",
  "Kedai buka hari Isnin pukul berapa",
  "你们星期五开门吗请问",
  "Kedai buka minggu depan pukul berapa",
]) {
  test(`time-relative or caller-specific "${q}" has no key`, () => {
    assert.equal(fastLaneKey(q), null);
  });
}

test("a CJK blocked word blocks even inside a long question", () => {
  assert.equal(fastLaneKey("请问你们那个咨询价格是多少"), null);
});

test("a full-width digit counts as a digit", () => {
  assert.equal(fastLaneKey("Kedai buka pukul ９ pagi atau tidak"), null);
});

test("a Mandarin FAQ of 6+ characters without blocked words gets a key", () => {
  assert.equal(fastLaneKey("咨询价格是多少？"), "咨询价格是多少");
  assert.equal(fastLaneKey("停车是免费的吗？"), "停车是免费的吗");
});

test("a blocked word inside a longer word does not block", () => {
  assert.equal(
    fastLaneKey("Adakah kedai itinerary tutorial tersedia"),
    "adakah kedai itinerary tutorial tersedia",
  );
});

test("an oversized question has no key", () => {
  assert.equal(fastLaneKey("kedai buka pukul berapa ".repeat(30)), null);
  // 400 bytes counts UTF-8 octets, not characters.
  assert.equal(fastLaneKey("咨".repeat(134)), null);
  assert.notEqual(fastLaneKey("咨".repeat(133)), null);
});

test("Chinese questions count each character as a word", () => {
  assert.equal(fastLaneKey("咨询价格是多少？"), "咨询价格是多少");
  assert.equal(fastLaneKey("几点开"), null);
  assert.equal(fastLaneKey("几点开门"), null);
});

test("empty and punctuation-only text has no key", () => {
  assert.equal(fastLaneKey(""), null);
  assert.equal(fastLaneKey("?! ... ah"), null);
});

test("the 48 evaluation questions never share a key", async () => {
  const { cases } = JSON.parse(
    await readFile(
      new URL("../fixtures/agent-evaluation.json", import.meta.url),
      "utf8",
    ),
  ) as { cases: { question: string }[] };
  assert.equal(cases.length, 48);
  const owner = new Map<string, string>();
  let keyed = 0;
  for (const question of new Set(cases.map((c) => c.question))) {
    const key = fastLaneKey(question);
    if (key === null) continue;
    keyed++;
    assert.equal(
      owner.get(key),
      undefined,
      `"${question}" collides with "${owner.get(key)}"`,
    );
    owner.set(key, question);
  }
  assert.ok(keyed > 20, `only ${keyed} questions are cacheable`);
});

test("spokenLanguage picks zh, ms or en", () => {
  assert.equal(spokenLanguage("咨询价格是多少？"), "zh");
  assert.equal(spokenLanguage("Saya mahu tempah"), "ms");
  assert.equal(spokenLanguage("Adakah kedai ini boleh dihubungi"), "ms");
  assert.equal(spokenLanguage("How much does it cost?"), "en");
  // Manglish with no Malay marker word lands on en; the cache needs one of three.
  assert.equal(spokenLanguage("Parking free ke?"), "en");
  assert.equal(spokenLanguage("QA Studio 的 address saya"), "zh");
});

for (const q of [
  "Kedai tutup pukul berapa hari ni",
  "Is the shop open tonite please",
  "Is the shop open tmr please",
  "Is the shop open tmrw please",
  "你们今日营业吗请问",
  "你们明日开门吗请问",
  "Are you open at the moment please",
  "Are you currently open please",
  "Is the shop still open please",
  "Kedai ada buka lagi tak",
  "你们还开着吗请问",
  "Is there any slot available please",
  "Ada slot kosong tak kat sini",
  "Are you open right now please",
  "Kedai masih buka tak sana",
]) {
  test(`live-state question "${q}" has no key`, () => {
    assert.equal(fastLaneKey(q), null);
  });
}

test("static opening hours keep a key", () => {
  assert.notEqual(fastLaneKey("Is the shop open on weekends please"), null);
});

test("mentionsLiveState flags live answers and passes static ones", () => {
  assert.equal(mentionsLiveState("Yes, we are open now until 6 pm."), true);
  assert.equal(mentionsLiveState("Ya, kami masih buka sekarang."), true);
  assert.equal(mentionsLiveState("我们现在还在营业。"), true);
  assert.equal(
    mentionsLiveState("We are at 12 Jalan Contoh, Petaling Jaya."),
    false,
  );
  assert.equal(
    mentionsLiveState("Kami buka 9 pagi hingga 6 petang setiap hari."),
    false,
  );
  assert.equal(mentionsLiveState("我们的地址是样本路十二号。"), false);
  assert.equal(
    mentionsLiveState("It costs RM 80 for our consultation."),
    false,
  );
  assert.equal(mentionsLiveState("Today's special is closed."), true);
});
