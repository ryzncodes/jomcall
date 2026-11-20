// The claims the public site must never make (spec section 3, "Banned
// outright"). Each pattern catches an affirmative phrasing. A hit is excused
// only when a short, fixed negation ("does not", "is not", "never", "tidak",
// "belum") sits right before it, with at most one word between and no comma.
// Longer patterns carry their own negation lookahead. `strict` patterns ignore
// negation ("no free trial" still mentions a free trial) and are allowed only
// in the content keys named by `allowIn`.
// A regex list cannot catch every paraphrase: public copy still gets a human read.
export type BannedClaim = { pattern: RegExp; allowIn?: string[]; strict?: boolean; reason: string };

const NEGATION = /(?:\b(?:not|never|cannot|tidak|belum|bukan)|n't)\s+(?:\w+\s+)?$/i;
// Used inside patterns: no negation word later in the same clause.
const NOT_LATER = String.raw`(?![^.,;:]{0,40}\b(?:not|never|yet|waiting|tidak|belum|menunggu)\b)`;
const TRIAL_KEYS = ["faq.trial", "pricing.trial"];

export const BANNED: BannedClaim[] = [
  { pattern: /\bnever miss(?:es)? (?:a |any |another |your )?calls?\b/i, reason: "never miss a call" },
  { pattern: /\bjangan (?:terlepas|lepaskan) (?:sebarang |satu )?panggilan/i, reason: "never miss a call (BM)" },
  { pattern: /\bunlimited (?:calls?|minutes)\b/i, reason: "unlimited calls" },
  { pattern: /\b(?:panggilan|minit) (?:tanpa had|tidak terhad)\b/i, reason: "unlimited calls (BM)" },
  { pattern: /\banswers?\s+(?:all|every|each)\s+(?:of\s+)?(?:your\s+|the\s+)?(?:single\s+)?(?:incoming\s+)?(?:phone\s+)?calls?\b/i, reason: "answers every call" },
  { pattern: /\bmenjawab (?:setiap|semua) panggilan\b/i, reason: "answers every call (BM)" },
  { pattern: /\banswers? (?:many|multiple|several|lots of|hundreds of) calls\b[^.]{0,20}\b(?:at once|at the same time|simultaneously)/i, reason: "answers many calls at once" },
  { pattern: /\bmenjawab (?:banyak|ramai|berbilang) panggilan\b[^.]{0,30}\b(?:serentak|sekali gus|pada masa yang sama)/i, reason: "answers many calls at once (BM)" },
  // A stated wait for the phone number.
  { pattern: /\bwithin \d+ (?:minutes?|hours?)/i, reason: "stated wait for the phone number" },
  { pattern: /\bdalam \d+ (?:minit|jam)/i, reason: "stated wait for the phone number (BM)" },
  { pattern: /\b(?:in|within) (?:a few |just )?minutes\b/i, reason: "stated wait: in minutes" },
  { pattern: /\b(?:in|within) (?:a|one) day\b/i, reason: "stated wait: in a day" },
  { pattern: /\bdalam (?:masa )?(?:sehari|beberapa minit)\b/i, reason: "stated wait (BM)" },
  { pattern: /\b(?:ready|set up|setup|live|active|number)\b[^.,;:]{0,30}\b(?:in|within)\s+(?:\d+|a few|one|two|three)\s+(?:working\s+|business\s+)?(?:minutes?|hours?|days?)\b/i, reason: "stated wait for the phone number" },
  { pattern: /\b(?:siap|sedia|aktif|nombor)\b[^.,;:]{0,30}\bdalam\s+(?:\d+|beberapa|sehari)(?:\s+(?:hari|jam|minit))?/i, reason: "stated wait for the phone number (BM)" },
  // Reading the owner's website or social pages.
  { pattern: /\b(?:imports?|reads?|scans?|crawls?|pulls?|fetch(?:es)?|learns? from)\b[^.;:]{0,40}\b(?:website|web site|facebook|instagram|google maps)\b/i, reason: "imports or reads your website or social pages" },
  { pattern: /\b(?:baca|imbas|import|tarik|ambil)\w*\b[^.;:]{0,40}\b(?:laman web|laman sesawang|facebook|instagram|google maps)\b/i, reason: "imports or reads your website or social pages (BM)" },
  // Recording.
  { pattern: /\bcalls?\s+(?:(?:are|is|will be|get|gets)\s+)?recorded\b/i, reason: "calls are recorded" },
  { pattern: /\bwe\s+(?:may\s+|will\s+|can\s+)?record\b(?!\s+(?:nothing|no\b|none))/i, reason: "we record" },
  { pattern: /\brecords?\s+(?:your\s+|all\s+|the\s+|every\s+)?calls?\b/i, reason: "records calls" },
  { pattern: new RegExp(String.raw`\brecordings?\b${NOT_LATER}[^.,;:]{0,20}\b(?:stored|kept|saved|retained)\b`, "i"), reason: "recordings are kept" },
  { pattern: /\brakaman\b(?![^.,;:]{0,30}\b(?:tidak|belum)\b)[^.,;:]{0,20}\b(?:disimpan|disimpankan)\b/i, reason: "recordings are kept (BM)" },
  { pattern: /\bpanggilan (?:anda )?(?:akan )?(?:dirakam|direkod)\b/i, reason: "calls are recorded (BM)" },
  { pattern: /\bkami (?:merakam|rakam)\b/i, reason: "we record (BM)" },
  // Free trial: only in the FAQ answer or pricing note that says there is none.
  { pattern: /\bfree[- ]trial\b/i, allowIn: TRIAL_KEYS, strict: true, reason: "free trial" },
  { pattern: /\b(?:try (?:it |jomcall )?free|start free|free for \d+ (?:days?|weeks?|months?))\b/i, allowIn: TRIAL_KEYS, strict: true, reason: "free trial" },
  { pattern: /\b(?:percubaan percuma|cuba (?:secara )?percuma)\b/i, allowIn: TRIAL_KEYS, strict: true, reason: "free trial (BM)" },
  // PDPA.
  { pattern: /\bPDPA[- ](?:compliant|certified|ready|safe)\b/i, reason: "PDPA compliant" },
  { pattern: /\b(?:compliant|compliance|certified|ready)\b[^.,;:]{0,20}\bPDPA\b/i, reason: "PDPA compliant" },
  { pattern: /\b(?:mematuhi|patuh|pematuhan)\b[^.,;:]{0,20}\bPDPA\b/i, reason: "PDPA compliant (BM)" },
  { pattern: /\bPDPA (?:patuh|dipatuhi)\b/i, reason: "PDPA compliant (BM)" },
  // Tamil.
  { pattern: /\b(?:speaks?|supports?|understands?|answers? in|languages?:?)\b[^.]{0,80}\btamil\b/i, reason: "Tamil listed as supported" },
  { pattern: /\b(?:bercakap|menyokong|memahami|menjawab dalam)\b[^.]{0,80}\btamil\b/i, reason: "Tamil listed as supported (BM)" },
  { pattern: /\btamil\s+(?:supported|available|tersedia|disokong)\b/i, reason: "Tamil listed as supported" },
  { pattern: /\bbahasa tamil\s+(?:disokong|tersedia)\b/i, reason: "Tamil listed as supported (BM)" },
  { pattern: /(?:,|\b(?:and|dan|or|atau))\s*(?:bahasa\s+)?tamil\b/i, reason: "Tamil listed as supported" },
  // Calendar sync.
  { pattern: /\bcalendar sync/i, reason: "calendar sync" },
  { pattern: /\bsyncs?\b[^.,;:]{0,25}\bcalendar\b/i, reason: "syncs with a calendar" },
  { pattern: /\bcalendar\b[^.,;:]{0,15}\bsync/i, reason: "calendar sync" },
  { pattern: /\bsegerak\w*\b[^.,;:]{0,25}\bkalendar\b/i, reason: "calendar sync (BM)" },
  // Instant booking alerts.
  { pattern: /\binstant(?:ly)?\b[^.]{0,20}\b(?:alerts?|notif\w+)\b/i, reason: "instant booking alerts" },
  { pattern: /\b(?:alerts?|alerted|notified?|notifications?)\b[^.]{0,25}\b(?:instantly|immediately|right away)\b/i, reason: "instant booking alerts" },
  { pattern: /\b(?:notifikasi|makluman|amaran)\b[^.]{0,25}\b(?:segera|serta-merta)\b/i, reason: "instant booking alerts (BM)" },
  // WhatsApp as available.
  { pattern: new RegExp(String.raw`\bwhatsapp\b${NOT_LATER}[^.,;:]{0,40}\b(?:available|live|ready)\b`, "i"), reason: "WhatsApp described as available" },
  { pattern: /\b(?:available|chat|works?|live|ready)\s+(?:on|with|via|through)\s+whatsapp\b/i, reason: "WhatsApp described as available" },
  { pattern: /\banswers?\b[^.,;:]{0,30}\bwhatsapp\b/i, reason: "WhatsApp described as answered by JomCall" },
  { pattern: /\bwhatsapp\s+(?:tersedia|aktif)\b/i, reason: "WhatsApp described as available (BM)" },
  { pattern: /\b(?:jawab\w*|menjawab)\s+(?:[^.,;:]{0,30}\s)?whatsapp\b/i, reason: "WhatsApp described as answered (BM)" },
  { pattern: new RegExp(String.raw`\bwhatsapp\b(?![^.,;:]{0,40}\b(?:tidak|belum|menunggu)\b)[^.,;:]{0,40}\b(?:sudah|kini|telah)\s+(?:tersedia|aktif|dibuka)\b`, "i"), reason: "WhatsApp described as available (BM)" },
];

// Returns one message per banned claim found in `text`. `where` is the content
// key path of the string (for example "faq.trial" or "home.hero.lead").
export function findBannedClaims(text: string, where: string): string[] {
  const hits: string[] = [];
  for (const { pattern, allowIn, strict, reason } of BANNED) {
    if (allowIn?.some((key) => where === key || where.startsWith(`${key}.`) || where.includes(`.${key}.`) || where.endsWith(`.${key}`))) continue;
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      if (!strict && NEGATION.test(text.slice(Math.max(0, at - 24), at))) continue;
      hits.push(`${where}: ${reason}: "${m[0]}"`);
      break;
    }
  }
  return hits;
}
