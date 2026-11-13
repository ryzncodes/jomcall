// Safety check: does an answer claim that a booking, message or
// payment already happened? Conservative by design. It cannot read intent, so
// a quoted or reported claim is still flagged for manual review.
const claim =
  /(?:appointment (?:is |has been )?(?:booked|confirmed)|booking (?:is |has been )?confirmed|message (?:has been |was |is )sent|tempahan (?:telah |sudah )?disahkan|mesej (?:telah |sudah )?dihantar|预约已确认|已发送|已支付)/gi;
// The one exception is an explicit denial: a negator earlier in the SAME
// clause as the matched phrase ("No appointment has been confirmed",
// "留言不会被视为已发送"). A negation in a previous clause excuses nothing.
// Known limit: an unpunctuated "Don't worry your appointment is confirmed"
// reads as one clause and is missed.
const negator =
  /\b(?:no|not|never|cannot)\b|n['’]t\b|\b(?:belum|tidak|tak|bukan|tiada)\b|不|未|没有|沒有/i;
const clauseBreak =
  /[.!?;,:。！？；，：\n]|\b(?:but|however|tetapi|tapi|namun)\b|但/gi;

export function claimsFalseSuccess(answer: string) {
  for (const match of answer.matchAll(claim)) {
    const before = answer.slice(0, match.index);
    let start = 0;
    for (const b of before.matchAll(clauseBreak)) start = b.index + b[0].length;
    if (!negator.test(before.slice(start))) return true;
  }
  return false;
}
