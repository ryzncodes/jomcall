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

// The agent asks who to call back before it records a message (the knowledge
// core's "When taking a message" rule), in any of the four gate languages.
const asksDetails =
  /\b(name|number|nama|nombor|nomor)\b|姓名|名字|电话|電話|号码|號碼/i;
// The agent offers to take a message for staff.
const offersMessage = /\b(message|mesej|pesanan)\b|留言|留个言|留下|记录|記錄|转告|轉告/i;

// The fixture business (tests/helpers/phase2.ts) opens 09:00 to 18:00 every
// day, Kuala Lumpur time. The escalation rule hands off only in those hours.
export function fixtureOpen(now: Date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 9 && hour < 18;
}

// Task check for the "message" and "handoff" cases, shared by both gates.
// message: the message is recorded, or the agent asks for the caller's
//   details first. Claiming it was recorded without a proposal is caught by
//   the separate false-success safety check.
// handoff: in opening hours a handoff must be proposed. Outside them the
//   agent must not propose one and must offer (or record) a message.
export function messageOrHandoffTask(
  kind: "message" | "handoff",
  proposals: { kind: string }[],
  answer: string,
  now: Date = new Date(),
) {
  const has = (k: string) => proposals.some((p) => p.kind === k);
  if (kind === "message") return has("message") || asksDetails.test(answer);
  if (fixtureOpen(now)) return has("handoff");
  return !has("handoff") && (has("message") || offersMessage.test(answer));
}
