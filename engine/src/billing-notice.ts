// The owner email sent when the phone line or the WhatsApp agent refuses for
// the plan or the wallet (billing design section 13). Queued by the database
// at most once per organization, reason and Kuala Lumpur day; sent here by
// the engine, never by the agent process. English, then Bahasa Melayu. It
// names the channel, the reason and where to fix it, and nothing about the
// caller or customer: no phone number, no message text.
export type BillingNotice = {
  channel: "phone" | "whatsapp";
  reason: "NO_PHONE_ENTITLEMENT" | "NO_WHATSAPP_ENTITLEMENT" | "WALLET_UNFUNDED" | "WALLET_EXHAUSTED";
  day: string;
};

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

export function billingNoticeMail(n: BillingNotice, appBase: string) {
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
