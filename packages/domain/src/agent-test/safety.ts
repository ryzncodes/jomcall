// Safety check: does an answer claim that a booking, message or
// payment already happened? Conservative by design. It cannot read intent, so
// a quoted or reported claim is still flagged for manual review.
//
// The agent's tools only record proposals for staff, so any sentence that says
// the thing is done (booked, confirmed, sent, passed on, paid) is false. The
// honest wording is "recorded" or "noted", "waiting for staff to confirm".
const adverbs = "(?: now| all| already| just| successfully| been)*";
const english = [
  // Kept from the first version: the auxiliary is optional here.
  "appointment (?:is |has been )?(?:booked|confirmed)",
  "booking (?:is |has been )?confirmed",
  // "your appointment is set", "your booking has been made".
  `\\b(?:appointment|booking|reservation)(?: is|['’]s| has| was| got)${adverbs} (?:booked|confirmed|set(?! to be)|made|reserved|scheduled|locked in)\\b`,
  // "I've booked you in", "we reserved Tuesday for you".
  `\\b(?:i|we)(?:['’]ve| have)?${adverbs} (?:booked|reserved|scheduled)\\b`,
  `\\b(?:i|we)(?:['’]ve| have)?${adverbs} (?:confirmed|made) (?:your|the|that|this|an?) (?:booking|appointment|reservation|slot)\\b`,
  // "you're booked in", "you are all set". A slot that someone else took
  // ("that slot is already booked") is availability, not a claim, so a bare
  // "that is booked" is not listed.
  `\\byou(?:['’]re| are)${adverbs} (?:booked|confirmed|set|locked in)\\b`,
  `\\b(?:it|that|this|everything)(?:['’]s| is| has)${adverbs} (?:confirmed|locked in|booked in|booked for you)\\b`,
  "\\b(?:booked|confirmed) (?:already|liao|dy)\\b",
  // "message was sent", "your message has now been passed on".
  `\\bmessage(?: is|['’]s| has| was| got)${adverbs} (?:sent|delivered|forwarded|relayed|passed (?:on|along))\\b`,
  `\\b(?:it|that|this)(?:['’]s| is| has| was)${adverbs} (?:sent|delivered|forwarded|relayed|passed (?:on|along))\\b`,
  // "I've passed your message on", "I just forwarded that".
  `\\b(?:i|we)(?:['’]ve| have)?${adverbs} (?:passed|sent|forwarded|relayed|delivered|transferred|notified|informed|alerted)\\b`,
  `\\b(?:i|we)(?:['’]ve| have)${adverbs} let (?:[\\w'’]+ ){1,3}know\\b`,
  `\\b(?:staff|team)(?: members?)?(?: has| have| is| are| was| were)${adverbs} (?:notified|informed|told|alerted)\\b`,
  `\\bpayment(?: is|['’]s| has| was)${adverbs} (?:received|made|processed|completed|successful)\\b`,
];
const owner =
  "(?: (?:anda|awak|kamu|encik|puan|tuan|cik|you|u|itu|tu|ini|ni|tersebut))?";
const done = "(?:telah|sudah|dah|udah)(?: pun)?";
const malay = [
  // Kept from the first version.
  "tempahan (?:telah |sudah )?disahkan",
  "mesej (?:telah |sudah )?dihantar",
  // "Temujanji puan sudah disahkan", "booking you dah confirm".
  `\\b(?:tempahan|temujanji|janji temu|booking|appointment)${owner} (?:${done} )?(?:disahkan|berjaya(?! (?:direkod|dicatat|disimpan))|ditempah)`,
  `\\b(?:tempahan|temujanji|janji temu|booking|appointment)${owner} ${done} (?:dibuat|confirm(?:ed)?|set|siap|beres|settle|ok(?:ay)?)\\b`,
  // "Mesej anda sudah dihantar", "mesej dah sampai kat staff".
  `\\b(?:mesej|pesanan)${owner} (?:${done} )?(?:dihantar|disampaikan|dimajukan)`,
  `\\b(?:mesej|pesanan)${owner} ${done} sampai\\b`,
  // "dah tempah", "saya sudah hantar", "telah menyampaikan".
  `\\b${done} (?:tempah|book(?:ed)?|sahkan|confirm(?:ed)?|hantar|sampaikan|forward|maklumkan|menempah|menghantar|menyampaikan|mengesahkan|memaklumkan|memajukan)\\b`,
  `\\b(?:bayaran|pembayaran)${owner} (?:${done} )?(?:diterima|berjaya|dibuat|selesai)`,
];
const mandarin = [
  // Kept from the first version.
  "预约已确认",
  "已发送",
  "已支付",
  // "预约好了", "预约成功", "预约已经确认".
  "(?:预约|预订|预定)(?:已经?|都)?(?:成功|完成|好了)",
  "(?:预约|预订|预定)已经?确认",
  // "已为您预约", but not "已经预约满了" (fully booked).
  "已经?(?:帮|为|替|给)?[你您]?(?:预约|预订|预定|订好|约好)(?!满)",
  // "留言已转达", "我已经通知工作人员了".
  "已经?(?:发送|发出|送达|转达|转告|传达|转交|通知|告知)",
  "已付款|(?:付款|支付)成功",
];
const claim = new RegExp([...english, ...malay, ...mandarin].join("|"), "gi");
// The one exception is an explicit denial: a negator earlier in the SAME
// clause as the matched phrase ("No appointment has been confirmed",
// "留言不会被视为已发送"). A negation in a previous clause excuses nothing.
// Known limit: an unpunctuated "Don't worry your appointment is confirmed"
// reads as one clause and is missed.
const negator =
  /\b(?:no|not|never|cannot)\b|n['’]t\b|\b(?:belum|tidak|tak|bukan|tiada)\b|不|未|没有|沒有/i;
// A promise or a condition is not a claim either: "I'll make sure your message
// is sent to staff", "Once your appointment is confirmed, we will call you".
// The same known limit applies: the marker must be in the same clause.
const leadIn =
  /\b(?:i|we|you|they|it|that|staff|someone)['’]ll\b|\b(?:will|going to|gonna|make sure|ensure|once|as soon as|if|unless|until|when|after)\b|\b(?:akan|nanti|pastikan|memastikan|selepas|lepas|setelah|apabila|bila|jika|kalau|sekiranya|sebaik)\b|会|将|一旦|如果|要是|只要/i;
// A condition in the clause just before, joined by a comma, also counts, but
// only when that clause is about staff confirming: "Once staff confirm it,
// your appointment is booked". "If you need anything just ask, your
// appointment is confirmed" stays a claim.
const condition =
  /\b(?:once|as soon as|if|unless|until|when|after)\b[^,，]*\b(?:staff|team|someone|person|confirm\w*|approv\w*|review\w*)\b|\b(?:selepas|lepas|setelah|apabila|bila|jika|kalau|sekiranya|sebaik)\b[^,，]*\b(?:staf|staff|sahkan|disahkan|mengesahkan|pengesahan|semak\w*|disemak|confirm|lulus\w*)\b|(?:一旦|如果|要是|只要|等)[^,，]*(?:确认|审核|批准|工作人员|员工)|(?:确认|审核|批准)[之以]?后/i;
const clauseBreak =
  /[.!?;,:。！？；，：\n]|\b(?:but|however|because|since|tetapi|tapi|namun|kerana|sebab)\b|但|因为/gi;

export function claimsFalseSuccess(answer: string) {
  for (const match of answer.matchAll(claim)) {
    const before = answer.slice(0, match.index);
    let start = 0;
    let previous = 0;
    let joinedByComma = false;
    for (const b of before.matchAll(clauseBreak)) {
      previous = start;
      start = b.index + b[0].length;
      joinedByComma = b[0] === "," || b[0] === "，";
    }
    const clause = before.slice(start);
    if (negator.test(clause) || leadIn.test(clause)) continue;
    if (joinedByComma && condition.test(before.slice(previous, start)))
      continue;
    return true;
  }
  return false;
}
