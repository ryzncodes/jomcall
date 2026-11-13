// The fast lane serves an answer the brain gave earlier, for the same agent
// snapshot, to the same question. It never composes a new answer. These are
// the pure key and language functions; the database lookup lives elsewhere.

const MAX_KEY_BYTES = 400; // app.voice_answer_cache.key limit, in UTF-8 octets
const MIN_WORDS = 4;
const PARTICLES = new Set(["ah", "lah", "ya", "kan", "eh", "uh", "um"]);
// Dates, amounts and references to earlier turns must never come from cache.
const UNCACHEABLE = new Set([
  "esok",
  "tomorrow",
  "today",
  "tadi",
  "itu",
  "that",
  "it",
  "tu",
]);
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
  if (words.length < MIN_WORDS) return null;
  if (words.some((w) => UNCACHEABLE.has(w))) return null;
  for (let i = 0; i + 1 < words.length; i++)
    if (words[i] === "hari" && words[i + 1] === "ini") return null;
  const key = words.join(" ").replace(/([一-鿿]) (?=[一-鿿])/g, "$1");
  return Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES ? null : key;
}

export function spokenLanguage(transcript: string): "ms" | "en" | "zh" {
  if (CJK.test(transcript)) return "zh";
  return MALAY.test(transcript) ? "ms" : "en";
}
