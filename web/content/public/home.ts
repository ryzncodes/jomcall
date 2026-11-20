// The home page, in English and Bahasa Melayu (spec section 7). Every claim
// traces to spec section 3; amounts come from web/lib/pricing.ts, never typed
// by hand. The sample call shows only what the recordings in
// web/public/demo-call/ say (tests/hosting/public-site.test.ts checks it).
import { publicPlans, publicPrices } from "../../lib/pricing.ts";
import { whatsappWaiting } from "../../lib/launch.ts";
import { rm } from "./format.ts";
import type { Bilingual, FaqItem } from "./types.ts";

const [starter, growth, payg] = publicPlans;
const minutes = (seconds: number) => seconds / 60;
const fee = rm(starter.monthlyFeeSen);
const perMinute = rm(publicPrices.voiceSenPerMinute);

// ------------------------------------------------------------ sample call

// The four recorded languages, in the order the card cycles through them.
export const CALL_LANGS = ["ms", "manglish", "zh", "en"] as const;
export type CallLang = (typeof CALL_LANGS)[number];

// Lines with a recording. Line 0 (the greeting) also says the call may be
// recorded, which is not true of JomCall, so it is never played or quoted;
// line 3 is the booking check, shown and not spoken.
export const VOICED_LINES = [1, 2, 4, 5] as const;
export type VoicedLine = (typeof VOICED_LINES)[number];

export type SampleVoice = {
  id: CallLang;
  chip: string;
  lang: "ms" | "en" | "zh";
  lines: Record<VoicedLine, string>;
};

export const sampleCall: SampleVoice[] = [
  {
    id: "ms",
    chip: "BM",
    lang: "ms",
    lines: {
      1: "Boleh book esok, pukul tiga?",
      2: "Boleh. Saya semak esok pukul 3 petang untuk anda.",
      4: "Boleh, masa tu sesuai. Terima kasih.",
      5: "Dah siap. Janji temu anda ditetapkan esok, pukul 3 petang. Jumpa nanti!",
    },
  },
  {
    id: "manglish",
    chip: "Manglish",
    lang: "en",
    lines: {
      1: "Boleh book esok, pukul tiga?",
      2: "Boleh. Let me check tomorrow at 3 pm for you.",
      4: "Yes, please. That works for me.",
      5: "Dah siap. Your appointment is set for tomorrow, 3 pm. See you then!",
    },
  },
  {
    id: "zh",
    chip: "中文",
    lang: "zh",
    lines: {
      1: "可以预约明天下午三点吗？",
      2: "好的，我帮您看看明天下午三点。",
      4: "可以，谢谢。",
      5: "预约已确认，明天下午三点见！",
    },
  },
  {
    id: "en",
    chip: "English",
    lang: "en",
    lines: {
      1: "Can I book tomorrow at three?",
      2: "Let me check tomorrow at 3 pm.",
      4: "Yes, please. That works for me.",
      5: "Your appointment is set for tomorrow at 3 pm. See you then!",
    },
  },
];

// ------------------------------------------------------------------ copy

type Plan = { name: string; price: string; per: string; body: string; features: string[] };
type CallRow = {
  name: string;
  lang: string;
  time: string;
  length: string;
  outcome: string;
  kind: "booked" | "message" | "answered" | "staff";
};

const en = {
  meta: {
    title: "AI receptionist for Malaysian businesses",
    description: `JomCall answers your business calls day and night in BM, English, Manglish and Mandarin, books appointments and takes messages. From ${fee} a month, prepaid in RM.`,
  },
  hero: {
    h1: "Your phone, answered in your customer's language.",
    lead: "JomCall is an AI receptionist for Malaysian businesses. It answers your calls day and night, books appointments and takes messages for your team.",
    from: `From ${fee} a month`,
    ticks: [
      "Speaks BM, English, Manglish and Mandarin",
      "Books appointments and takes messages",
      "Keep your number: forward its calls to JomCall",
    ],
    hear: "Hear a sample call",
    stop: "Stop the sample",
    reassurance: "Prepaid wallet in RM, no card charged automatically. Calls are not recorded.",
  },
  card: {
    label: "Sample call, made up",
    business: "Studio Contoh",
    languages: "Call language",
    caller: "Caller",
    agent: "JomCall",
    greeting: "Greets the caller and says it is an AI",
    check: "Checked bookings: 3 pm is free",
    booked: "Booked into JomCall: tomorrow, 3:00 pm",
    playing: "Playing",
    stopped: "Sample stopped",
    stop: "Stop",
  },
  bento: {
    heading: "What you see in JomCall",
    lead: "Small views of the app, filled with made-up data.",
    calls: {
      title: "Today's calls",
      note: "Made-up sample",
      summary: (calls: number, booked: number, messages: number) =>
        `${calls} calls today · ${booked} booked · ${messages} messages taken`,
      rows: [
        { name: "Pelanggan Contoh A", lang: "BM", time: "09:14", length: "1:52", outcome: "Booked", kind: "booked" },
        { name: "Pelanggan Contoh B", lang: "EN", time: "11:02", length: "0:47", outcome: "Message taken", kind: "message" },
        { name: "Pelanggan Contoh C", lang: "中文", time: "13:30", length: "1:05", outcome: "Answered", kind: "answered" },
        { name: "Pelanggan Contoh D", lang: "Manglish", time: "16:48", length: "0:38", outcome: "Passed to staff", kind: "staff" },
        { name: "Pelanggan Contoh E", lang: "BM", time: "18:20", length: "0:56", outcome: "Message taken", kind: "message" },
        { name: "Pelanggan Contoh F", lang: "EN", time: "21:05", length: "1:10", outcome: "Answered", kind: "answered" },
      ] as CallRow[],
    },
    booking: {
      title: "A booking, read back",
      day: "Tomorrow",
      time: "3:00 pm",
      service: "Consultation · Studio Contoh",
      quote: "Your appointment is set for tomorrow, 3 pm.",
      note: "The time is read back to the caller before the booking is saved.",
    },
    price: {
      amount: fee,
      body: `a month, with one phone number and ${minutes(starter.includedVoiceSeconds)} minutes`,
      note: "Paid from a prepaid wallet in RM",
      usageLabel: "This month, made up",
      usage: `38 of ${minutes(starter.includedVoiceSeconds)} minutes used`,
    },
    forward: {
      title: "Keep your number",
      body: "Forward your line's calls to your JomCall number with your phone's own codes.",
      rows: [
        { code: "**21*", meaning: "Every call" },
        { code: "**61*", meaning: "Only when you do not answer" },
        { code: "**67*", meaning: "Only when your line is busy" },
      ],
    },
    transfer: {
      title: "Passes callers to your staff",
      open: "Open",
      openTime: "9:00 am – 6:00 pm",
      openResult: "Passed to your front desk",
      closed: "Closed",
      closedTime: "After 6:00 pm",
      closedResult: "Message taken for the team",
      note: "During opening hours it passes the caller to your staff. After hours it takes a message.",
    },
    languages: {
      title: "Follows the caller",
      body: "It answers in the language the caller uses.",
    },
    honest: {
      title: "Honest by default",
      rows: [
        "Says it is an AI when it answers",
        "Calls are not recorded",
        "Export or delete a contact's data",
      ],
    },
  },
  problem: {
    heading: "A phone you can't answer is a customer you can't help.",
    body: "Nobody misses a call on purpose. Calls come when a small business is busiest.",
    points: [
      { title: "You're with a customer", body: "Your hands are busy at the chair, the counter or under a car, and the phone keeps ringing." },
      { title: "It's after hours", body: "People call when they are free, which is often when you have closed for the day." },
      { title: "You're on another call", body: "One caller has your attention while the next one hears the phone ring out." },
    ],
    close: "JomCall picks up when you can't, books the slot or takes a message, and the call log shows you what happened.",
  },
  how: {
    heading: "From sign-up to your first real call",
    lead: "The same six steps you will see in the app after you sign up.",
    more: "More on how it works",
    steps: [
      { name: "Set up your business", body: "Pick your business type and answer up to 8 questions, or bring your price list as a photo, PDF, CSV file or pasted text." },
      { name: "Test the agent", body: "Talk to it in your browser and check its answers before any customer calls." },
      { name: "Publish the agent", body: "Publish when you are happy with it. It always tells callers it is an AI." },
      { name: "Choose a plan", body: "Pick Starter or Growth. The fee comes from your prepaid wallet in RM." },
      { name: "Get a phone number", body: "Request your JomCall number in the app, and a person sets it up for you." },
      { name: "Take your first real call", body: "Forward your business number to your JomCall number, so customers keep calling the number they know." },
    ],
  },
  languages: {
    heading: "It speaks the way your callers speak.",
    body: "BM, English, Manglish and Mandarin. The agent follows the caller and answers in their language.",
    samples: {
      ms: "Bahasa Melayu",
      manglish: "BM and English, mixed",
      zh: "Mandarin",
      en: "English",
    },
    note: "Tamil is not supported yet.",
  },
  industries: {
    heading: "Made for the calls your business gets",
    items: {
      "industries-clinics": "Appointments, opening hours and directions",
      "industries-salons": "Bookings for cuts, colour and treatments",
      "industries-car-workshops": "Messages for the mechanic",
      "industries-aircond-home-repair": "Service requests and messages",
      "industries-restaurants": "Opening hours, location and messages",
      "industries-tuition-centres": "Class questions and messages from parents",
    },
    all: "All industries",
  },
  pricing: {
    heading: "Simple prices in RM",
    lead: "Monthly plans on a prepaid wallet, or no monthly fee while you test.",
    plans: {
      starter: {
        name: "Starter",
        price: rm(starter.monthlyFeeSen),
        per: "a month",
        body: "One phone number for your business.",
        features: [
          `${starter.phoneNumbers} phone number`,
          `${minutes(starter.includedVoiceSeconds)} minutes each month`,
          `Then ${perMinute} a minute, billed per second`,
        ],
      },
      growth: {
        name: "Growth",
        price: rm(growth.monthlyFeeSen),
        per: "a month",
        body: "More minutes for a busier line.",
        features: [
          `${growth.phoneNumbers} phone number`,
          `${minutes(growth.includedVoiceSeconds)} minutes each month`,
          `Then ${perMinute} a minute, billed per second`,
          `WhatsApp agent: ${whatsappWaiting.short[0]}`,
        ],
      },
      payg: {
        name: "Pay as you go",
        price: rm(payg.monthlyFeeSen),
        per: "a month",
        body: "No monthly fee and no phone number. Test your agent in the browser before you choose a plan.",
        features: ["No phone number", "Top up your wallet when you need to"],
      },
    } satisfies Record<(typeof publicPlans)[number]["code"], Plan>,
    link: "See full pricing",
  },
  faq: {
    heading: "Questions owners ask",
    more: "All questions",
    items: [
      {
        q: "Do I need a new phone number?",
        a: "No. Keep the number your customers know and forward its calls to your JomCall number. You request the JomCall number in the app, and a person sets it up.",
      },
      {
        q: "Will callers know they are talking to an AI?",
        a: "Yes. The agent says it is an AI when it answers, and an agent cannot be published without that introduction.",
      },
      {
        q: "Which languages does it speak?",
        a: "BM, English, Manglish and Mandarin. It follows the caller and answers in their language. Tamil is not supported yet.",
      },
      {
        q: "How much does it cost?",
        a: `Plans start at ${fee} a month with one phone number and ${minutes(starter.includedVoiceSeconds)} minutes. You pay from a prepaid wallet in RM, and no card is charged automatically.`,
      },
      {
        q: "Is there a recording of each call?",
        a: "No. JomCall does not record calls.",
      },
      {
        q: "What about WhatsApp?",
        a: `${whatsappWaiting.title[0]}. Phone calls do not wait for this, and we will tell you when Meta approves.`,
      },
    ] satisfies FaqItem[],
  },
  closing: {
    heading: "Give your phone a receptionist.",
    body: "Set up your business, test the agent in your browser, then forward your calls.",
  },
};

const ms: typeof en = {
  meta: {
    title: "Penyambut tetamu AI untuk perniagaan Malaysia",
    description: `JomCall menjawab panggilan perniagaan anda siang dan malam dalam BM, bahasa Inggeris, Manglish dan Mandarin, membuat tempahan janji temu dan mengambil pesanan. Bermula ${fee} sebulan, prabayar dalam RM.`,
  },
  hero: {
    h1: "Telefon anda dijawab dalam bahasa pelanggan anda.",
    lead: "JomCall ialah penyambut tetamu AI untuk perniagaan Malaysia. Ia menjawab panggilan anda siang dan malam, membuat tempahan janji temu dan mengambil pesanan untuk pasukan anda.",
    from: `Bermula ${fee} sebulan`,
    ticks: [
      "Bercakap dalam BM, bahasa Inggeris, Manglish dan Mandarin",
      "Membuat tempahan janji temu dan mengambil pesanan",
      "Kekalkan nombor anda: majukan panggilannya ke JomCall",
    ],
    hear: "Dengar contoh panggilan",
    stop: "Hentikan contoh",
    reassurance: "Dompet prabayar dalam RM, tiada kad dicaj secara automatik. Panggilan tidak dirakam.",
  },
  card: {
    label: "Contoh panggilan, rekaan",
    business: "Studio Contoh",
    languages: "Bahasa panggilan",
    caller: "Pemanggil",
    agent: "JomCall",
    greeting: "Menyapa pemanggil dan memberitahu ia AI",
    check: "Tempahan disemak: pukul 3 petang masih kosong",
    booked: "Ditempah dalam JomCall: esok, 3:00 petang",
    playing: "Sedang dimainkan",
    stopped: "Contoh dihentikan",
    stop: "Henti",
  },
  bento: {
    heading: "Apa yang anda lihat dalam JomCall",
    lead: "Paparan kecil aplikasi, dengan data rekaan.",
    calls: {
      title: "Panggilan hari ini",
      note: "Contoh rekaan",
      summary: (calls: number, booked: number, messages: number) =>
        `${calls} panggilan hari ini · ${booked} tempahan · ${messages} pesanan diambil`,
      rows: [
        { name: "Pelanggan Contoh A", lang: "BM", time: "09:14", length: "1:52", outcome: "Ditempah", kind: "booked" },
        { name: "Pelanggan Contoh B", lang: "EN", time: "11:02", length: "0:47", outcome: "Pesanan diambil", kind: "message" },
        { name: "Pelanggan Contoh C", lang: "中文", time: "13:30", length: "1:05", outcome: "Dijawab", kind: "answered" },
        { name: "Pelanggan Contoh D", lang: "Manglish", time: "16:48", length: "0:38", outcome: "Diserahkan kepada staf", kind: "staff" },
        { name: "Pelanggan Contoh E", lang: "BM", time: "18:20", length: "0:56", outcome: "Pesanan diambil", kind: "message" },
        { name: "Pelanggan Contoh F", lang: "EN", time: "21:05", length: "1:10", outcome: "Dijawab", kind: "answered" },
      ],
    },
    booking: {
      title: "Tempahan, dibaca semula",
      day: "Esok",
      time: "3:00 petang",
      service: "Konsultasi · Studio Contoh",
      quote: "Janji temu anda ditetapkan esok, pukul 3 petang.",
      note: "Masa dibaca semula kepada pemanggil sebelum tempahan disimpan.",
    },
    price: {
      amount: fee,
      body: `sebulan, dengan satu nombor telefon dan ${minutes(starter.includedVoiceSeconds)} minit`,
      note: "Dibayar daripada dompet prabayar dalam RM",
      usageLabel: "Bulan ini, rekaan",
      usage: `38 daripada ${minutes(starter.includedVoiceSeconds)} minit digunakan`,
    },
    forward: {
      title: "Kekalkan nombor anda",
      body: "Majukan panggilan talian anda ke nombor JomCall dengan kod telefon anda sendiri.",
      rows: [
        { code: "**21*", meaning: "Semua panggilan" },
        { code: "**61*", meaning: "Hanya apabila anda tidak menjawab" },
        { code: "**67*", meaning: "Hanya apabila talian anda sibuk" },
      ],
    },
    transfer: {
      title: "Menyerahkan pemanggil kepada staf",
      open: "Buka",
      openTime: "9:00 pagi – 6:00 petang",
      openResult: "Diserahkan ke kaunter anda",
      closed: "Tutup",
      closedTime: "Selepas 6:00 petang",
      closedResult: "Pesanan diambil untuk pasukan",
      note: "Semasa waktu operasi, ia menyerahkan pemanggil kepada staf anda. Selepas waktu operasi, ia mengambil pesanan.",
    },
    languages: {
      title: "Ikut bahasa pemanggil",
      body: "Ia menjawab dalam bahasa yang digunakan pemanggil.",
    },
    honest: {
      title: "Jujur sejak awal",
      rows: [
        "Memberitahu ia AI semasa menjawab",
        "Panggilan tidak dirakam",
        "Eksport atau padam data kenalan",
      ],
    },
  },
  problem: {
    heading: "Telefon yang tidak berjawab ialah pelanggan yang tidak terlayan.",
    body: "Tiada siapa sengaja terlepas panggilan. Panggilan datang ketika perniagaan kecil paling sibuk.",
    points: [
      { title: "Anda sedang melayan pelanggan", body: "Tangan anda sibuk di kerusi, di kaunter atau di bawah kereta, dan telefon terus berdering." },
      { title: "Kedai sudah tutup", body: "Orang menelefon ketika mereka lapang, selalunya selepas anda tutup kedai." },
      { title: "Anda dalam panggilan lain", body: "Seorang pemanggil sedang bercakap dengan anda, dan pemanggil seterusnya hanya mendengar deringan." },
    ],
    close: "JomCall mengangkat telefon apabila anda tidak dapat, menempah slot atau mengambil pesanan, dan log panggilan menunjukkan apa yang berlaku.",
  },
  how: {
    heading: "Dari daftar hingga panggilan sebenar pertama",
    lead: "Enam langkah yang sama seperti dalam aplikasi selepas anda mendaftar.",
    more: "Lagi tentang cara ia berfungsi",
    steps: [
      { name: "Sediakan perniagaan anda", body: "Pilih jenis perniagaan dan jawab sehingga 8 soalan, atau bawa senarai harga sebagai foto, PDF, fail CSV atau teks yang ditampal." },
      { name: "Uji ejen", body: "Bercakap dengannya dalam pelayar dan semak jawapannya sebelum pelanggan menelefon." },
      { name: "Terbitkan ejen", body: "Terbitkan apabila anda berpuas hati. Ia sentiasa memberitahu pemanggil bahawa ia AI." },
      { name: "Pilih pelan", body: "Pilih Starter atau Growth. Yurannya diambil daripada dompet prabayar anda dalam RM." },
      { name: "Dapatkan nombor telefon", body: "Minta nombor JomCall anda dalam aplikasi, dan seorang staf kami akan menyediakannya untuk anda." },
      { name: "Terima panggilan sebenar pertama", body: "Majukan nombor perniagaan anda ke nombor JomCall, supaya pelanggan terus menelefon nombor yang mereka kenal." },
    ],
  },
  languages: {
    heading: "Ia bercakap seperti pemanggil anda bercakap.",
    body: "BM, bahasa Inggeris, Manglish dan Mandarin. Ejen mengikut pemanggil dan menjawab dalam bahasa mereka.",
    samples: {
      ms: "Bahasa Melayu",
      manglish: "BM dan bahasa Inggeris, bercampur",
      zh: "Mandarin",
      en: "Bahasa Inggeris",
    },
    note: "Bahasa Tamil belum disokong buat masa ini.",
  },
  industries: {
    heading: "Dibina untuk panggilan yang perniagaan anda terima",
    items: {
      "industries-clinics": "Janji temu, waktu operasi dan arah lokasi",
      "industries-salons": "Tempahan gunting, warna dan rawatan",
      "industries-car-workshops": "Pesanan untuk mekanik",
      "industries-aircond-home-repair": "Permintaan servis dan pesanan",
      "industries-restaurants": "Waktu operasi, lokasi dan pesanan",
      "industries-tuition-centres": "Soalan tentang kelas dan pesanan ibu bapa",
    },
    all: "Semua industri",
  },
  pricing: {
    heading: "Harga mudah dalam RM",
    lead: "Pelan bulanan atas dompet prabayar, atau tiada yuran bulanan semasa anda menguji.",
    plans: {
      starter: {
        name: "Starter",
        price: rm(starter.monthlyFeeSen),
        per: "sebulan",
        body: "Satu nombor telefon untuk perniagaan anda.",
        features: [
          `${starter.phoneNumbers} nombor telefon`,
          `${minutes(starter.includedVoiceSeconds)} minit setiap bulan`,
          `Kemudian ${perMinute} seminit, dikira sesaat`,
        ],
      },
      growth: {
        name: "Growth",
        price: rm(growth.monthlyFeeSen),
        per: "sebulan",
        body: "Lebih banyak minit untuk talian yang lebih sibuk.",
        features: [
          `${growth.phoneNumbers} nombor telefon`,
          `${minutes(growth.includedVoiceSeconds)} minit setiap bulan`,
          `Kemudian ${perMinute} seminit, dikira sesaat`,
          `Ejen WhatsApp: ${whatsappWaiting.short[1]}`,
        ],
      },
      payg: {
        name: "Bayar ikut guna",
        price: rm(payg.monthlyFeeSen),
        per: "sebulan",
        body: "Tiada yuran bulanan dan tiada nombor telefon. Uji ejen anda dalam pelayar sebelum memilih pelan.",
        features: ["Tiada nombor telefon", "Tambah nilai dompet bila perlu"],
      },
    },
    link: "Lihat harga penuh",
  },
  faq: {
    heading: "Soalan lazim pemilik perniagaan",
    more: "Semua soalan",
    items: [
      {
        q: "Perlukah saya nombor telefon baharu?",
        a: "Tidak. Kekalkan nombor yang pelanggan anda kenal dan majukan panggilannya ke nombor JomCall anda. Anda minta nombor JomCall dalam aplikasi, dan seorang staf kami akan menyediakannya.",
      },
      {
        q: "Adakah pemanggil tahu mereka bercakap dengan AI?",
        a: "Ya. Ejen memberitahu ia AI semasa menjawab, dan ejen tidak boleh diterbitkan tanpa pengenalan itu.",
      },
      {
        q: "Bahasa apa yang ia gunakan?",
        a: "BM, bahasa Inggeris, Manglish dan Mandarin. Ia mengikut pemanggil dan menjawab dalam bahasa mereka. Bahasa Tamil belum disokong buat masa ini.",
      },
      {
        q: "Berapakah kosnya?",
        a: `Pelan bermula ${fee} sebulan dengan satu nombor telefon dan ${minutes(starter.includedVoiceSeconds)} minit. Anda membayar daripada dompet prabayar dalam RM, dan tiada kad dicaj secara automatik.`,
      },
      {
        q: "Adakah JomCall membuat rakaman panggilan?",
        a: "Tidak. JomCall tidak merakam panggilan.",
      },
      {
        q: "Bagaimana dengan WhatsApp?",
        a: `${whatsappWaiting.title[1]}. Panggilan telefon tidak perlu menunggu kelulusan ini, dan kami akan maklumkan apabila Meta meluluskannya.`,
      },
    ],
  },
  closing: {
    heading: "Beri telefon anda penyambut tetamu.",
    body: "Sediakan perniagaan anda, uji ejen dalam pelayar, kemudian majukan panggilan anda.",
  },
};

export type HomeCopy = typeof en;
export const home: Bilingual<HomeCopy> = { en, ms };
