// The trust page, in English and Bahasa Melayu (spec sections 3 and 5,
// Tier 2). Plain facts only, each from a row of the spec section 3 table or
// from web/lib/operator.ts. The providers who receive data are quoted from
// the privacy notice (web/messages/legal.ts), never restated here. No
// certification or compliance claim of any kind.
import { whatsappWaiting } from "../../lib/launch.ts";
import type { Bilingual, FaqItem, PageCopy } from "./types.ts";

export type TrustFact = { fact: string; detail: string };

export type TrustCopy = {
  page: PageCopy;
  facts: { heading: string; lead: string; factHead: string; detailHead: string; rows: TrustFact[] };
  // Operator facts are filled in from web/lib/operator.ts: {name}, {reg}.
  operator: { fact: string; detail: string };
  source: { fact: string; detail: string; link: string };
  providers: { heading: string; lead: string; from: string; link: string };
  documents: { heading: string; lead: string; privacy: string; terms: string };
  faq: { heading: string; items: FaqItem[] };
};

const en: TrustCopy = {
  page: {
    title: "Trust: how JomCall handles calls and data",
    description:
      "Plain facts about JomCall: calls are not recorded, the AI says it is an AI, which providers receive data and where it is stored, export and delete, the public source code and who runs the service.",
    h1: "What JomCall does with your calls and data",
    lead: "Plain facts, each one you can check. For the full text, read the privacy notice and the terms of use.",
  },
  facts: {
    heading: "The facts",
    lead: "What is true of every JomCall line today.",
    factHead: "Fact",
    detailHead: "What it means",
    rows: [
      {
        fact: "Calls are not recorded.",
        detail: "The agent turns the caller's speech into text so it can reply. The providers that do this are listed below, quoted from the privacy notice.",
      },
      {
        fact: "The AI says it is an AI.",
        detail: "The agent introduces itself as an AI at the start of the call. An agent cannot be published without that introduction.",
      },
      {
        fact: "Callers can be passed to your staff during opening hours.",
        detail: "When a caller asks for staff, the agent passes the call to your staff during opening hours. Outside them it takes a message.",
      },
      {
        fact: "Contacts can be exported and deleted.",
        detail: "A business can export a contact's data and delete it from its JomCall account.",
      },
      {
        fact: "No card is charged automatically.",
        detail: "You pay from a prepaid wallet in ringgit (MYR) and top it up yourself.",
      },
      {
        fact: `${whatsappWaiting.title[0]}.`,
        detail: "JomCall takes phone calls today. A business cannot connect its WhatsApp number until Meta approves JomCall.",
      },
    ],
  },
  operator: {
    fact: "Who runs JomCall",
    detail: "{name}, registration number {reg}.",
  },
  source: {
    fact: "The source code is public.",
    detail: "The code that runs JomCall is published under FSL-1.1-ALv2, so anyone can read how it works.",
    link: "Read the source code",
  },
  providers: {
    heading: "Who receives data, and where",
    lead: "Quoted word for word from the privacy notice.",
    from: "From the privacy notice",
    link: "Read the whole section",
  },
  documents: {
    heading: "The full text",
    lead: "The privacy notice and the terms of use are the documents that bind JomCall. This page only points to them.",
    privacy: "What JomCall collects, why, who receives it and how to ask for your data.",
    terms: "What a business agrees to when it uses JomCall, including keeping the AI notice on.",
  },
  faq: {
    heading: "Questions",
    items: [
      {
        q: "Can a caller ask to speak to a person?",
        a: "Yes. During opening hours the agent passes the caller to the business's staff. Outside opening hours it takes a message for them.",
      },
      {
        q: "Can a business delete a caller's data?",
        a: "Yes. From its JomCall account a business can export a contact's data and delete it.",
      },
      {
        q: "Where can I read the code?",
        a: "The source code is public under FSL-1.1-ALv2. The link is on this page and in the footer of every page.",
      },
    ],
  },
};

const ms: TrustCopy = {
  page: {
    title: "Kepercayaan: cara JomCall mengurus panggilan dan data",
    description:
      "Fakta jelas tentang JomCall: panggilan tidak dirakam, AI memberitahu bahawa ia AI, pembekal yang menerima data dan tempat ia disimpan, eksport dan padam, kod sumber terbuka dan siapa yang mengendalikan perkhidmatan ini.",
    h1: "Apa yang JomCall buat dengan panggilan dan data anda",
    lead: "Fakta yang jelas, dan setiap satu boleh anda semak. Untuk teks penuh, baca notis privasi dan terma penggunaan.",
  },
  facts: {
    heading: "Faktanya",
    lead: "Apa yang benar bagi setiap talian JomCall sekarang.",
    factHead: "Fakta",
    detailHead: "Maksudnya",
    rows: [
      {
        fact: "Panggilan tidak dirakam.",
        detail: "Ejen menukar percakapan pemanggil kepada teks supaya ia boleh membalas. Pembekal yang melakukannya disenaraikan di bawah, dipetik daripada notis privasi.",
      },
      {
        fact: "AI memberitahu bahawa ia AI.",
        detail: "Ejen memperkenalkan dirinya sebagai AI pada awal panggilan. Ejen tidak boleh diterbitkan tanpa pengenalan itu.",
      },
      {
        fact: "Pemanggil boleh disambungkan kepada staf anda dalam waktu operasi.",
        detail: "Apabila pemanggil meminta staf, ejen menyambungkan panggilan kepada staf anda dalam waktu operasi. Di luar waktu itu, ia mengambil pesanan.",
      },
      {
        fact: "Data kenalan boleh dieksport dan dipadam.",
        detail: "Perniagaan boleh mengeksport data kenalan dan memadamnya daripada akaun JomCall mereka.",
      },
      {
        fact: "Tiada kad dicaj secara automatik.",
        detail: "Anda membayar daripada dompet prabayar dalam ringgit (MYR) dan menambah nilainya sendiri.",
      },
      {
        fact: `${whatsappWaiting.title[1]}.`,
        detail: "JomCall menerima panggilan telefon sekarang. Perniagaan tidak boleh menyambungkan nombor WhatsApp mereka selagi Meta belum meluluskan JomCall.",
      },
    ],
  },
  operator: {
    fact: "Siapa yang mengendalikan JomCall",
    detail: "{name}, nombor pendaftaran {reg}.",
  },
  source: {
    fact: "Kod sumber terbuka kepada umum.",
    detail: "Kod yang menjalankan JomCall diterbitkan di bawah FSL-1.1-ALv2, jadi sesiapa pun boleh membaca cara ia berfungsi.",
    link: "Baca kod sumber",
  },
  providers: {
    heading: "Siapa yang menerima data, dan di mana",
    lead: "Dipetik kata demi kata daripada notis privasi.",
    from: "Daripada notis privasi",
    link: "Baca bahagian penuh",
  },
  documents: {
    heading: "Teks penuh",
    lead: "Notis privasi dan terma penggunaan ialah dokumen yang mengikat JomCall. Halaman ini hanya menunjukkan jalan kepadanya.",
    privacy: "Apa yang JomCall kumpul, sebabnya, siapa yang menerimanya dan cara meminta data anda.",
    terms: "Apa yang dipersetujui oleh perniagaan apabila menggunakan JomCall, termasuk mengekalkan notis AI.",
  },
  faq: {
    heading: "Soalan",
    items: [
      {
        q: "Bolehkah pemanggil meminta untuk bercakap dengan orang?",
        a: "Boleh. Dalam waktu operasi, ejen menyambungkan pemanggil kepada staf perniagaan itu. Di luar waktu operasi, ia mengambil pesanan untuk mereka.",
      },
      {
        q: "Bolehkah perniagaan memadam data pemanggil?",
        a: "Boleh. Daripada akaun JomCall, perniagaan boleh mengeksport data kenalan dan memadamnya.",
      },
      {
        q: "Di mana saya boleh membaca kodnya?",
        a: "Kod sumber terbuka di bawah FSL-1.1-ALv2. Pautannya ada di halaman ini dan di kaki setiap halaman.",
      },
    ],
  },
};

export const trust: Bilingual<TrustCopy> = { en, ms };
