// The claims the public site must never make (spec section 3, "Banned
// outright"). Each pattern catches the affirmative phrasing; the negations the
// site is required to say ("Calls are not recorded", "There is no free trial")
// must pass. `strict` patterns ignore negation ("no free trial" is still a
// mention of a free trial) and are allowed only where `allowIn` says. `allowIn` names the content key where a phrase is permitted.
export type BannedClaim = { pattern: RegExp; allowIn?: string[]; strict?: boolean; reason: string };

// "no", "not", "never", "tidak" ... directly before a phrase turns it into a
// denial. Checked in the 20 characters before a match, same sentence.
const NEGATION =
  /\b(not|no|never|isn'?t|aren'?t|doesn'?t|don'?t|cannot|can'?t|without|tidak|bukan|belum|tiada|tanpa)\b[^.!?\n]{0,20}$/i;

export const BANNED: BannedClaim[] = [
  { pattern: /\bnever miss (a|any|another) call/i, reason: "never miss a call" },
  { pattern: /\bjangan (terlepas|lepaskan) (sebarang |satu )?panggilan/i, reason: "never miss a call (BM)" },
  { pattern: /\bunlimited (calls?|minutes)\b/i, reason: "unlimited calls" },
  { pattern: /\b(panggilan|minit) (tanpa had|tidak terhad)\b/i, reason: "unlimited calls (BM)" },
  { pattern: /\banswers? (every|all) (single )?(incoming )?calls?\b/i, reason: "answers every call" },
  { pattern: /\bmenjawab (setiap|semua) panggilan\b/i, reason: "answers every call (BM)" },
  { pattern: /\banswers? (many|multiple|several|lots of|hundreds of) calls\b[^.]{0,20}\b(at once|at the same time|simultaneously)/i, reason: "answers many calls at once" },
  { pattern: /\bmenjawab (banyak|ramai|berbilang) panggilan\b[^.]{0,30}\b(serentak|sekali gus|pada masa yang sama)/i, reason: "answers many calls at once (BM)" },
  { pattern: /within \d+ (minutes?|hours?)/i, reason: "stated wait for the phone number" },
  { pattern: /dalam \d+ (minit|jam)/i, reason: "stated wait for the phone number (BM)" },
  { pattern: /\b(in|within) (a few |just )?minutes\b/i, reason: "stated wait: in minutes" },
  { pattern: /\bdalam (masa )?beberapa minit\b/i, reason: "stated wait: in minutes (BM)" },
  { pattern: /(import|read)s? (from )?your (website|facebook|instagram|google maps)/i, reason: "imports or reads your website or social pages" },
  { pattern: /\b(baca|import|tarik)\w* (dari|daripada) (laman web|laman sesawang|facebook|instagram|google maps)\s+(anda|awak|kamu)/i, reason: "imports or reads your website or social pages (BM)" },
  { pattern: /\bcalls? (are|is|will be|get|gets) recorded\b/i, reason: "calls are recorded" },
  { pattern: /\bwe record\b/i, reason: "we record" },
  { pattern: /\bpanggilan (anda )?(akan )?(dirakam|direkod)\b/i, reason: "calls are recorded (BM)" },
  { pattern: /\bkami (merakam|rakam)\b/i, reason: "we record (BM)" },
  { pattern: /\bfree[- ]trial\b/i, allowIn: ["faq.trial", "pricing.trial"], strict: true, reason: "free trial" },
  { pattern: /\bpercubaan percuma\b/i, allowIn: ["faq.trial", "pricing.trial"], strict: true, reason: "free trial (BM)" },
  { pattern: /\bPDPA[- ](compliant|certified)\b/i, reason: "PDPA compliant" },
  { pattern: /\b(mematuhi|patuh) PDPA\b/i, reason: "PDPA compliant (BM)" },
  { pattern: /\b(speaks?|supports?|understands?|answers? in|languages?:?)[^.]{0,80}\btamil\b/i, reason: "Tamil listed as supported" },
  { pattern: /\b(bercakap|menyokong|memahami|menjawab dalam)[^.]{0,80}\b(bahasa )?tamil\b/i, reason: "Tamil listed as supported (BM)" },
  { pattern: /\bcalendar sync/i, reason: "calendar sync" },
  { pattern: /\bsyncs? (with|to) google calendar\b/i, reason: "syncs with Google Calendar" },
  { pattern: /\bsegerak(kan)? (dengan )?(kalendar|google calendar)\b/i, reason: "calendar sync (BM)" },
  { pattern: /\binstant (booking )?(alerts?|notifications?)\b/i, reason: "instant booking alerts" },
  { pattern: /\bnotifikasi segera\b/i, reason: "instant booking alerts (BM)" },
  { pattern: /\bwhatsapp\b(?![^.]{0,40}\b(not|yet|waiting|no)\b)[^.]{0,40}\b(available|live|ready)\b/i, reason: "WhatsApp described as available" },
  { pattern: /\bwhatsapp\b(?![^.]{0,40}\b(tidak|belum|menunggu)\b)[^.]{0,40}\b(sudah|kini|telah)\s+(tersedia|aktif|dibuka)\b/i, reason: "WhatsApp described as available (BM)" },
];

// Returns one message per banned claim found in `text`. `where` is the content
// key path of the string (for example "faq.trial" or "home.hero.lead").
export function findBannedClaims(text: string, where: string): string[] {
  const hits: string[] = [];
  for (const { pattern, allowIn, strict, reason } of BANNED) {
    if (allowIn?.some((key) => where === key || where.startsWith(`${key}.`) || where.includes(`.${key}.`) || where.endsWith(`.${key}`))) continue;
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0);
      if (!strict && NEGATION.test(before)) continue;
      hits.push(`${where}: ${reason}: "${m[0]}"`);
      break;
    }
  }
  return hits;
}
