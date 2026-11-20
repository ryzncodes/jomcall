// The languages page, in English and Bahasa Melayu (spec sections 3 and 5).
// Four languages, how the agent follows the caller, a made-up call where the
// caller switches language, and what it does not do yet (no Tamil). Tamil
// is always in its own sentence, with the negation before the verb.
import type { Bilingual, FaqItem, PageCopy, SampleLine, Section } from "./types.ts";

type Language = { name: string; lang: "ms" | "en" | "zh"; line: string; body: string };

export type LanguagesCopy = {
  page: PageCopy;
  list: { heading: string; lead: string; items: Language[] };
  follow: Section;
  sample: { heading: string; lead: string; business: string; lines: SampleLine[]; outcome: string };
  not: { heading: string; items: string[] };
  faq: { heading: string; items: FaqItem[] };
};

// The spoken lines of the made-up call, the same on both pages: the caller
// starts in English and moves to BM, and the agent moves with them.
const spoken = {
  greet: "Good afternoon, Salun Contoh. I'm the salon's AI assistant. How can I help?",
  ask: "Hi, can I book a haircut this Saturday?",
  when: "Sure. What time suits you on Saturday?",
  switch: "Pagi boleh? Dalam pukul sepuluh setengah.",
  readBack: "Boleh. Sabtu ini, pukul 10:30 pagi, potong rambut. Betul ya?",
  yes: "Betul, terima kasih.",
};

const en: LanguagesCopy = {
  page: {
    title: "Languages: BM, English, Manglish and Mandarin",
    description:
      "JomCall's agent speaks BM, English, Manglish and Mandarin on the phone. It follows the caller and answers in the language they use, also when they switch during the call.",
    h1: "It answers in the language your caller uses.",
    lead: "BM, English, Manglish and Mandarin. The agent listens to how the caller speaks and replies the same way, so nobody has to pick a language from a menu.",
  },
  list: {
    heading: "Four languages",
    lead: "Each line below is a made-up example of how a caller might start.",
    items: [
      { name: "Bahasa Melayu", lang: "ms", line: "Esok pagi klinik buka pukul berapa?", body: "Everyday BM or more formal BM, as the caller speaks it." },
      { name: "English", lang: "en", line: "Hi, do you have anything free on Friday evening?", body: "Malaysian English, the way your customers say it." },
      { name: "Manglish", lang: "en", line: "Boss, service aircond got do on Sunday or not?", body: "BM and English in one sentence, as many Malaysians talk. The agent keeps up." },
      { name: "Mandarin", lang: "zh", line: "请问星期六还有位子吗？", body: "Callers who speak Mandarin get their answers in Mandarin." },
    ],
  },
  follow: {
    heading: "How it follows the caller",
    body: [
      "The agent answers in the language of what the caller just said. If a caller starts in English and moves to BM, the agent moves with them.",
      "You write your facts and prices once, in BM or English. The agent uses them in whichever of the four languages the caller speaks.",
    ],
  },
  sample: {
    heading: "A call that switches language",
    lead: "A made-up call to a made-up salon. The caller starts in English and moves to BM halfway.",
    business: "Salun Contoh",
    lines: [
      { who: "agent", text: spoken.greet, lang: "en" },
      { who: "caller", text: spoken.ask, lang: "en" },
      { who: "agent", text: spoken.when, lang: "en" },
      { who: "caller", text: spoken.switch, lang: "ms" },
      { who: "event", text: "Checked bookings: Saturday, 10:30 am is free" },
      { who: "agent", text: spoken.readBack, lang: "ms" },
      { who: "caller", text: spoken.yes, lang: "ms" },
      { who: "event", text: "Booked into JomCall: Saturday, 10:30 am" },
    ],
    outcome: "The time was read back in BM, the language the caller had moved to.",
  },
  not: {
    heading: "What it does not do yet",
    items: [
      "Tamil is not supported yet.",
      "Chinese dialects such as Hokkien and Cantonese are not supported. Callers who speak them can use Mandarin.",
    ],
  },
  faq: {
    heading: "Questions",
    items: [
      {
        q: "Which languages does the agent speak?",
        a: "BM, English, Manglish and Mandarin. It follows the caller and answers in the language they use.",
      },
      {
        q: "What about Tamil?",
        a: "Tamil is not supported yet. Callers can use BM or English instead.",
      },
      {
        q: "Can a caller switch language during the call?",
        a: "Yes. The agent answers in the language of what the caller just said, so it switches when they do.",
      },
      {
        q: "Which language should I write my facts in?",
        a: "BM or English, whichever is easier for you. The agent uses the same facts in any of the four languages.",
      },
    ],
  },
};

const ms: LanguagesCopy = {
  page: {
    title: "Bahasa: BM, bahasa Inggeris, Manglish dan Mandarin",
    description:
      "Ejen JomCall bercakap dalam BM, bahasa Inggeris, Manglish dan Mandarin di telefon. Ia mengikut pemanggil dan menjawab dalam bahasa yang mereka guna, termasuk apabila mereka bertukar bahasa di tengah panggilan.",
    h1: "Ia menjawab dalam bahasa yang pemanggil anda guna.",
    lead: "BM, bahasa Inggeris, Manglish dan Mandarin. Ejen mendengar cara pemanggil bercakap dan membalas dengan cara yang sama, jadi tiada siapa perlu memilih bahasa daripada menu.",
  },
  list: {
    heading: "Empat bahasa",
    lead: "Setiap ayat di bawah ialah contoh rekaan bagaimana pemanggil mungkin memulakan panggilan.",
    items: [
      { name: "Bahasa Melayu", lang: "ms", line: "Esok pagi klinik buka pukul berapa?", body: "BM harian atau BM yang lebih formal, ikut cara pemanggil bercakap." },
      { name: "Bahasa Inggeris", lang: "en", line: "Hi, do you have anything free on Friday evening?", body: "Bahasa Inggeris Malaysia, seperti cara pelanggan anda bercakap." },
      { name: "Manglish", lang: "en", line: "Boss, service aircond got do on Sunday or not?", body: "BM dan bahasa Inggeris dalam satu ayat, seperti ramai rakyat Malaysia bercakap. Ejen boleh ikut." },
      { name: "Mandarin", lang: "zh", line: "请问星期六还有位子吗？", body: "Pemanggil yang bercakap Mandarin mendapat jawapan dalam Mandarin." },
    ],
  },
  follow: {
    heading: "Cara ia mengikut pemanggil",
    body: [
      "Ejen menjawab dalam bahasa ayat terakhir pemanggil. Kalau pemanggil mula dalam bahasa Inggeris dan bertukar ke BM, ejen pun ikut bertukar.",
      "Anda tulis fakta dan harga sekali sahaja, dalam BM atau bahasa Inggeris. Ejen menggunakannya dalam mana-mana satu daripada empat bahasa itu, ikut bahasa pemanggil.",
    ],
  },
  sample: {
    heading: "Panggilan yang bertukar bahasa",
    lead: "Panggilan rekaan ke salun rekaan. Pemanggil mula dalam bahasa Inggeris dan bertukar ke BM di pertengahan.",
    business: "Salun Contoh",
    lines: [
      { who: "agent", text: spoken.greet, lang: "en" },
      { who: "caller", text: spoken.ask, lang: "en" },
      { who: "agent", text: spoken.when, lang: "en" },
      { who: "caller", text: spoken.switch, lang: "ms" },
      { who: "event", text: "Semak tempahan: Sabtu, 10:30 pagi kosong" },
      { who: "agent", text: spoken.readBack, lang: "ms" },
      { who: "caller", text: spoken.yes, lang: "ms" },
      { who: "event", text: "Ditempah dalam JomCall: Sabtu, 10:30 pagi" },
    ],
    outcome: "Masa itu diulang dalam BM, bahasa yang pemanggil sudah tukar.",
  },
  not: {
    heading: "Apa yang ia belum buat",
    items: [
      "Bahasa Tamil belum disokong.",
      "Dialek Cina seperti Hokkien dan Kantonis tidak disokong. Pemanggil yang menuturkannya boleh menggunakan Mandarin.",
    ],
  },
  faq: {
    heading: "Soalan",
    items: [
      {
        q: "Bahasa apa yang ejen boleh cakap?",
        a: "BM, bahasa Inggeris, Manglish dan Mandarin. Ia mengikut pemanggil dan menjawab dalam bahasa yang mereka guna.",
      },
      {
        q: "Bagaimana dengan bahasa Tamil?",
        a: "Bahasa Tamil belum disokong. Pemanggil boleh menggunakan BM atau bahasa Inggeris.",
      },
      {
        q: "Bolehkah pemanggil bertukar bahasa semasa panggilan?",
        a: "Boleh. Ejen menjawab dalam bahasa ayat terakhir pemanggil, jadi ia bertukar apabila mereka bertukar.",
      },
      {
        q: "Dalam bahasa apa saya patut tulis fakta?",
        a: "BM atau bahasa Inggeris, mana yang lebih mudah untuk anda. Ejen menggunakan fakta yang sama dalam mana-mana satu daripada empat bahasa itu.",
      },
    ],
  },
};

export const languages: Bilingual<LanguagesCopy> = { en, ms };
