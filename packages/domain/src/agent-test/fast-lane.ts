// The fast lane serves an answer the brain gave earlier, for the same agent
// snapshot, to the same question. It never composes a new answer. These are
// the pure key and language functions; the database lookup lives elsewhere.

const MAX_KEY_BYTES = 400; // app.voice_answer_cache.key limit, in UTF-8 octets
const MIN_WORDS = 4;
const PARTICLES = new Set(["ah", "lah", "ya", "kan", "eh", "uh", "um"]);
// Anything that depends on the day, the time, live state or the caller must
// never come from cache. Latin script matches whole words; multi-word entries
// match a run of words. CJK has no word breaks, so those match as substrings.
// Live-state markers apply to questions and to answers. Caller and reference
// words apply to questions only: a business answering "we" or "it" is normal.
const LIVE_WORDS = new Set([
  // English
  "tomorrow",
  "today",
  "todays",
  "now",
  "tonight",
  "tonite",
  "tmr",
  "tmrw",
  "tomoro",
  "yesterday",
  "currently",
  "still",
  "available",
  "availability",
  "slot",
  "slots",
  "next",
  "last",
  "later",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  // Malay
  "esok",
  "tadi",
  "sekarang",
  "semalam",
  "lusa",
  "nanti",
  "lagi",
  "masih",
  "kosong",
  "isnin",
  "selasa",
  "rabu",
  "khamis",
  "jumaat",
  "sabtu",
  "ahad",
]);
const LIVE_PHRASES = [
  "hari ini",
  "malam ini",
  "pagi ini",
  "petang ini",
  "minggu ini",
  "minggu depan",
  "bulan ini",
  "bulan depan",
  "hari ni",
  "malam ni",
  "pagi ni",
  "petang ni",
  "minggu ni",
  "bulan ni",
  "at the moment",
  "right now",
].map((p) => p.split(" "));
const LIVE_CJK = [
  "今天",
  "明天",
  "昨天",
  "后天",
  "现在",
  "今晚",
  "今早",
  "刚才",
  "这周",
  "下周",
  "上周",
  "这个月",
  "下个月",
  "昨晚",
  "明晚",
  "明早",
  "星期",
  "礼拜",
  "周",
  "今日",
  "明日",
  "昨日",
  "还开",
  "还在",
  "目前",
  "当前",
  "空位",
  "有位",
];
const CALLER_WORDS = new Set([
  "this",
  "that",
  "it",
  "my",
  "mine",
  "me",
  "i",
  "we",
  "our",
  "us",
  "itu",
  "tu",
  "saya",
  "aku",
  "kami",
  "kita",
]);
const CALLER_CJK = ["这个", "那个", "我"];
const MIN_CJK_CHARS = 6;
const CJK = /[一-鿿]/;
// Same marker words as the wrong-language check in tests/inference/quality.test.ts.
const MALAY =
  /\b(ialah|adalah|saya|anda|boleh|setiap|tidak|untuk|yang|kami|maaf)\b/i;

function scan(
  text: string,
  words: Set<string>,
  phrases: string[][],
  cjk: string[],
): boolean {
  const cleaned = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}\s]/gu, "")
    .replace(/([\u4e00-\u9fff])(?=[\u4e00-\u9fff])/g, "$1 ");
  const list = cleaned.split(/\s+/).filter(Boolean);
  if (list.some((w) => words.has(w))) return true;
  const run = ` ${list.join(" ")} `;
  if (phrases.some((p) => run.includes(` ${p.join(" ")} `))) return true;
  const solid = cleaned.replace(/\s+/g, "");
  return cjk.some((w) => solid.includes(w));
}

// True when the text depends on the day, time or live state. Use it on an
// answer before caching it. It ignores caller words, length and digits.
export function mentionsLiveState(text: string): boolean {
  // "today's" loses its apostrophe to punctuation removal and becomes "todays".
  return scan(text, LIVE_WORDS, LIVE_PHRASES, LIVE_CJK);
}

// Returns null when the question must not use the fast lane.
export function fastLaneKey(transcript: string): string | null {
  const text = transcript.normalize("NFKC").toLowerCase();
  if (/\p{Nd}/u.test(text)) return null;
  const cleaned = text
    .replace(/[^\p{L}\p{M}\s]/gu, "")
    // No spaces between Chinese characters: each one counts as a word.
    .replace(/([\u4e00-\u9fff])(?=[\u4e00-\u9fff])/g, "$1 ");
  const words = cleaned.split(/\s+/).filter((w) => w && !PARTICLES.has(w));
  const cjkChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjkChars > 0 ? cjkChars < MIN_CJK_CHARS : words.length < MIN_WORDS)
    return null;
  if (mentionsLiveState(text)) return null;
  if (scan(text, CALLER_WORDS, [], CALLER_CJK)) return null;
  const key = words
    .join(" ")
    .replace(/([\u4e00-\u9fff]) (?=[\u4e00-\u9fff])/g, "$1");
  return Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES ? null : key;
}

export function spokenLanguage(transcript: string): "ms" | "en" | "zh" {
  if (CJK.test(transcript)) return "zh";
  return MALAY.test(transcript) ? "ms" : "en";
}
