// The guides, in English and Bahasa Melayu (spec sections 3 and 5, Tier 2):
// what an AI receptionist is, what missed calls cost (a worksheet the visitor
// fills in, with no invented statistics), and call forwarding in Malaysia.
// The forwarding guide shares most of its facts with /call-forwarding, so its
// canonical points there (see `canonical` in web/lib/site.ts and NOTES.md).
// Also the labels of the worksheet island, in both of its modes.
import { publicPlans } from "../../lib/pricing.ts";
import { FORWARD_CODES } from "./call-forwarding.ts";
import { rm } from "./format.ts";
import type { Bilingual, FaqItem, PageCopy, Section } from "./types.ts";

export const GUIDE_SLUGS = ["what-is-an-ai-receptionist", "missed-calls-cost", "call-forwarding-malaysia"] as const;
export type GuideSlug = (typeof GUIDE_SLUGS)[number];

const starter = publicPlans.find((p) => p.code === "starter")!;
const fee = rm(starter.monthlyFeeSen);
const minutes = starter.includedVoiceSeconds / 60;
const [allCode] = FORWARD_CODES;

type Named = { name: string; body: string };
type Guide = PageCopy & { summary: string; faqs: FaqItem[] };

export type AiGuide = Guide & {
  what: Section;
  does: { heading: string; lead: string; items: Named[] };
  differs: Section;
  not: { heading: string; items: string[] };
  ask: { heading: string; lead: string; head: [string, string]; rows: { call: string; does: string }[] };
};

export type MissedGuide = Guide & {
  sheet: { heading: string; lead: string };
  find: { heading: string; items: Named[] };
  leaves: Section;
  next: Section & { forwarding: string; pricing: string };
};

export type ForwardGuide = Guide & {
  what: Section;
  codes: { heading: string; lead: string };
  before: { heading: string; steps: string[] };
  full: Section & { link: string };
};

export type GuidesCopy = {
  "what-is-an-ai-receptionist": AiGuide;
  "missed-calls-cost": MissedGuide;
  "call-forwarding-malaysia": ForwardGuide;
};

const en: GuidesCopy = {
  "what-is-an-ai-receptionist": {
    title: "What is an AI receptionist? A plain guide for small businesses",
    description:
      "An AI receptionist answers your business phone and talks with callers in everyday language. What it does on a call, how it differs from a phone menu or voicemail, what it does not do, and what to ask before you choose one.",
    h1: "What is an AI receptionist?",
    lead: "An AI receptionist answers your business phone, talks with callers in everyday language, and does the front-desk jobs a call needs: answering a question, booking a visit, taking a message or passing the caller to a person.",
    summary: "What it is, what it does on a call, and what to ask before you pick one.",
    what: {
      heading: "What it is",
      body: [
        "An AI receptionist is software that picks up your business phone and talks with the caller. Callers say what they need in their own words, and it replies out loud.",
        "It does the jobs a call usually needs at the front desk. It is not a person, and a good one says so at the start.",
      ],
    },
    does: {
      heading: "What it does on a call",
      lead: "On JomCall, that means four jobs.",
      items: [
        { name: "Answers questions", body: "From your own business facts and price list: your hours, your prices, where you are." },
        { name: "Books appointments", body: "Into JomCall's bookings, and reads the time back to the caller before the booking is recorded." },
        { name: "Takes messages", body: "The caller's name, number and reason for calling, saved for your team." },
        { name: "Passes the caller to staff", body: "During opening hours, when the caller asks for a person." },
      ],
    },
    differs: {
      heading: "How it differs from a phone menu or voicemail",
      body: [
        "A phone menu asks callers to press 1 or 2 and sends them down a fixed path. An AI receptionist lets them say what they need.",
        "Voicemail takes a message and waits for you. An AI receptionist can answer the question during the call, so the caller does not wait for a call back.",
        "On JomCall the agent follows the caller's language: BM, English, Manglish or Mandarin, and it switches when the caller switches.",
      ],
    },
    not: {
      heading: "What it does not do",
      items: [
        "It is not a person, and it says so: the agent introduces itself as an AI.",
        "It knows only what you have told it. When it does not know, it is set up to say so and take a message rather than guess.",
        "It passes callers to your staff only during opening hours. Outside them it takes a message.",
        "It takes a limited number of calls at a time. When its lines are full, the next caller is told the line is busy.",
        "It does not speak Tamil yet.",
        "It answers phone calls only. WhatsApp is waiting for Meta's approval.",
      ],
    },
    ask: {
      heading: "Questions to ask before you choose one",
      lead: "Ask these of any AI receptionist. Here are JomCall's answers.",
      head: ["Ask", "JomCall's answer"],
      rows: [
        { call: "Does it say it is an AI?", does: "Yes, at the start of the call. An agent cannot be published without that introduction." },
        { call: "Which languages does it follow?", does: "BM, English, Manglish and Mandarin, following the caller." },
        { call: "Where do its answers come from?", does: "Your own business facts and price list, which you set up and review." },
        { call: "What happens when it does not know?", does: "It is set up to say so and take a message rather than guess." },
        { call: "Can a caller reach a person?", does: "During opening hours the agent passes the caller to your staff." },
        { call: "Is there a recording?", does: "No. Calls are not recorded." },
        { call: "Do I keep my number?", does: "Yes. You forward its calls to your JomCall number." },
        { call: "How is it priced?", does: `From ${fee} a month, from a prepaid wallet in ringgit. No card is charged automatically.` },
      ],
    },
    faqs: [
      {
        q: "Is an AI receptionist the same as a chatbot?",
        a: "Not quite. A chatbot replies in text. An AI receptionist answers the phone and talks with the caller out loud.",
      },
      {
        q: "Will callers know they are talking to an AI?",
        a: "On JomCall, yes. The agent says it is an AI at the start of the call, and an agent cannot be published without that introduction.",
      },
      {
        q: "Can it book appointments?",
        a: "Yes, for businesses that take bookings. It finds a free time, reads it back to the caller and records the booking in JomCall. You add what can be booked on JomCall's Bookings page.",
      },
      {
        q: "What does it cost?",
        a: `JomCall plans start at ${fee} a month with a phone number and ${minutes} minutes, paid from a prepaid wallet. The Pricing page has every rate.`,
      },
    ],
  },
  "missed-calls-cost": {
    title: "What do missed calls cost? A worksheet for your business",
    description:
      "A worksheet that turns your own figures into what missed calls may cost you each month: calls missed a week, the share that would have booked and an average booking. No made-up averages, only your numbers.",
    h1: "What do missed calls cost you?",
    lead: "Nobody can tell you that number but you. Put in three figures from your own week, and the sheet works out what the calls you miss may be worth in a month.",
    summary: "A worksheet: your own figures in, the ringgit at stake each month out.",
    sheet: {
      heading: "Work it out",
      lead: "Change the three figures. The result follows as you type, and nothing leaves your browser.",
    },
    find: {
      heading: "Where to find your numbers",
      items: [
        { name: "Calls you miss", body: "Your phone's call log lists missed calls. Count them for a normal week, not a holiday week." },
        { name: "Share that would have booked", body: "Think of the last ten callers you did reach. If three of them booked or bought, that is 30%." },
        { name: "Average booking", body: "What one booking or order is usually worth to you, in ringgit." },
      ],
    },
    leaves: {
      heading: "What the figure leaves out",
      body: [
        "It counts each missed caller once. A customer who keeps coming back is worth more than one booking; a caller who simply tries again tomorrow costs you less.",
        "Treat it as a rough guide for your own decision, not a forecast.",
      ],
    },
    next: {
      heading: "If the figure is worth acting on",
      body: [
        "You do not need a new number. Forward the calls you do not answer to your JomCall number, so those callers reach the agent instead of a ringing phone.",
        `Plans start at ${fee} a month. The Pricing page estimates your month from your own minutes.`,
      ],
      forwarding: "How call forwarding works",
      pricing: "See pricing",
    },
    faqs: [
      {
        q: "Is this figure accurate?",
        a: "It is as accurate as the figures you put in. It is your own estimate, not a measurement.",
      },
      {
        q: "Will JomCall pick up all the calls I miss now?",
        a: "Only the calls you forward to your JomCall number, and a limited number at a time. When its lines are full, the next caller is told the line is busy.",
      },
      {
        q: "How does the sheet turn a week into a month?",
        a: "It multiplies calls a week by 52 weeks and divides by 12 months, then by the share that would have booked and the average booking.",
      },
      {
        q: "Does this page keep my figures?",
        a: "No. The sheet works in your browser and sends nothing anywhere.",
      },
    ],
  },
  "call-forwarding-malaysia": {
    title: "Call forwarding in Malaysia: a short guide for businesses",
    description:
      "What call forwarding is, the mobile codes that start and stop it, and what to sort out before you forward your business number to JomCall. The step-by-step guide is on the call forwarding page.",
    h1: "Call forwarding in Malaysia",
    lead: "Call forwarding sends your line's calls on to another number. A business uses it to keep the number customers know while someone else, or JomCall, answers.",
    summary: "What forwarding is, the codes, and what to sort out first.",
    what: {
      heading: "What call forwarding is",
      body: [
        "Forwarding is a setting on your line. When it is on, calls to your number go to another number: straight away, after you do not pick up, or while you are busy.",
        "Your customers notice nothing. They dial the same number as always.",
      ],
    },
    codes: {
      heading: "The codes",
      lead: "On a mobile line, type the start code, your JomCall number and #, then press call. The stop code switches it off.",
    },
    before: {
      heading: "Before you dial",
      steps: [
        "Get your JomCall number. You request it in the app, and a person sets it up.",
        "Test your agent in the browser and publish it, so the first forwarded caller hears it.",
        "Decide who answers first: JomCall straight away, or your own phone first and JomCall when nobody picks up.",
        "Ask your line provider what forwarded calls cost on your plan.",
      ],
    },
    full: {
      heading: "The full guide",
      body: [
        "The call forwarding page explains each code, which one to pick, the steps on a mobile line, what to do on an office line and how to check that it works.",
      ],
      link: "Read the full call forwarding guide",
    },
    faqs: [
      {
        q: "Do I have to change my business number?",
        a: "No. You keep the number your customers know and forward its calls to your JomCall number.",
      },
      {
        q: "How do I stop forwarding?",
        a: `Type the stop code that matches the start code you used, then press call. For example, ${allCode.stop} stops forwarding every call.`,
      },
    ],
  },
};

const ms: GuidesCopy = {
  "what-is-an-ai-receptionist": {
    title: "Apa itu penyambut tetamu AI? Panduan ringkas untuk perniagaan kecil",
    description:
      "Penyambut tetamu AI menjawab telefon perniagaan anda dan bercakap dengan pemanggil dalam bahasa harian. Apa yang ia buat semasa panggilan, bezanya dengan menu telefon atau mel suara, apa yang ia tidak buat, dan soalan untuk ditanya sebelum memilih.",
    h1: "Apa itu penyambut tetamu AI?",
    lead: "Penyambut tetamu AI menjawab telefon perniagaan anda, bercakap dengan pemanggil dalam bahasa harian, dan membuat kerja kaunter yang diperlukan oleh panggilan: menjawab soalan, menempah lawatan, mengambil pesanan atau menyambungkan pemanggil kepada orang.",
    summary: "Apa itu, apa yang ia buat semasa panggilan, dan soalan untuk ditanya sebelum memilih.",
    what: {
      heading: "Apa itu",
      body: [
        "Penyambut tetamu AI ialah perisian yang mengangkat telefon perniagaan anda dan bercakap dengan pemanggil. Pemanggil menyebut apa yang mereka perlukan dengan kata-kata sendiri, dan ia membalas dengan suara.",
        "Ia membuat kerja yang biasanya diperlukan oleh panggilan di kaunter. Ia bukan manusia, dan yang baik akan memberitahunya pada awal panggilan.",
      ],
    },
    does: {
      heading: "Apa yang ia buat semasa panggilan",
      lead: "Bagi JomCall, ada empat kerja.",
      items: [
        { name: "Menjawab soalan", body: "Daripada fakta perniagaan dan senarai harga anda sendiri: waktu buka, harga, lokasi anda." },
        { name: "Membuat tempahan temu janji", body: "Dalam JomCall, dan mengulang masanya kepada pemanggil sebelum tempahan direkodkan." },
        { name: "Mengambil pesanan", body: "Nama, nombor dan sebab pemanggil menelefon, disimpan untuk pasukan anda." },
        { name: "Menyambungkan pemanggil kepada staf", body: "Dalam waktu operasi, apabila pemanggil meminta untuk bercakap dengan orang." },
      ],
    },
    differs: {
      heading: "Bezanya dengan menu telefon atau mel suara",
      body: [
        "Menu telefon meminta pemanggil menekan 1 atau 2 dan menghantar mereka ke laluan yang tetap. Penyambut tetamu AI membiarkan mereka menyebut apa yang diperlukan.",
        "Mel suara mengambil pesanan dan menunggu anda. Penyambut tetamu AI boleh menjawab soalan semasa panggilan, jadi pemanggil tidak perlu menunggu anda telefon semula.",
        "Bagi JomCall, ejen mengikut bahasa pemanggil: BM, bahasa Inggeris, Manglish atau Mandarin, dan ia bertukar apabila pemanggil bertukar.",
      ],
    },
    not: {
      heading: "Apa yang ia tidak buat",
      items: [
        "Ia bukan manusia, dan ia memberitahunya: ejen memperkenalkan dirinya sebagai AI.",
        "Ia hanya tahu apa yang anda beritahu. Apabila ia tidak tahu, ia ditetapkan untuk berkata begitu dan mengambil pesanan, bukan meneka.",
        "Ia menyambungkan pemanggil kepada staf hanya dalam waktu operasi. Di luar waktu itu, ia mengambil pesanan.",
        "Ia menerima bilangan panggilan yang terhad pada satu masa. Apabila taliannya penuh, pemanggil seterusnya diberitahu talian sibuk.",
        "Ia belum boleh bercakap bahasa Tamil.",
        "Ia hanya menerima panggilan telefon. WhatsApp sedang menunggu kelulusan Meta.",
      ],
    },
    ask: {
      heading: "Soalan untuk ditanya sebelum memilih",
      lead: "Tanya soalan ini kepada mana-mana penyambut tetamu AI. Ini jawapan JomCall.",
      head: ["Tanya", "Jawapan JomCall"],
      rows: [
        { call: "Adakah ia memberitahu bahawa ia AI?", does: "Ya, pada awal panggilan. Ejen tidak boleh diterbitkan tanpa pengenalan itu." },
        { call: "Bahasa apa yang ia ikut?", does: "BM, bahasa Inggeris, Manglish dan Mandarin, mengikut pemanggil." },
        { call: "Dari mana jawapannya datang?", does: "Daripada fakta perniagaan dan senarai harga anda sendiri, yang anda sediakan dan semak." },
        { call: "Apa jadi apabila ia tidak tahu?", does: "Ia ditetapkan untuk berkata begitu dan mengambil pesanan, bukan meneka." },
        { call: "Bolehkah pemanggil bercakap dengan orang?", does: "Dalam waktu operasi, ejen menyambungkan pemanggil kepada staf anda." },
        { call: "Ada rakaman?", does: "Tiada. Panggilan tidak dirakam." },
        { call: "Bolehkah saya kekalkan nombor saya?", does: "Boleh. Anda majukan panggilannya ke nombor JomCall anda." },
        { call: "Bagaimana harganya?", does: `Dari ${fee} sebulan, daripada dompet prabayar dalam ringgit. Tiada kad dicaj secara automatik.` },
      ],
    },
    faqs: [
      {
        q: "Adakah penyambut tetamu AI sama dengan chatbot?",
        a: "Tidak sama. Chatbot membalas dalam bentuk teks. Penyambut tetamu AI menjawab telefon dan bercakap dengan pemanggil menggunakan suara.",
      },
      {
        q: "Adakah pemanggil tahu mereka bercakap dengan AI?",
        a: "Bagi JomCall, ya. Ejen memberitahu bahawa ia AI pada awal panggilan, dan ejen tidak boleh diterbitkan tanpa pengenalan itu.",
      },
      {
        q: "Bolehkah ia membuat tempahan temu janji?",
        a: "Boleh, bagi perniagaan yang menerima tempahan. Ia mencari masa yang kosong, mengulang masa itu kepada pemanggil dan merekodkan tempahan dalam JomCall. Anda tambah apa yang boleh ditempah di halaman Tempahan JomCall.",
      },
      {
        q: "Berapa kosnya?",
        a: `Pelan JomCall bermula pada ${fee} sebulan dengan satu nombor telefon dan ${minutes} minit, dibayar daripada dompet prabayar. Halaman Harga ada semua kadar.`,
      },
    ],
  },
  "missed-calls-cost": {
    title: "Berapa kos panggilan yang terlepas? Helaian kira untuk perniagaan anda",
    description:
      "Helaian kira yang menukar angka anda sendiri kepada anggaran kos panggilan terlepas setiap bulan: panggilan terlepas seminggu, bahagian yang akan membuat tempahan dan nilai purata satu tempahan. Tiada purata rekaan, hanya angka anda.",
    h1: "Berapa kos panggilan yang terlepas?",
    lead: "Hanya anda yang tahu angkanya. Masukkan tiga angka daripada minggu biasa anda, dan helaian ini mengira nilai panggilan yang terlepas dalam sebulan.",
    summary: "Helaian kira: masukkan angka anda sendiri, dapatkan nilai dalam ringgit setiap bulan.",
    sheet: {
      heading: "Kira sendiri",
      lead: "Ubah tiga angka ini. Hasilnya berubah semasa anda menaip, dan tiada apa yang keluar dari pelayar anda.",
    },
    find: {
      heading: "Di mana hendak cari angka anda",
      items: [
        { name: "Panggilan yang terlepas", body: "Log panggilan telefon anda menyenaraikan panggilan terlepas. Kira untuk minggu biasa, bukan minggu cuti." },
        { name: "Bahagian yang akan menempah", body: "Fikirkan sepuluh pemanggil terakhir yang sempat anda jawab. Jika tiga daripadanya menempah atau membeli, itu 30%." },
        { name: "Nilai purata tempahan", body: "Nilai biasa satu tempahan atau pesanan bagi anda, dalam ringgit." },
      ],
    },
    leaves: {
      heading: "Apa yang tidak dikira",
      body: [
        "Setiap pemanggil yang terlepas dikira sekali sahaja. Pelanggan yang datang berulang kali bernilai lebih daripada satu tempahan; pemanggil yang cuba lagi esok kurang merugikan anda.",
        "Anggap angka ini sebagai panduan kasar untuk keputusan anda sendiri, bukan ramalan.",
      ],
    },
    next: {
      heading: "Jika angkanya wajar diambil tindakan",
      body: [
        "Anda tidak perlu nombor baharu. Majukan panggilan yang tidak dijawab ke nombor JomCall anda, supaya pemanggil itu sampai kepada ejen dan bukan kepada telefon yang terus berdering.",
        `Pelan bermula pada ${fee} sebulan. Halaman Harga menganggarkan kos bulanan anda daripada minit anda sendiri.`,
      ],
      forwarding: "Cara pemajuan panggilan berfungsi",
      pricing: "Lihat harga",
    },
    faqs: [
      {
        q: "Tepatkah angka ini?",
        a: "Setepat angka yang anda masukkan. Ini anggaran anda sendiri, bukan ukuran.",
      },
      {
        q: "Bolehkah JomCall mengangkat semua panggilan yang saya terlepas sekarang?",
        a: "Hanya panggilan yang anda majukan ke nombor JomCall anda, dan bilangannya terhad pada satu masa. Apabila taliannya penuh, pemanggil seterusnya diberitahu talian sibuk.",
      },
      {
        q: "Bagaimana helaian ini menukar seminggu kepada sebulan?",
        a: "Ia mendarab panggilan seminggu dengan 52 minggu dan membahagi dengan 12 bulan, kemudian dengan bahagian yang akan menempah dan nilai purata tempahan.",
      },
      {
        q: "Adakah halaman ini menyimpan angka saya?",
        a: "Tidak. Helaian ini berjalan dalam pelayar anda dan tidak menghantar apa-apa ke mana-mana.",
      },
    ],
  },
  "call-forwarding-malaysia": {
    title: "Pemajuan panggilan di Malaysia: panduan ringkas untuk perniagaan",
    description:
      "Apa itu pemajuan panggilan, kod telefon bimbit untuk memulakan dan menghentikannya, dan apa yang perlu diuruskan sebelum anda majukan nombor perniagaan ke JomCall. Panduan langkah demi langkah ada di halaman pemajuan panggilan.",
    h1: "Pemajuan panggilan di Malaysia",
    lead: "Pemajuan panggilan menghantar panggilan talian anda ke nombor lain. Perniagaan menggunakannya untuk mengekalkan nombor yang pelanggan kenal sementara orang lain, atau JomCall, yang menjawab.",
    summary: "Apa itu pemajuan, kodnya, dan apa yang perlu diuruskan dahulu.",
    what: {
      heading: "Apa itu pemajuan panggilan",
      body: [
        "Pemajuan ialah tetapan pada talian anda. Apabila ia dihidupkan, panggilan ke nombor anda pergi ke nombor lain: terus, selepas anda tidak angkat, atau semasa anda sibuk.",
        "Pelanggan anda tidak perasan apa-apa. Mereka mendail nombor yang sama seperti biasa.",
      ],
    },
    codes: {
      heading: "Kodnya",
      lead: "Bagi talian mudah alih, taip kod mula, nombor JomCall anda dan #, kemudian tekan panggil. Kod henti mematikannya.",
    },
    before: {
      heading: "Sebelum anda mendail",
      steps: [
        "Dapatkan nombor JomCall anda. Anda memohonnya dalam aplikasi, dan seorang staf kami menyediakannya.",
        "Uji ejen anda dalam pelayar dan terbitkannya, supaya pemanggil pertama yang dimajukan mendengarnya.",
        "Tentukan siapa yang menjawab dahulu: JomCall terus, atau telefon anda dahulu dan JomCall apabila tiada siapa angkat.",
        "Tanya pembekal talian anda kos panggilan yang dimajukan bagi pelan anda.",
      ],
    },
    full: {
      heading: "Panduan penuh",
      body: [
        "Halaman pemajuan panggilan menerangkan setiap kod, yang mana patut dipilih, langkah bagi talian mudah alih, apa yang perlu dibuat bagi talian pejabat dan cara menyemak sama ada ia berfungsi.",
      ],
      link: "Baca panduan penuh pemajuan panggilan",
    },
    faqs: [
      {
        q: "Perlukah saya tukar nombor perniagaan saya?",
        a: "Tidak. Anda kekalkan nombor yang pelanggan kenal dan majukan panggilannya ke nombor JomCall anda.",
      },
      {
        q: "Bagaimana cara menghentikan pemajuan?",
        a: `Taip kod henti yang sepadan dengan kod mula yang anda guna, kemudian tekan panggil. Contohnya, ${allCode.stop} menghentikan pemajuan semua panggilan.`,
      },
    ],
  },
};

export const guides: Bilingual<GuidesCopy> = { en, ms };

export type GuidesIndexCopy = { page: PageCopy; heading: string };

export const guidesIndex: Bilingual<GuidesIndexCopy> = {
  en: {
    page: {
      title: "Guides for small business phone calls",
      description:
        "Plain guides for owners: what an AI receptionist is, a worksheet for what missed calls cost you, and call forwarding in Malaysia.",
      h1: "Guides",
      lead: "Plain answers for owners who are busy with a customer when the phone rings.",
    },
    heading: "All guides",
  },
  ms: {
    page: {
      title: "Panduan panggilan telefon untuk perniagaan kecil",
      description:
        "Panduan ringkas untuk pemilik: apa itu penyambut tetamu AI, helaian kira kos panggilan yang terlepas, dan pemajuan panggilan di Malaysia.",
      h1: "Panduan",
      lead: "Jawapan ringkas untuk pemilik yang sedang melayan pelanggan ketika telefon berdering.",
    },
    heading: "Semua panduan",
  },
};

// The worksheet island's words, in both modes. "{...}" tokens are filled by
// the island from the visitor's own figures.
export type WorksheetCopy = {
  missed: {
    label: string;
    example: string;
    perWeek: { label: string; unit: string };
    share: { label: string; unit: string };
    average: { label: string; unit: string };
    result: string;
    working: string;
    said: string;
    fine: string;
  };
  cost: {
    label: string;
    cost: { label: string; hint: string; unit: string };
    minutes: { label: string; unit: string };
    yours: string;
    empty: string;
    jomcall: string;
    said: string;
    saidEmpty: string;
    fine: string;
  };
};

export const worksheetCopy: Bilingual<WorksheetCopy> = {
  en: {
    missed: {
      label: "Missed calls worksheet",
      example: "The figures below are an example to start from, not an average. Change them to your own.",
      perWeek: { label: "Calls you miss in a normal week", unit: "calls" },
      share: { label: "Share of those callers who would have booked", unit: "%" },
      average: { label: "What an average booking is worth", unit: "RM" },
      result: "At stake each month, by your figures",
      working: "{calls} missed calls a month × {share} × {average}",
      said: "About {amount} a month at stake, by your own figures.",
      fine: "This is your own estimate from the figures you typed. It is not a forecast, and not a promise of what JomCall will bring in.",
    },
    cost: {
      label: "Receptionist cost sheet",
      cost: {
        label: "What a receptionist costs you a month",
        hint: "Salary plus extras, such as allowances and contributions. Your own figure: this page does not guess one.",
        unit: "RM",
      },
      minutes: { label: "Minutes of calls a month", unit: "minutes" },
      yours: "Your receptionist figure",
      empty: "Type your figure",
      jomcall: "JomCall on {plan} at {minutes} minutes",
      said: "Your figure: {cost}. JomCall on {plan} at {minutes} minutes: {jomcall}.",
      saidEmpty: "JomCall on {plan} at {minutes} minutes: {jomcall}. Type your receptionist figure to set it beside.",
      fine: "Your figure is your own. JomCall's comes from today's price table and covers phone calls only, not the counter work a person does.",
    },
  },
  ms: {
    missed: {
      label: "Helaian kira panggilan terlepas",
      example: "Angka di bawah hanya contoh untuk bermula, bukan purata. Tukar kepada angka anda sendiri.",
      perWeek: { label: "Panggilan yang anda terlepas dalam minggu biasa", unit: "panggilan" },
      share: { label: "Bahagian pemanggil itu yang akan menempah", unit: "%" },
      average: { label: "Nilai purata satu tempahan", unit: "RM" },
      result: "Nilai setiap bulan, ikut angka anda",
      working: "{calls} panggilan terlepas sebulan × {share} × {average}",
      said: "Kira-kira {amount} sebulan, ikut angka anda sendiri.",
      fine: "Ini anggaran anda sendiri daripada angka yang anda taip. Ia bukan ramalan, dan bukan janji tentang hasil yang JomCall akan bawa.",
    },
    cost: {
      label: "Helaian kos penyambut tetamu",
      cost: {
        label: "Kos penyambut tetamu sebulan",
        hint: "Gaji dan kos lain, seperti elaun dan caruman. Angka anda sendiri: halaman ini tidak meneka.",
        unit: "RM",
      },
      minutes: { label: "Minit panggilan sebulan", unit: "minit" },
      yours: "Angka penyambut tetamu anda",
      empty: "Taip angka anda",
      jomcall: "JomCall pelan {plan} pada {minutes} minit",
      said: "Angka anda: {cost}. JomCall pelan {plan} pada {minutes} minit: {jomcall}.",
      saidEmpty: "JomCall pelan {plan} pada {minutes} minit: {jomcall}. Taip angka penyambut tetamu anda untuk dibandingkan.",
      fine: "Angka anda ialah angka anda sendiri. Angka JomCall diambil daripada jadual harga semasa dan hanya meliputi panggilan telefon, bukan kerja kaunter yang dibuat oleh orang.",
    },
  },
};
