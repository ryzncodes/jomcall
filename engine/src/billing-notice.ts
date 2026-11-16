import { z } from "zod";
import { formatSen } from "../../packages/billing/src/money.ts";

// The owner email sent when the phone line or the WhatsApp agent refuses for
// the plan or the wallet (billing design section 13). Queued by the database
// at most once per organization, reason and Kuala Lumpur day; sent here by
// the engine, never by the agent process. English, then Bahasa Melayu. It
// names the channel, the reason and where to fix it, and nothing about the
// caller or customer: no phone number, no message text.
//
// The same queue carries the plan fee emails (channel "plan"), queued by
// app_private.queue_plan_notices at most once per organization, reason and
// period: the next fee is due soon and the wallet is short, a fee is unpaid,
// or the plan stopped. The database checks each again when it is sent and
// skips it when it is no longer true. They carry the plan, whether it
// includes the WhatsApp agent, the fee, the wallet balance at send time and
// the dates, and nothing else.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sen = z.number().int().refine(Number.isSafeInteger);
const notice = z.union([
  z.object({
    channel: z.enum(["phone", "whatsapp"]),
    reason: z.enum(["NO_PHONE_ENTITLEMENT", "NO_WHATSAPP_ENTITLEMENT", "WALLET_UNFUNDED", "WALLET_EXHAUSTED"]),
    day: z.string(),
  }),
  z.object({
    channel: z.literal("plan"),
    reason: z.enum(["PLAN_FEE_DUE", "PLAN_FEE_UNPAID", "PLAN_STOPPED"]),
    plan: z.enum(["starter", "growth"]),
    amountSen: sen,
    balanceSen: sen,
    dueDate: date,
    payBy: date.nullable().optional(),
    // Absent from an older payload: read as false.
    whatsappAgent: z.boolean().optional(),
  }),
]);
export type BillingNotice = z.infer<typeof notice>;
// Reads billing_notice_payload's answer; other fields (emails, ids) pass by.
export const parseBillingNotice = (value: unknown): BillingNotice => notice.parse(value);

// "2026-12-16" as "16 Dec 2026", or "16 Dis 2026" in BM.
// Fixed names, so the text does not depend on the runtime's locale data.
const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ms: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
};
export function noticeDay(d: string, lang: "en" | "ms") {
  const [y, m, day] = date.parse(d).split("-").map(Number);
  return `${day} ${MONTHS[lang][m - 1]} ${y}`;
}

const WHAT = {
  phone: { en: "Phone calls to your JomCall number are not being answered", ms: "Panggilan ke nombor JomCall anda tidak dijawab" },
  whatsapp: { en: "Your JomCall agent is not replying on WhatsApp", ms: "Ejen JomCall anda tidak membalas di WhatsApp" },
};
const WHY = {
  NO_PHONE_ENTITLEMENT: {
    en: "your plan does not include a phone number",
    ms: "pelan anda tidak termasuk nombor telefon",
  },
  NO_WHATSAPP_ENTITLEMENT: {
    en: "your plan does not include the WhatsApp agent",
    ms: "pelan anda tidak termasuk ejen WhatsApp",
  },
  WALLET_UNFUNDED: {
    en: "your wallet has no credit yet",
    ms: "dompet anda belum ada kredit",
  },
  WALLET_EXHAUSTED: {
    en: "your wallet balance has run out",
    ms: "baki dompet anda telah habis",
  },
};

const PLAN = { starter: "Starter", growth: "Growth" };
type PlanNotice = Extract<BillingNotice, { channel: "plan" }>;
function planNoticeMail(n: PlanNotice, where: string) {
  const plan = PLAN[n.plan];
  const amount = formatSen(n.amountSen);
  const balance = formatSen(n.balanceSen);
  // What a top-up must add before the fee can be taken; never below zero.
  const short = formatSen(Math.max(0, n.amountSen - n.balanceSen));
  const due = { en: noticeDay(n.dueDate, "en"), ms: noticeDay(n.dueDate, "ms") };
  const payBy = n.payBy ? { en: noticeDay(n.payBy, "en"), ms: noticeDay(n.payBy, "ms") } : null;
  // What the agent stops answering: WhatsApp only on a plan that includes it.
  const lost = n.whatsappAgent
    ? { en: "phone calls or WhatsApp", ms: "panggilan telefon atau WhatsApp" }
    : { en: "phone calls", ms: "panggilan telefon" };
  let subject: { en: string; ms: string }, body: { en: string; ms: string };
  if (n.reason === "PLAN_FEE_DUE") {
    subject = {
      en: `Your JomCall plan fee is due on ${due.en}`,
      ms: `Yuran pelan JomCall anda perlu dibayar pada ${due.ms}`,
    };
    body = {
      en: `Your ${plan} plan fee of ${amount} is due on ${due.en}. Your wallet has ${balance}. Top up at least ${short} before then so the plan carries on. If the fee stays unpaid, the plan stops and the agent no longer answers ${lost.en}.`,
      ms: `Yuran pelan ${plan} anda sebanyak ${amount} perlu dibayar pada ${due.ms}. Baki dompet anda ${balance}. Tambah nilai sekurang-kurangnya ${short} sebelum tarikh itu supaya pelan diteruskan. Jika yuran terus tidak dibayar, pelan akan dihentikan dan ejen tidak lagi menjawab ${lost.ms}.`,
    };
  } else if (n.reason === "PLAN_FEE_UNPAID") {
    subject = { en: "Your JomCall plan fee is unpaid", ms: "Yuran pelan JomCall anda belum dibayar" };
    // The undated text is a defensive fallback: the database always queues an unpaid notice with payBy, and skips it once the period is no longer unpaid.
    body = payBy
      ? {
          en: `Your ${plan} plan fee of ${amount} was due on ${due.en} and your wallet did not hold it. Top up at least ${short} by ${payBy.en} and the fee is taken by itself. After that date the plan stops and the agent no longer answers ${lost.en}.`,
          ms: `Yuran pelan ${plan} anda sebanyak ${amount} sepatutnya dibayar pada ${due.ms}, tetapi baki dompet anda tidak mencukupi. Tambah nilai sekurang-kurangnya ${short} selewat-lewatnya ${payBy.ms} dan yuran akan ditolak secara automatik. Selepas tarikh itu, pelan akan dihentikan dan ejen tidak lagi menjawab ${lost.ms}.`,
        }
      : {
          en: `Your ${plan} plan fee of ${amount} was due on ${due.en} and your wallet did not hold it. Top up at least ${short} soon and the fee is taken by itself. If the fee stays unpaid, the plan stops and the agent no longer answers ${lost.en}.`,
          ms: `Yuran pelan ${plan} anda sebanyak ${amount} sepatutnya dibayar pada ${due.ms}, tetapi baki dompet anda tidak mencukupi. Tambah nilai sekurang-kurangnya ${short} secepat mungkin dan yuran akan ditolak secara automatik. Jika yuran terus tidak dibayar, pelan akan dihentikan dan ejen tidak lagi menjawab ${lost.ms}.`,
        };
  } else {
    subject = { en: "Your JomCall plan has stopped", ms: "Pelan JomCall anda telah dihentikan" };
    body = {
      en: `Your ${plan} plan stopped because the fee of ${amount} was not paid. The agent no longer answers ${lost.en}. To start again, top up and choose a plan in Billing; it starts the same day.`,
      ms: `Pelan ${plan} anda telah dihentikan kerana yuran sebanyak ${amount} tidak dibayar. Ejen tidak lagi menjawab ${lost.ms}. Untuk mulakan semula, tambah nilai dan pilih pelan di Bil & penggunaan; pelan bermula pada hari yang sama.`,
    };
  }
  return {
    subject: `${subject.en} / ${subject.ms}`,
    text: [
      body.en,
      `Billing: ${where}`,
      "",
      body.ms,
      `Bil & penggunaan: ${where}`,
      "",
      "(We send this once for each plan period. / Kami hantar ini sekali bagi setiap tempoh pelan.)",
    ].join("\n"),
  };
}

export function billingNoticeMail(n: BillingNotice, appBase: string) {
  if (n.channel === "plan") return planNoticeMail(n, `${appBase.replace(/\/+$/, "")}/app/billing`);
  const what = WHAT[n.channel];
  const why = WHY[n.reason];
  const where = `${appBase.replace(/\/+$/, "")}/app/billing`;
  return {
    subject: "JomCall: action needed / tindakan diperlukan",
    text: [
      `${what.en} because ${why.en}.`,
      "Callers and customers are not told why; they get no answer until this is fixed.",
      `Fix it on the wallet page: ${where}`,
      "",
      `${what.ms} kerana ${why.ms}.`,
      "Pemanggil dan pelanggan tidak diberitahu sebabnya; mereka tidak mendapat jawapan sehingga ini dibetulkan.",
      `Betulkan di halaman dompet: ${where}`,
      "",
      `(${n.day}, Asia/Kuala_Lumpur. We send this at most once a day for each reason. / Kami hantar ini paling banyak sekali sehari bagi setiap sebab.)`,
    ].join("\n"),
  };
}
