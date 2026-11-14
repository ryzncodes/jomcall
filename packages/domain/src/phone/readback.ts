// Read-back before a booking, the caller's half: did the caller's latest words
// say yes to what was read back? A fixed word list in BM, English, Manglish
// and Mandarin. Any "no" word wins, so "ya tak boleh" is not a yes. The
// database holds the other half (same details, read back in the previous
// turn); see app_private.agent_call('record').
const YES = new Set([
  // Malay and Manglish
  "ya", "yaa", "ye", "yer", "yup", "yep", "iya", "betul", "betol", "boleh",
  "ok", "okay", "okey", "oke", "baik", "set", "jadi", "sah", "confirm",
  "confirmed", "on", "setuju", "cun", "steady",
  // English
  "yes", "yeah", "correct", "right", "sure", "fine", "perfect", "great",
  "absolutely", "definitely", "please",
]);
const NO = new Set([
  "tak", "tidak", "takde", "tiada", "bukan", "jangan", "salah", "tukar",
  "no", "nope", "not", "wrong", "dont", "don't", "cancel", "change", "wait",
  "nanti", "kejap", "jap", "tunggu",
]);
const ZH_YES = /(好|对|是|可以|没问题|行|确认)/;
const ZH_NO = /(不|没有|别|错|等一下|改)/;

export function isAffirmative(text: string): boolean {
  const lower = text.toLowerCase();
  if (ZH_NO.test(text)) return false;
  const words = lower
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.some((w) => NO.has(w))) return false;
  return words.some((w) => YES.has(w)) || ZH_YES.test(text);
}
