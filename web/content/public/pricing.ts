// The pricing page, in English and Bahasa Melayu (spec sections 3, 5 and 10).
// Amounts come from web/lib/pricing.ts, never typed by hand. WhatsApp appears
// only as waiting for Meta's approval. The FAQ is `FaqItem[]` so the
// structured-data task can read it with `pricingFaq(locale)`.
import { publicPlans, publicPrices } from "../../lib/pricing.ts";
import { whatsappWaiting } from "../../lib/launch.ts";
import { rmExact } from "./format.ts";
import type { Bilingual, FaqItem } from "./types.ts";

const [starter, growth, payg] = publicPlans;
const mins = (seconds: number) => String(seconds / 60);
const perMinute = rmExact(publicPrices.voiceSenPerMinute);
const perConversation = rmExact(publicPrices.whatsappAgentSenPerConversation);
const [waitEn, waitMs] = whatsappWaiting.short;

export type PlanCopy = {
  name: string;
  price: string;
  per: string;
  body: string;
  features: string[];
  missing: string[];
};

const en = {
  meta: {
    title: "Pricing in RM: plans and a call estimator",
    description: `Starter ${rmExact(starter.monthlyFeeSen)} a month, Growth ${rmExact(growth.monthlyFeeSen)}, or pay as you go. A prepaid wallet in RM: estimate your month from the minutes you expect.`,
  },
  hero: {
    h1: "Simple prices, in ringgit.",
    lead: "Pick a monthly plan, or pay as you go. Everything comes out of a prepaid wallet in MYR, and no card is charged automatically.",
  },
  plans: {
    heading: "Three ways to pay",
    choose: "Choose in Billing",
    plans: {
      starter: {
        name: "Starter",
        price: rmExact(starter.monthlyFeeSen),
        per: "a month",
        body: "One phone number for your business.",
        features: [
          `${starter.phoneNumbers} phone number`,
          `${mins(starter.includedVoiceSeconds)} minutes each month`,
          `Then ${perMinute} a minute, billed per second`,
        ],
        missing: ["No WhatsApp agent"],
      },
      growth: {
        name: "Growth",
        price: rmExact(growth.monthlyFeeSen),
        per: "a month",
        body: "More minutes for a busier line.",
        features: [
          `${growth.phoneNumbers} phone number`,
          `${mins(growth.includedVoiceSeconds)} minutes each month`,
          `Then ${perMinute} a minute, billed per second`,
          `WhatsApp agent: ${waitEn}. Once it opens, JomCall's fee is ${perConversation} a conversation, and Meta bills its own message fees to you.`,
        ],
        missing: [],
      },
      payg: {
        name: "Pay as you go",
        price: rmExact(payg.monthlyFeeSen),
        per: "a month",
        body: "No monthly fee and no phone number, so it suits browser tests only. Choose Starter or Growth to take phone calls.",
        features: ["Top up your wallet when you need to", "Test your agent in the browser"],
        missing: ["No phone number, so no phone calls"],
      },
    } satisfies Record<(typeof publicPlans)[number]["code"], PlanCopy>,
    note: "Prices are in MYR, before SST. Unused minutes do not carry over to the next month.",
  },
  estimator: {
    heading: "Estimate your month",
    lead: "Move the slider or type the voice minutes you expect. Each figure is the plan fee plus any minutes beyond its allowance.",
    sliderLabel: "Voice minutes a month",
    inputLabel: "Type the minutes",
    unit: "minutes",
    included: (n: number) => `${n} minutes included`,
    nothingIncluded: "No minutes included",
    noPhone: "Cannot take phone calls",
    cheapest: "Lowest for phone calls",
    resultsLabel: "Estimated month on each plan",
    summary: (minutes: number, plan: string, amount: string) =>
      `At ${minutes.toLocaleString("en-MY")} minutes a month, ${plan} costs ${amount}, the lowest plan that takes phone calls.`,
    fine: "An estimate from the rates below, before SST. It does not include Meta's WhatsApp message fees.",
  },
  rates: {
    heading: "The rates",
    rows: [
      { label: "Voice minute beyond your allowance", value: `${perMinute} a minute`, note: "Billed per second." },
      { label: "WhatsApp agent conversation", value: `${perConversation} a conversation`, note: `Not open yet: ${waitEn}. Meta bills its message fees to you.` },
    ],
  },
  self: {
    heading: "Prefer to run it yourself?",
    body: "JomCall's code is public under FSL-1.1-ALv2 and you may self-host it. Self-hosting is not free of cost: you bring the server, the speech and language keys and the phone carrier.",
    link: "Self-hosting guide",
    source: "Source on GitHub",
  },
  faq: {
    heading: "Questions about prices",
    items: [
      {
        q: "How does the wallet work?",
        a: "You top up a prepaid wallet in ringgit. Plan fees and any minutes beyond your allowance come out of it, and every entry shows in your usage list. No card is charged automatically, so nothing is taken unless you top up.",
      },
      {
        q: "What does a minute cost past my allowance?",
        a: `Each voice minute beyond your plan's allowance costs ${perMinute}. It is billed per second, so a short call is not rounded up to a full minute.`,
      },
      {
        q: "Can I change plans?",
        a: "Yes, on the Billing page. A change applies from your next monthly period. Your first paid plan starts straight away with its full fee, as long as your wallet covers it.",
      },
      {
        q: "What does pay as you go mean?",
        a: "No monthly fee, and no phone number, so it cannot take phone calls. Use it to test your agent in the browser, then choose Starter or Growth when you are ready for real calls.",
      },
      {
        q: "What about WhatsApp?",
        a: `${whatsappWaiting.title[0]}. Growth is the plan that includes the WhatsApp agent once Meta approves. Phone calls do not wait for this, and we will tell you when it opens.`,
      },
    ] satisfies FaqItem[],
    // Kept under its own key: the one answer allowed to say what is not offered.
    trial: {
      q: "Is there a free trial?",
      a: `No, there is no free trial. Starter costs ${rmExact(starter.monthlyFeeSen)} a month, and you can test your agent in the browser on pay as you go before you pay any plan fee.`,
    } satisfies FaqItem,
  },
  closing: {
    heading: "Ready to set up your receptionist?",
    body: "Set up your business and test the agent in your browser before you choose a plan.",
  },
};

const ms: typeof en = {
  meta: {
    title: "Harga dalam RM: pelan dan anggaran panggilan",
    description: `Starter ${rmExact(starter.monthlyFeeSen)} sebulan, Growth ${rmExact(growth.monthlyFeeSen)}, atau bayar mengikut guna. Dompet prabayar dalam RM: anggarkan bulan anda daripada minit yang anda jangka.`,
  },
  hero: {
    h1: "Harga yang mudah, dalam ringgit.",
    lead: "Pilih pelan bulanan, atau bayar mengikut guna. Semuanya ditolak daripada dompet prabayar dalam MYR, dan tiada kad dicaj secara automatik.",
  },
  plans: {
    heading: "Tiga cara membayar",
    choose: "Pilih dalam Bil",
    plans: {
      starter: {
        name: "Starter",
        price: rmExact(starter.monthlyFeeSen),
        per: "sebulan",
        body: "Satu nombor telefon untuk perniagaan anda.",
        features: [
          `${starter.phoneNumbers} nombor telefon`,
          `${mins(starter.includedVoiceSeconds)} minit setiap bulan`,
          `Selepas itu ${perMinute} seminit, dicaj mengikut saat`,
        ],
        missing: ["Tiada ejen WhatsApp"],
      },
      growth: {
        name: "Growth",
        price: rmExact(growth.monthlyFeeSen),
        per: "sebulan",
        body: "Lebih banyak minit untuk talian yang lebih sibuk.",
        features: [
          `${growth.phoneNumbers} nombor telefon`,
          `${mins(growth.includedVoiceSeconds)} minit setiap bulan`,
          `Selepas itu ${perMinute} seminit, dicaj mengikut saat`,
          `Ejen WhatsApp: ${waitMs}. Apabila dibuka, yuran JomCall ialah ${perConversation} setiap perbualan, dan Meta mengecaj yuran mesejnya sendiri kepada anda.`,
        ],
        missing: [],
      },
      payg: {
        name: "Bayar mengikut guna",
        price: rmExact(payg.monthlyFeeSen),
        per: "sebulan",
        body: "Tiada yuran bulanan dan tiada nombor telefon, jadi ia sesuai untuk ujian dalam pelayar sahaja. Pilih Starter atau Growth untuk menerima panggilan telefon.",
        features: ["Tambah nilai dompet bila perlu", "Uji ejen anda dalam pelayar"],
        missing: ["Tiada nombor telefon, jadi tiada panggilan telefon"],
      },
    } satisfies Record<(typeof publicPlans)[number]["code"], PlanCopy>,
    note: "Harga dalam MYR, sebelum SST. Minit yang tidak digunakan tidak dibawa ke bulan berikutnya.",
  },
  estimator: {
    heading: "Anggarkan bulan anda",
    lead: "Gerakkan peluncur atau taip minit suara yang anda jangka. Setiap angka ialah yuran pelan campur minit yang melebihi kuota.",
    sliderLabel: "Minit suara sebulan",
    inputLabel: "Taip bilangan minit",
    unit: "minit",
    included: (n: number) => `${n} minit termasuk`,
    nothingIncluded: "Tiada minit termasuk",
    noPhone: "Tidak boleh menerima panggilan telefon",
    cheapest: "Termurah untuk panggilan telefon",
    resultsLabel: "Anggaran sebulan bagi setiap pelan",
    summary: (minutes: number, plan: string, amount: string) =>
      `Pada ${minutes.toLocaleString("en-MY")} minit sebulan, ${plan} berharga ${amount}, pelan paling murah yang menerima panggilan telefon.`,
    fine: "Anggaran berdasarkan kadar di bawah, sebelum SST. Ia tidak termasuk yuran mesej WhatsApp daripada Meta.",
  },
  rates: {
    heading: "Kadar",
    rows: [
      { label: "Minit suara melebihi kuota anda", value: `${perMinute} seminit`, note: "Dicaj mengikut saat." },
      { label: "Perbualan ejen WhatsApp", value: `${perConversation} setiap perbualan`, note: `Belum dibuka: ${waitMs}. Meta mengecaj yuran mesejnya kepada anda.` },
    ],
  },
  self: {
    heading: "Mahu menjalankannya sendiri?",
    body: "Kod JomCall terbuka kepada umum di bawah FSL-1.1-ALv2 dan anda boleh menjalankannya sendiri. Ia bukan tanpa kos: anda perlu menyediakan pelayan, kunci suara dan bahasa serta pembawa telefon.",
    link: "Panduan pasang sendiri",
    source: "Kod di GitHub",
  },
  faq: {
    heading: "Soalan tentang harga",
    items: [
      {
        q: "Bagaimana dompet berfungsi?",
        a: "Anda menambah nilai dompet prabayar dalam ringgit. Yuran pelan dan minit yang melebihi kuota ditolak daripadanya, dan setiap catatan boleh dilihat dalam senarai penggunaan. Tiada kad dicaj secara automatik, jadi tiada wang diambil melainkan anda menambah nilai.",
      },
      {
        q: "Berapa harga seminit selepas kuota habis?",
        a: `Setiap minit suara melebihi kuota pelan anda berharga ${perMinute}. Ia dicaj mengikut saat, jadi panggilan pendek tidak dibundarkan ke satu minit penuh.`,
      },
      {
        q: "Bolehkah saya menukar pelan?",
        a: "Boleh, di halaman Bil. Perubahan bermula pada tempoh bulanan anda yang seterusnya. Pelan berbayar pertama anda bermula serta-merta dengan yuran penuh, selagi dompet anda mencukupi.",
      },
      {
        q: "Apa maksud bayar mengikut guna?",
        a: "Tiada yuran bulanan, dan tiada nombor telefon, jadi ia tidak boleh menerima panggilan telefon. Gunakannya untuk menguji ejen anda dalam pelayar, kemudian pilih Starter atau Growth apabila anda bersedia untuk panggilan sebenar.",
      },
      {
        q: "Bagaimana dengan WhatsApp?",
        a: `${whatsappWaiting.title[1]}. Growth ialah pelan yang menyertakan ejen WhatsApp selepas Meta meluluskannya. Panggilan telefon tidak perlu menunggu, dan kami akan maklumkan apabila ia dibuka.`,
      },
    ] satisfies FaqItem[],
    trial: {
      q: "Adakah ada percubaan percuma?",
      a: `Tidak, tiada percubaan percuma. Starter berharga ${rmExact(starter.monthlyFeeSen)} sebulan, dan anda boleh menguji ejen anda dalam pelayar pada bayar mengikut guna sebelum membayar sebarang yuran pelan.`,
    } satisfies FaqItem,
  },
  closing: {
    heading: "Sedia menyediakan penyambut tetamu anda?",
    body: "Sediakan perniagaan anda dan uji ejen dalam pelayar sebelum memilih pelan.",
  },
};

export const pricing: Bilingual<typeof en> = { en, ms };

// The six questions in the order the page shows them: the trial answer sits
// fifth, before WhatsApp. Read by the page and by the structured data.
export function pricingFaq(locale: "en" | "ms"): FaqItem[] {
  const { items, trial } = pricing[locale].faq;
  return [...items.slice(0, 4), trial, ...items.slice(4)];
}
