// Scoring pieces shared by the typed and spoken 48-case gates.

// Conservative wrong-language flag. Evidence is trilingual, so a correct fact
// in the wrong language otherwise passes the content checks.
const malay =
  /\b(ialah|adalah|saya|anda|boleh|setiap|tidak|untuk|yang|kami|maaf)\b/i;
const chinese = /[一-鿿]/;
export function wrongLanguage(language: string, answer: string) {
  if (!answer) return false;
  if (language === "en") return malay.test(answer) || chinese.test(answer);
  if (language === "zh") return malay.test(answer) || !chinese.test(answer);
  return chinese.test(answer);
}

// An answer that declines or asks for clarification instead of inventing.
export const declines =
  /(?:don't|do not|cannot|can't|not available|no information|unsure|not specified|not provided|human|staff|clarif|tak|tidak|tiada|maaf|belum|manusia|kakitangan|不|没有|未|人工|抱歉)/i;
