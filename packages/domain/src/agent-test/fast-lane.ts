// The fast lane serves an answer the brain gave earlier, for the same agent
// snapshot, to the same question. It never composes a new answer. These are
// the pure key and language functions; the database lookup lives elsewhere.

const MAX_KEY_BYTES = 400; // app.voice_answer_cache.key limit, in UTF-8 octets
const MIN_WORDS = 4;
const PARTICLES = new Set(["ah", "lah", "ya", "kan", "eh", "uh", "um"]);
// Anything that depends on the day, the time or the caller must never come
// from cache: dates, "now", weekdays, references to earlier turns, and first
// person. Latin script matches whole words; multi-word entries match a run of
// words. CJK has no word breaks, so those match as substrings.
const UNCACHEABLE_WORDS = new Set([
  // English
  "tomorrow",
  "today",
  "now",
  "tonight",
  "yesterday",
  "this",
  "that",
  "it",
  "next",
  "last",
  "later",
  "my",
  "mine",
  "me",
  "i",
  "we",
  "our",
  "us",
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
  "itu",
  "tu",
  "sekarang",
  "semalam",
  "lusa",
  "nanti",
  "saya",
  "aku",
  "kami",
  "kita",
  "isnin",
  "selasa",
  "rabu",
  "khamis",
  "jumaat",
  "sabtu",
  "ahad",
]);
const UNCACHEABLE_PHRASES = [
  "hari ini",
  "malam ini",
  "pagi ini",
  "petang ini",
  "minggu ini",
  "minggu depan",
  "bulan ini",
  "bulan depan",
].map((p) => p.split(" "));
const UNCACHEABLE_CJK = [
  "今天",
  "明天",
  "昨天",
  "后天",
  "现在",
  "今晚",
  "今早",
  "刚才",
  "这个",
  "那个",
  "这周",
  "下周",
  "上周",
  "这个月",
  "下个月",
  "我",
  "我们",
  "昨晚",
  "明晚",
  "明早",
  "星期",
  "礼拜",
  "周",
];
const MIN_CJK_CHARS = 6;
const CJK = /[一-鿿]/;
// Same marker words as the wrong-language check in tests/inference/quality.test.ts.
const MALAY =
  /\b(ialah|adalah|saya|anda|boleh|setiap|tidak|untuk|yang|kami|maaf)\b/i;

// Returns null when the question must not use the fast lane.
export function fastLaneKey(transcript: string): string | null {
  const text = transcript.normalize("NFKC").toLowerCase();
  if (/\p{Nd}/u.test(text)) return null;
  const cleaned = text
    .replace(/[^\p{L}\p{M}\s]/gu, "")
    // No spaces between Chinese characters: each one counts as a word.
    .replace(/([一-鿿])(?=[一-鿿])/g, "$1 ");
  const words = cleaned.split(/\s+/).filter((w) => w && !PARTICLES.has(w));
  const cjkChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjkChars > 0 ? cjkChars < MIN_CJK_CHARS : words.length < MIN_WORDS)
    return null;
  if (words.some((w) => UNCACHEABLE_WORDS.has(w))) return null;
  const run = words.join(" ");
  if (UNCACHEABLE_PHRASES.some((p) => ` ${run} `.includes(` ${p.join(" ")} `)))
    return null;
  const solid = cleaned.replace(/\s+/g, "");
  if (UNCACHEABLE_CJK.some((w) => solid.includes(w))) return null;
  const key = words.join(" ").replace(/([一-鿿]) (?=[一-鿿])/g, "$1");
  return Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES ? null : key;
}

export function spokenLanguage(transcript: string): "ms" | "en" | "zh" {
  if (CJK.test(transcript)) return "zh";
  return MALAY.test(transcript) ? "ms" : "en";
}
