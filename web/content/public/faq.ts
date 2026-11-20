// The FAQ hub, in English and Bahasa Melayu (spec sections 3, 5 and 10): six
// groups in the order of spec section 5. Each group keeps its questions under
// a key named `faq`, so the trial answer's key path ends in `faq.trial`, the
// one place the claims guard lets the copy say there is no free trial. Each
// answer stands on its own, because answer engines quote it alone. Amounts
// come from web/lib/pricing.ts; WhatsApp appears only as waiting for Meta.
import { publicPlans, publicPrices } from "../../lib/pricing.ts";
import { whatsappWaiting } from "../../lib/launch.ts";
import { FORWARD_CODES } from "./call-forwarding.ts";
import { rm } from "./format.ts";
import type { Bilingual, FaqItem, PageCopy } from "./types.ts";

const [starter, growth, payg] = publicPlans;
const mins = (seconds: number) => seconds / 60;
const perMinute = rm(publicPrices.voiceSenPerMinute);
const [waitTitleEn, waitTitleMs] = whatsappWaiting.title;
const [fwdAll, fwdNoAnswer, fwdBusy] = FORWARD_CODES;

export const FAQ_GROUPS = ["price", "number", "languages", "ai", "privacy", "whatsapp"] as const;
export type FaqGroupId = (typeof FAQ_GROUPS)[number];

type Group = { heading: string; faq: Record<string, FaqItem> };

export type FaqCopy = {
  page: PageCopy;
  groups: Record<FaqGroupId, Group>;
};

const en: FaqCopy = {
  page: {
    title: "Questions about JomCall, answered",
    description:
      "Straight answers about JomCall: prices and billing, phone numbers and call forwarding, languages, what the AI does and does not do, privacy, and WhatsApp while it waits for Meta's approval.",
    h1: "Questions, answered",
    lead: "Short answers about prices, your phone number, languages, what the agent does and does not do, privacy, and WhatsApp while it waits for Meta's approval. Each answer stands on its own.",
  },
  groups: {
    price: {
      heading: "Price and billing",
      faq: {
        cost: {
          q: "How much does JomCall cost?",
          a: `Starter is ${rm(starter.monthlyFeeSen)} a month with one phone number and ${mins(starter.includedVoiceSeconds)} minutes. Growth is ${rm(growth.monthlyFeeSen)} a month with one phone number and ${mins(growth.includedVoiceSeconds)} minutes. Pay as you go has no monthly fee (${rm(payg.monthlyFeeSen)}) and no phone number.`,
        },
        trial: {
          q: "Is there a free trial?",
          a: "No, there is no free trial. You can set up your agent and test it in your browser on pay as you go before you pay any plan fee.",
        },
        wallet: {
          q: "How do I pay for JomCall?",
          a: "From a prepaid wallet in MYR. You top up, and the plan fee and any extra minutes come out of the wallet. No card is charged automatically.",
        },
        extra: {
          q: "What happens after my plan's included minutes?",
          a: `Calls carry on while your wallet has credit. Each extra minute costs ${perMinute}, billed per second from your prepaid wallet.`,
        },
      },
    },
    number: {
      heading: "Phone number and forwarding",
      faq: {
        keep: {
          q: "Do I need a new phone number?",
          a: "No. Keep the number your customers know and forward its calls to your JomCall number with your phone's own codes.",
        },
        get: {
          q: "How do I get a JomCall number?",
          a: "Choose Starter or Growth, then request the number in the app. A person on the JomCall team sets it up, and the app shows the number once it is ready.",
        },
        codes: {
          q: "Which forwarding code should I use?",
          a: `${fwdAll.start} sends every call to JomCall. ${fwdNoAnswer.start} sends only the calls you do not answer. ${fwdBusy.start} sends calls only while your line is busy. Each has its own stop code, such as ${fwdAll.stop}.`,
        },
        staff: {
          q: "Can callers still reach my staff?",
          a: "Yes, during opening hours. The agent can pass the caller straight to your staff. Outside opening hours it takes a message instead.",
        },
      },
    },
    languages: {
      heading: "Languages",
      faq: {
        which: {
          q: "Which languages does JomCall speak?",
          a: "BM, English, Manglish and Mandarin. The agent follows the caller and answers in the language they use.",
        },
        tamil: {
          q: "What about Tamil?",
          a: "Tamil is not supported yet. Callers can use BM or English instead.",
        },
        switch: {
          q: "What if a caller switches language during a call?",
          a: "The agent switches too. It answers in the language of what the caller just said.",
        },
      },
    },
    ai: {
      heading: "What the AI does and does not do",
      faq: {
        disclose: {
          q: "Will callers know they are talking to an AI?",
          a: "Yes. The agent says it is an AI when it answers, and an agent cannot be published without that introduction.",
        },
        book: {
          q: "Can the agent book appointments?",
          a: "Yes, for a business that takes bookings. It finds a free time, reads it back to the caller and records the booking in JomCall.",
        },
        change: {
          q: "Can callers move or cancel a booking with the agent?",
          a: "Not yet. The agent takes a message so your staff can move or cancel the booking.",
        },
        unknown: {
          q: "What does the agent do when it does not know an answer?",
          a: "It tells the caller it does not know and takes a message for your team. It is set up to say so rather than guess.",
        },
        google: {
          q: "Will bookings show up in my Google Calendar?",
          a: "No. Bookings are kept in JomCall's own bookings screen. JomCall does not connect to Google Calendar or any other calendar.",
        },
      },
    },
    privacy: {
      heading: "Privacy",
      faq: {
        recording: {
          q: "Does JomCall keep a recording of each call?",
          a: "No. Calls are not recorded.",
        },
        data: {
          q: "Can I export or delete a customer's data?",
          a: "Yes. From a contact's page in the app you can export that contact's data or delete it.",
        },
        where: {
          q: "Where is the data stored, and who receives it?",
          a: "The privacy notice lists where JomCall stores data and which service providers receive it.",
        },
        source: {
          q: "Can I see how JomCall works inside?",
          a: "Yes. JomCall's source code is public under the FSL-1.1-ALv2 licence.",
        },
      },
    },
    whatsapp: {
      heading: "WhatsApp",
      faq: {
        status: {
          q: "What about WhatsApp?",
          a: `${waitTitleEn}. Meta reviews JomCall before businesses can connect their WhatsApp numbers. Phone calls do not wait for this.`,
        },
        plan: {
          q: "Which plan includes the WhatsApp agent?",
          a: `${waitTitleEn}. Once it opens, the WhatsApp agent comes with Growth, and Meta bills its own message fees to the business.`,
        },
      },
    },
  },
};

const ms: FaqCopy = {
  page: {
    title: "Soalan tentang JomCall, dijawab",
    description:
      "Jawapan terus tentang JomCall: harga dan bil, nombor telefon dan pemajuan panggilan, bahasa, apa yang AI buat dan tidak buat, privasi, dan WhatsApp yang sedang menunggu kelulusan Meta.",
    h1: "Soalan lazim, dijawab",
    lead: "Jawapan ringkas tentang harga, nombor telefon, bahasa, apa yang ejen buat dan tidak buat, privasi, dan WhatsApp yang sedang menunggu kelulusan Meta. Setiap jawapan boleh dibaca sendiri.",
  },
  groups: {
    price: {
      heading: "Harga dan bil",
      faq: {
        cost: {
          q: "Berapakah harga JomCall?",
          a: `Starter ${rm(starter.monthlyFeeSen)} sebulan dengan satu nombor telefon dan ${mins(starter.includedVoiceSeconds)} minit. Growth ${rm(growth.monthlyFeeSen)} sebulan dengan satu nombor telefon dan ${mins(growth.includedVoiceSeconds)} minit. Pelan bayar mengikut guna tidak mengenakan yuran bulanan (${rm(payg.monthlyFeeSen)}) dan tiada nombor telefon.`,
        },
        trial: {
          q: "Ada percubaan percuma?",
          a: "Tidak, tiada percubaan percuma. Anda boleh sediakan ejen dan mengujinya dalam pelayar dengan pelan bayar mengikut guna sebelum membayar sebarang yuran pelan.",
        },
        wallet: {
          q: "Bagaimana saya membayar JomCall?",
          a: "Melalui dompet prabayar dalam MYR. Anda tambah nilai, dan yuran pelan serta minit tambahan diambil daripada dompet itu. Tiada kad dicaj secara automatik.",
        },
        extra: {
          q: "Apa yang berlaku selepas minit pelan saya habis?",
          a: `Panggilan diteruskan selagi dompet anda ada baki. Setiap minit tambahan berharga ${perMinute}, dicaj mengikut saat daripada dompet prabayar anda.`,
        },
      },
    },
    number: {
      heading: "Nombor telefon dan pemajuan",
      faq: {
        keep: {
          q: "Perlukah saya nombor telefon baharu?",
          a: "Tidak. Kekalkan nombor yang pelanggan anda kenal dan majukan panggilannya ke nombor JomCall dengan kod telefon anda sendiri.",
        },
        get: {
          q: "Bagaimana saya mendapat nombor JomCall?",
          a: "Pilih Starter atau Growth, kemudian minta nombor itu dalam aplikasi. Seorang staf JomCall akan menyediakannya, dan nombor itu dipaparkan dalam aplikasi sebaik sahaja ia sedia.",
        },
        codes: {
          q: "Kod pemajuan mana yang patut saya guna?",
          a: `${fwdAll.start} menghantar semua panggilan ke JomCall. ${fwdNoAnswer.start} hanya menghantar panggilan yang tidak anda jawab. ${fwdBusy.start} hanya menghantar panggilan semasa talian anda sibuk. Setiap satu ada kod hentinya sendiri, contohnya ${fwdAll.stop}.`,
        },
        staff: {
          q: "Bolehkah pemanggil masih bercakap dengan staf saya?",
          a: "Boleh, dalam waktu operasi. Ejen boleh menyambungkan pemanggil terus kepada staf anda. Di luar waktu operasi, ia mengambil pesanan.",
        },
      },
    },
    languages: {
      heading: "Bahasa",
      faq: {
        which: {
          q: "Bahasa apa yang JomCall boleh cakap?",
          a: "BM, bahasa Inggeris, Manglish dan Mandarin. Ejen mengikut pemanggil dan menjawab dalam bahasa yang mereka guna.",
        },
        tamil: {
          q: "Bagaimana dengan bahasa Tamil?",
          a: "Bahasa Tamil belum disokong. Pemanggil boleh menggunakan BM atau bahasa Inggeris.",
        },
        switch: {
          q: "Bagaimana kalau pemanggil bertukar bahasa semasa panggilan?",
          a: "Ejen pun bertukar. Ia menjawab dalam bahasa ayat terakhir pemanggil.",
        },
      },
    },
    ai: {
      heading: "Apa yang AI buat dan tidak buat",
      faq: {
        disclose: {
          q: "Adakah pemanggil tahu mereka bercakap dengan AI?",
          a: "Ya. Ejen memberitahu bahawa ia AI apabila menjawab, dan ejen tidak boleh diterbitkan tanpa pengenalan itu.",
        },
        book: {
          q: "Bolehkah ejen membuat tempahan temu janji?",
          a: "Boleh, bagi perniagaan yang menerima tempahan. Ia mencari masa yang kosong, mengulang masa itu kepada pemanggil dan merekodkan tempahan dalam JomCall.",
        },
        change: {
          q: "Bolehkah pemanggil menukar atau membatalkan tempahan melalui ejen?",
          a: "Belum lagi. Ejen mengambil pesanan supaya staf anda boleh menukar atau membatalkan tempahan itu.",
        },
        unknown: {
          q: "Apa yang ejen buat apabila ia tidak tahu jawapannya?",
          a: "Ia memberitahu pemanggil bahawa ia tidak tahu dan mengambil pesanan untuk pasukan anda. Ia ditetapkan supaya berkata begitu, bukan meneka jawapan.",
        },
        google: {
          q: "Adakah tempahan akan muncul dalam Google Calendar saya?",
          a: "Tidak. Tempahan disimpan dalam skrin tempahan JomCall sendiri. JomCall tidak bersambung dengan Google Calendar atau mana-mana kalendar lain.",
        },
      },
    },
    privacy: {
      heading: "Privasi",
      faq: {
        recording: {
          q: "Adakah JomCall menyimpan rakaman setiap panggilan?",
          a: "Tidak. Panggilan tidak dirakam.",
        },
        data: {
          q: "Bolehkah saya eksport atau padam data pelanggan?",
          a: "Boleh. Dari halaman kenalan dalam aplikasi, anda boleh mengeksport data kenalan itu atau memadamnya.",
        },
        where: {
          q: "Di mana data disimpan, dan siapa yang menerimanya?",
          a: "Notis privasi menyenaraikan tempat JomCall menyimpan data dan pembekal perkhidmatan yang menerimanya.",
        },
        source: {
          q: "Bolehkah saya lihat cara JomCall berfungsi dari dalam?",
          a: "Boleh. Kod sumber JomCall tersedia kepada umum di bawah lesen FSL-1.1-ALv2.",
        },
      },
    },
    whatsapp: {
      heading: "WhatsApp",
      faq: {
        status: {
          q: "Bagaimana dengan WhatsApp?",
          a: `${waitTitleMs}. Meta menyemak JomCall sebelum perniagaan boleh menyambungkan nombor WhatsApp mereka. Panggilan telefon tidak perlu menunggu kelulusan ini.`,
        },
        plan: {
          q: "Pelan mana yang termasuk ejen WhatsApp?",
          a: `${waitTitleMs}. Apabila ia dibuka, ejen WhatsApp disertakan dalam pelan Growth, dan Meta mengenakan caj mesejnya sendiri kepada perniagaan.`,
        },
      },
    },
  },
};

export const faq: Bilingual<FaqCopy> = { en, ms };

// The groups in page order, each with its questions as a list.
export function faqGroups(locale: "en" | "ms"): { id: FaqGroupId; heading: string; items: FaqItem[] }[] {
  return FAQ_GROUPS.map((id) => ({
    id,
    heading: faq[locale].groups[id].heading,
    items: Object.values(faq[locale].groups[id].faq),
  }));
}

// Every question on the page, in order (for the FAQPage structured data).
export function faqItems(locale: "en" | "ms"): FaqItem[] {
  return faqGroups(locale).flatMap((g) => g.items);
}
