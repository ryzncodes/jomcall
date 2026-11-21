// How it works, in English and Bahasa Melayu (spec sections 3, 5 and 7). The
// six steps use the in-app checklist's names, the same as the home page
// (tests/hosting/public-content.test.ts). No wait time is stated for the
// phone number; amounts come from web/lib/pricing.ts.
import { publicPlans } from "../../lib/pricing.ts";
import { rm } from "./format.ts";
import type { Bilingual, FaqItem, PageCopy } from "./types.ts";

const [starter, growth] = publicPlans;

type Step = { name: string; you: string; body: string };
type Point = { name: string; body: string };

export type HowItWorksCopy = {
  page: PageCopy;
  steps: { heading: string; lead: string; you: string; items: Step[] };
  call: { heading: string; lead: string; items: Point[]; note: string };
  number: { heading: string; body: string[]; link: string };
  faq: { heading: string; items: FaqItem[] };
};

const en: HowItWorksCopy = {
  page: {
    title: "How JomCall works, from sign-up to your first call",
    description:
      "Six steps from sign-up to your first real call: set up your business, test the agent in your browser, publish it, choose a plan, get a phone number and forward your calls.",
    h1: "How JomCall works",
    lead: "You set up your business in the app, test the agent in your browser, then forward your calls to your JomCall number. Here is each step, and what the agent does when a customer calls.",
  },
  steps: {
    heading: "Six steps to your first real call",
    lead: "These are the same six steps you see in the app after you sign up, in the same order.",
    you: "What you do",
    items: [
      {
        name: "Set up your business",
        you: "Pick your business type, then answer up to 8 questions or bring your price list as a photo, PDF, CSV file or pasted text.",
        body: "JomCall turns what you give it into the facts and prices the agent uses. You check every row before it goes in. Excel files are not taken, so save the sheet as CSV first.",
      },
      {
        name: "Test the agent",
        you: "Talk to it in your browser, by voice or by typing.",
        body: "Ask what your customers ask. If an answer is wrong, fix the fact and test again. No customer hears these tests.",
      },
      {
        name: "Publish the agent",
        you: "Publish when the answers look right.",
        body: "An agent cannot be published without its AI introduction, so every caller hears that they are talking to an AI.",
      },
      {
        name: "Choose a plan",
        you: "Pick Starter or Growth and top up your prepaid wallet in RM.",
        body: `Starter is ${rm(starter.monthlyFeeSen)} a month and Growth is ${rm(growth.monthlyFeeSen)}. The fee comes out of your wallet. No card is charged automatically.`,
      },
      {
        name: "Get a phone number",
        you: "Request your JomCall number in the app.",
        body: "A person on the JomCall team sets it up, and the app shows the number once it is ready.",
      },
      {
        name: "Take your first real call",
        you: "Forward your business number to your JomCall number, then call it from another phone to check.",
        body: "Customers keep calling the number they know. Each call shows in your call log with what the agent did.",
      },
    ],
  },
  call: {
    heading: "When a customer calls",
    lead: "Every call starts the same way. What happens next depends on what the caller needs.",
    items: [
      { name: "It says it is an AI", body: "The agent greets the caller and says it is an AI, before anything else." },
      { name: "It speaks their language", body: "BM, English, Manglish or Mandarin. It follows the caller and answers the way they speak." },
      { name: "It answers from your facts", body: "Opening hours, prices, location and the rest come from what you gave it in setup. If it does not know, it says so and takes a message." },
      { name: "It books appointments", body: "For a business that takes bookings, it finds a free time, reads it back to the caller and records the booking in JomCall." },
      { name: "It takes messages", body: "It notes who called, how to reach them and what they need, for your team to follow up." },
      { name: "It passes the call to your staff", body: "During opening hours it can pass the caller straight to your staff. It does not stay on the line to introduce them. Outside opening hours it takes a message instead." },
    ],
    note: "Calls are not recorded.",
  },
  number: {
    heading: "You keep your number",
    body: [
      "Your customers never need a new number. You forward your existing line's calls to your JomCall number with your phone's own codes: every call, only the calls you do not answer, or only when your line is busy.",
      "On an office line, your line provider switches the forwarding on for you.",
    ],
    link: "Read the call forwarding guide",
  },
  faq: {
    heading: "Questions",
    items: [
      {
        q: "Can I test the agent before customers call?",
        a: "Yes. Test it in your browser, by voice or by typing, before any customer calls. No customer hears these tests.",
      },
      {
        q: "What does the agent do when it does not know an answer?",
        a: "It tells the caller it does not know and takes a message for your team. It is set up to say so rather than guess.",
      },
      {
        q: "Can I change the agent's answers after I publish?",
        a: "Yes. Change a fact or a price in the app, test it in your browser, then publish the new version.",
      },
      {
        q: "Who sets up my JomCall number?",
        a: "You request it in the app and a person on the JomCall team sets it up. The app shows the number once it is ready.",
      },
    ],
  },
};

const ms: HowItWorksCopy = {
  page: {
    title: "Cara JomCall berfungsi, dari daftar hingga panggilan pertama",
    description:
      "Enam langkah dari daftar hingga panggilan sebenar pertama: sediakan perniagaan anda, uji ejen dalam pelayar, terbitkan, pilih pelan, dapatkan nombor telefon dan majukan panggilan anda.",
    h1: "Cara JomCall berfungsi",
    lead: "Anda sediakan perniagaan dalam aplikasi, uji ejen dalam pelayar, kemudian majukan panggilan ke nombor JomCall anda. Ini setiap langkahnya, dan apa yang ejen buat apabila pelanggan menelefon.",
  },
  steps: {
    heading: "Enam langkah ke panggilan sebenar pertama",
    lead: "Enam langkah ini sama seperti yang anda lihat dalam aplikasi selepas mendaftar, dalam susunan yang sama.",
    you: "Apa yang anda buat",
    items: [
      {
        name: "Sediakan perniagaan anda",
        you: "Pilih jenis perniagaan, kemudian jawab sehingga 8 soalan atau bawa senarai harga sebagai foto, PDF, fail CSV atau teks yang ditampal.",
        body: "JomCall menukar apa yang anda beri kepada fakta dan harga yang digunakan ejen. Anda semak setiap baris sebelum ia dimasukkan. Fail Excel tidak diterima, jadi simpan helaian itu sebagai CSV dahulu.",
      },
      {
        name: "Uji ejen",
        you: "Bercakap dengannya dalam pelayar, sama ada dengan suara atau menaip.",
        body: "Tanya apa yang pelanggan anda selalu tanya. Kalau jawapannya salah, betulkan fakta itu dan uji semula. Tiada pelanggan yang mendengar ujian ini.",
      },
      {
        name: "Terbitkan ejen",
        you: "Terbitkan apabila jawapannya sudah betul.",
        body: "Ejen tidak boleh diterbitkan tanpa pengenalan AI, jadi setiap pemanggil tahu mereka sedang bercakap dengan AI.",
      },
      {
        name: "Pilih pelan",
        you: "Pilih Starter atau Growth dan tambah nilai dompet prabayar anda dalam RM.",
        body: `Starter ${rm(starter.monthlyFeeSen)} sebulan dan Growth ${rm(growth.monthlyFeeSen)}. Yurannya diambil daripada dompet anda. Tiada kad dicaj secara automatik.`,
      },
      {
        name: "Dapatkan nombor telefon",
        you: "Minta nombor JomCall anda dalam aplikasi.",
        body: "Seorang staf JomCall akan menyediakannya, dan nombor itu dipaparkan dalam aplikasi sebaik sahaja ia sedia.",
      },
      {
        name: "Terima panggilan sebenar pertama",
        you: "Majukan nombor perniagaan anda ke nombor JomCall, kemudian telefon nombor itu dari telefon lain untuk menyemak.",
        body: "Pelanggan terus menelefon nombor yang mereka kenal. Setiap panggilan dipaparkan dalam log panggilan bersama apa yang ejen buat.",
      },
    ],
  },
  call: {
    heading: "Apabila pelanggan menelefon",
    lead: "Setiap panggilan bermula dengan cara yang sama. Selepas itu, bergantung pada apa yang pemanggil perlukan.",
    items: [
      { name: "Ia memberitahu bahawa ia AI", body: "Ejen menyapa pemanggil dan memberitahu bahawa ia AI, sebelum apa-apa yang lain." },
      { name: "Ia bercakap dalam bahasa mereka", body: "BM, bahasa Inggeris, Manglish atau Mandarin. Ia mengikut pemanggil dan menjawab mengikut cara mereka bercakap." },
      { name: "Ia menjawab berdasarkan fakta anda", body: "Waktu operasi, harga, lokasi dan lain-lain datang daripada apa yang anda beri semasa persediaan. Kalau ia tidak tahu, ia memberitahu pemanggil dan mengambil pesanan." },
      { name: "Ia membuat tempahan temu janji", body: "Bagi perniagaan yang menerima tempahan, ia mencari masa yang kosong, mengulang masa itu kepada pemanggil dan merekodkan tempahan dalam JomCall." },
      { name: "Ia mengambil pesanan", body: "Ia mencatat siapa yang menelefon, cara menghubungi mereka dan apa yang mereka perlukan, untuk pasukan anda membuat susulan." },
      { name: "Ia menyambungkan panggilan kepada staf", body: "Dalam waktu operasi, ia boleh menyambungkan pemanggil terus kepada staf anda. Ia tidak menunggu dalam talian untuk memperkenalkan pemanggil. Di luar waktu operasi, ia mengambil pesanan." },
    ],
    note: "Panggilan tidak dirakam.",
  },
  number: {
    heading: "Anda kekalkan nombor anda",
    body: [
      "Pelanggan anda tidak perlu nombor baharu. Anda majukan panggilan talian sedia ada ke nombor JomCall dengan kod telefon anda sendiri: semua panggilan, hanya panggilan yang tidak dijawab, atau hanya apabila talian anda sibuk.",
      "Bagi talian pejabat, pembekal talian anda yang akan menghidupkan pemajuan itu.",
    ],
    link: "Baca panduan pemajuan panggilan",
  },
  faq: {
    heading: "Soalan",
    items: [
      {
        q: "Bolehkah saya uji ejen sebelum pelanggan menelefon?",
        a: "Boleh. Uji dalam pelayar, dengan suara atau menaip, sebelum ada pelanggan yang menelefon. Tiada pelanggan yang mendengar ujian ini.",
      },
      {
        q: "Apa yang ejen buat apabila ia tidak tahu jawapannya?",
        a: "Ia memberitahu pemanggil bahawa ia tidak tahu dan mengambil pesanan untuk pasukan anda. Ia ditetapkan supaya berkata begitu, bukan meneka jawapan.",
      },
      {
        q: "Bolehkah saya ubah jawapan ejen selepas diterbitkan?",
        a: "Boleh. Ubah fakta atau harga dalam aplikasi, uji dalam pelayar, kemudian terbitkan versi baharu.",
      },
      {
        q: "Siapa yang menyediakan nombor JomCall saya?",
        a: "Anda minta dalam aplikasi dan seorang staf JomCall akan menyediakannya. Nombor itu dipaparkan dalam aplikasi sebaik sahaja ia sedia.",
      },
    ],
  },
};

export const howItWorks: Bilingual<HowItWorksCopy> = { en, ms };
