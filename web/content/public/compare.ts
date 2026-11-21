// The comparison pages, in English and Bahasa Melayu (spec sections 3 and 5,
// Tier 2). Each page compares JomCall with a category of option, never a
// named product: voicemail, a receptionist, an answering service and a
// WhatsApp bot. Each says when the other option is the better choice.
// Every JomCall cell in a table is a key into `jomcallFacts`, and every fact
// there names its row in the spec section 3 table. The other column
// describes the category in general terms: no prices, waits or statistics.
import { whatsappWaiting } from "../../lib/launch.ts";
import { publicPlans } from "../../lib/pricing.ts";
import { rm } from "./format.ts";
import type { Bilingual, FaqItem, PageCopy } from "./types.ts";

export const COMPARE_SLUGS = ["voicemail", "receptionist", "answering-service", "whatsapp-bot"] as const;
export type CompareSlug = (typeof COMPARE_SLUGS)[number];

const starter = publicPlans.find((p) => p.code === "starter")!;
const fee = rm(starter.monthlyFeeSen);
const minutes = starter.includedVoiceSeconds / 60;

// What JomCall does, one line per fact, each from a row of the spec section 3
// table (named in the comment). The tables use only these lines.
export const FACT_KEYS = [
  "answers",
  "phoneOnly",
  "languages",
  "questions",
  "bookings",
  "messages",
  "transfer",
  "number",
  "setup",
  "price",
  "whatsapp",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export const jomcallFacts: Bilingual<Record<FactKey, string>> = {
  en: {
    // §3: answers phone calls on a JomCall number, day and night, with an AI that says it is an AI.
    answers: "The AI answers on your JomCall number, day and night, and says it is an AI.",
    // §3: the same row; the scope is phone calls.
    phoneOnly: "Phone calls only. It cannot help anyone at the counter.",
    // §3: speaks BM, English, Manglish and Mandarin, following the caller.
    languages: "BM, English, Manglish and Mandarin, following the caller.",
    // §3: answers questions from the business's own facts and price list.
    questions: "From your own business facts and price list.",
    // §3: books appointments into JomCall's bookings, with the time read back.
    bookings: "Books into JomCall's bookings and reads the time back to the caller.",
    // §3: takes messages for the team.
    messages: "Takes a message for your team.",
    // §3: passes the caller to your staff during opening hours (a blind transfer).
    transfer: "Passes the caller to your staff during opening hours.",
    // §3: keep your number; forward its calls to your JomCall number.
    number: "Keep your number and forward its calls to your JomCall number.",
    // §3: setup by business type, up to 8 questions or a price list; review, test, publish.
    setup: "You set it up yourself: pick a business type, answer up to 8 questions or bring your price list, then test it in the browser and publish.",
    // §3: from the Starter fee a month, prepaid MYR wallet, no card charged automatically.
    price: `From ${fee} a month, paid from a prepaid wallet in ringgit. No card is charged automatically.`,
    // §3: WhatsApp is waiting for Meta's approval (whatsappWaiting).
    whatsapp: `${whatsappWaiting.title[0]}.`,
  },
  ms: {
    answers: "AI menjawab di nombor JomCall anda, siang dan malam, dan memberitahu bahawa ia AI.",
    phoneOnly: "Panggilan telefon sahaja. Ia tidak dapat membantu sesiapa di kaunter.",
    languages: "BM, bahasa Inggeris, Manglish dan Mandarin, mengikut pemanggil.",
    questions: "Daripada fakta perniagaan dan senarai harga anda sendiri.",
    bookings: "Merekodkan tempahan dalam JomCall dan mengulang masanya kepada pemanggil.",
    messages: "Mengambil pesanan untuk pasukan anda.",
    transfer: "Menyambungkan pemanggil kepada staf anda dalam waktu operasi.",
    number: "Kekalkan nombor anda dan majukan panggilannya ke nombor JomCall anda.",
    setup: "Anda sediakan sendiri: pilih jenis perniagaan, jawab hingga 8 soalan atau bawa senarai harga, kemudian uji dalam pelayar dan terbitkan.",
    price: `Daripada ${fee} sebulan, dibayar daripada dompet prabayar dalam ringgit. Tiada kad dicaj secara automatik.`,
    whatsapp: `${whatsappWaiting.title[1]}.`,
  },
};

export type CompareRow = { topic: string; them: string; us: FactKey };

export type CompareCopy = PageCopy & {
  // One line for the compare index.
  summary: string;
  // The other option, as a column heading: "Voicemail".
  them: string;
  short: { heading: string; body: string[] };
  table: { heading: string; lead: string; rows: CompareRow[] };
  better: { heading: string; them: { name: string; points: string[] }; us: { name: string; points: string[] } };
  faqs: FaqItem[];
};

// Labels shared by the four pages.
export type CompareLabels = {
  topic: string;
  us: string;
  others: string;
  // The receptionist page: the visitor's own cost beside JomCall's month.
  cost: { heading: string; lead: string };
  // The WhatsApp bot page: the plain status line under the lead.
  waiting: { title: string; body: string };
};

export const compareLabels: Bilingual<CompareLabels> = {
  en: {
    topic: "Topic",
    us: "JomCall",
    others: "Other comparisons",
    cost: {
      heading: "Put your own numbers side by side",
      lead: "Type what a receptionist costs you a month, with salary and extras, and roughly how many minutes of calls you get. JomCall's figure comes from today's price table.",
    },
    waiting: {
      title: `${whatsappWaiting.title[0]}.`,
      body: "Until Meta approves JomCall, a business cannot connect its WhatsApp number. JomCall takes phone calls today; phone calls do not wait for Meta.",
    },
  },
  ms: {
    topic: "Perkara",
    us: "JomCall",
    others: "Perbandingan lain",
    cost: {
      heading: "Bandingkan dengan angka anda sendiri",
      lead: "Taip kos penyambut tetamu sebulan, termasuk gaji dan kos lain, dan anggaran minit panggilan yang anda terima. Angka JomCall diambil daripada jadual harga semasa.",
    },
    waiting: {
      title: `${whatsappWaiting.title[1]}.`,
      body: "Selagi Meta belum meluluskan JomCall, perniagaan tidak boleh menyambungkan nombor WhatsApp mereka. JomCall menerima panggilan telefon sekarang; panggilan telefon tidak perlu menunggu Meta.",
    },
  },
};

const en: Record<CompareSlug, CompareCopy> = {
  voicemail: {
    title: "JomCall vs voicemail for a small business",
    description:
      "Voicemail takes a message and waits for you to call back. JomCall talks to the caller: it answers from your own facts, books appointments and takes messages. When each one is the better choice, side by side.",
    h1: "JomCall or voicemail?",
    lead: "Voicemail waits for you to call back. JomCall talks to the caller now: it answers questions from your own facts, books appointments and takes messages. Here is when each one makes sense.",
    summary: "When a mailbox is enough, and when the caller needs an answer on the call.",
    them: "Voicemail",
    short: {
      heading: "The short answer",
      body: [
        "Voicemail is enough when few calls come in and callers are happy to leave a message and wait for you.",
        "JomCall fits when callers want an answer on the call: your hours, a price, a free slot. It talks with them, books the visit into JomCall's bookings and takes a message for your team.",
      ],
    },
    table: {
      heading: "Side by side",
      lead: "What happens to the caller with each one.",
      rows: [
        { topic: "Who picks up", them: "Your greeting, then a beep. The caller talks to a mailbox.", us: "answers" },
        { topic: "Questions about hours and prices", them: "The caller waits until you call back.", us: "questions" },
        { topic: "Booking a visit", them: "You call back to agree a time.", us: "bookings" },
        { topic: "Taking a message", them: "Yes. You listen to each one later.", us: "messages" },
        { topic: "Reaching a person", them: "Not during the call.", us: "transfer" },
        { topic: "Languages", them: "Your greeting is in the language you chose when you set it.", us: "languages" },
        { topic: "Your number", them: "Usually part of your phone line.", us: "number" },
        { topic: "Cost", them: "Often included with your line. Ask your provider.", us: "price" },
      ],
    },
    better: {
      heading: "When each is better",
      them: {
        name: "Voicemail is better when",
        points: [
          "Few calls come in, and callers are happy to wait for a call back.",
          "Every call needs you in person, for example a quote only you can give.",
          "You would rather not pay a monthly fee for answering.",
        ],
      },
      us: {
        name: "JomCall is better when",
        points: [
          "Callers ask the same questions about hours, prices and directions.",
          "Callers want to book while they are still on the phone.",
          "Your callers would rather not leave a message.",
          "Callers speak BM, English, Manglish or Mandarin and expect a reply in their language.",
        ],
      },
    },
    faqs: [
      {
        q: "Does JomCall replace my voicemail?",
        a: "Only for the calls you forward to it. If you forward the calls you do not answer to your JomCall number, the agent answers them instead of your mailbox, up to the number of calls it takes at a time; past that, the caller is told the line is busy. You can stop forwarding at any time with the stop code.",
      },
      {
        q: "How does a message reach me?",
        a: "The agent takes the caller's name, number and reason for calling, and saves it as a message for your team in JomCall.",
      },
      {
        q: "What does JomCall cost compared with voicemail?",
        a: `Voicemail often comes with your phone line. JomCall plans start at ${fee} a month with a phone number and ${minutes} minutes, paid from a prepaid wallet. The Pricing page has every rate.`,
      },
    ],
  },
  receptionist: {
    title: "JomCall vs a receptionist: what each does, and your own cost",
    description:
      "A receptionist does far more than answer the phone; JomCall only handles calls. When a person is the better choice, what JomCall does on the phone, and a sheet to set your own receptionist cost beside JomCall's price.",
    h1: "JomCall or a receptionist?",
    lead: "A good receptionist greets walk-ins, runs the counter and knows your regulars. JomCall does one job: it answers your phone line. Here is a fair look at both, with your own numbers.",
    summary: "What a person at the front desk does that JomCall cannot, and the other way round.",
    them: "A receptionist",
    short: {
      heading: "The short answer",
      body: [
        "If you need someone at the front desk, hire a person. JomCall cannot greet a walk-in, take payment at the counter or settle a complaint face to face.",
        "If the trouble is the phone ringing while everyone is busy, or calls after closing time, JomCall answers on your JomCall number, day and night, at a price you can see on the Pricing page.",
      ],
    },
    table: {
      heading: "Side by side",
      lead: "What each one covers on a normal working day.",
      rows: [
        { topic: "Hours", them: "Their working hours, unless you arrange cover.", us: "answers" },
        { topic: "Walk-in customers", them: "Yes, at the counter.", us: "phoneOnly" },
        { topic: "Languages", them: "The languages they speak.", us: "languages" },
        { topic: "Questions", them: "From what they know and remember.", us: "questions" },
        { topic: "Bookings", them: "In your book or system, by hand.", us: "bookings" },
        { topic: "Unusual requests", them: "A person can decide on the spot.", us: "messages" },
        { topic: "Passing a call on", them: "To anyone, whenever they judge it right.", us: "transfer" },
        { topic: "Cost", them: "Salary and extras. Type your own figure in the sheet below.", us: "price" },
      ],
    },
    better: {
      heading: "When each is better",
      them: {
        name: "A receptionist is better when",
        points: [
          "Customers walk in and need someone at the counter.",
          "Calls need judgement, such as a complaint or a price you agree case by case.",
          "Many people call at the same moment. JomCall takes a limited number of calls at a time; when its lines are full, the next caller is told the line is busy.",
        ],
      },
      us: {
        name: "JomCall is better when",
        points: [
          "The phone rings while your hands are busy with a customer.",
          "Calls come after closing time or on public holidays.",
          "Callers speak BM, English, Manglish or Mandarin, and you want each one answered in their language.",
          "You would rather pay by plan and by minute from a prepaid wallet than add a salary.",
        ],
      },
    },
    faqs: [
      {
        q: "Does JomCall replace my receptionist?",
        a: "It answers the phone. It does not greet walk-ins or work the counter. You can forward only the calls nobody picks up, so your staff still answer first.",
      },
      {
        q: "What happens when a caller needs a person?",
        a: "During opening hours the agent passes the caller to your staff. Outside opening hours it takes a message for your team.",
      },
      {
        q: "Why is there no salary figure on this page?",
        a: "Pay differs by town, hours and role, so the sheet takes your own figure instead of guessing one.",
      },
    ],
  },
  "answering-service": {
    title: "JomCall vs an answering service",
    description:
      "An answering service puts people on your calls; JomCall puts an AI on them, set up from your own facts and price list. Who speaks, what they know, how you set it up and when a human service is the better choice.",
    h1: "JomCall or an answering service?",
    lead: "An answering service puts trained people on your calls. JomCall puts an AI on them, set up from your own facts and price list. Both pick up; they differ in who speaks, what they know and how you pay.",
    summary: "People reading your notes, or an AI set up from your own facts.",
    them: "An answering service",
    short: {
      heading: "The short answer",
      body: [
        "Pick an answering service if callers must speak to a person, or the calls need judgement that notes cannot hold.",
        "Pick JomCall if callers mostly ask about hours, prices and free slots, want to book on the call, or speak BM, English, Manglish or Mandarin, and you want to set it up yourself.",
      ],
    },
    table: {
      heading: "Side by side",
      lead: "How each one handles a call for your business.",
      rows: [
        { topic: "Who speaks", them: "A person, often working from notes you give them.", us: "answers" },
        { topic: "What they know", them: "The notes and script you send.", us: "questions" },
        { topic: "Languages", them: "Depends on the staff on shift.", us: "languages" },
        { topic: "Bookings", them: "Depends on the service. Some book, others pass on a message.", us: "bookings" },
        { topic: "Messages", them: "Usually passed on to you by email or text.", us: "messages" },
        { topic: "Passing the call to you", them: "Depends on the service.", us: "transfer" },
        { topic: "Setting it up", them: "Usually arranged with the service.", us: "setup" },
        { topic: "Price", them: "Set by each service.", us: "price" },
        { topic: "Your number", them: "Usually you forward your calls to them.", us: "number" },
      ],
    },
    better: {
      heading: "When each is better",
      them: {
        name: "An answering service is better when",
        points: [
          "Callers expect a human voice and nothing else will do.",
          "Calls need care or judgement that notes cannot hold.",
          "Many people call at once. A service with several staff can take a burst of calls; JomCall takes a limited number at a time, and the next caller is told the line is busy.",
        ],
      },
      us: {
        name: "JomCall is better when",
        points: [
          "You want to set it up yourself: pick a business type, answer a few questions or bring your price list, then test it in the browser.",
          "You want answers from your own facts and price list.",
          "You want one agent that follows BM, English, Manglish and Mandarin, whoever is on shift.",
          `You want to see the price before you start: plans from ${fee} a month.`,
        ],
      },
    },
    faqs: [
      {
        q: "Does the caller know it is an AI?",
        a: "Yes. The agent says it is an AI at the start of the call, and an agent cannot be published without that introduction.",
      },
      {
        q: "Can I test JomCall before I forward my number?",
        a: "Yes. You test the agent in the browser before you publish it, and before any real call reaches it.",
      },
      {
        q: "How do I move from an answering service?",
        a: "Forward your business number to your JomCall number instead of to the service. The codes and steps are on the call forwarding page.",
      },
    ],
  },
  "whatsapp-bot": {
    title: "JomCall vs a WhatsApp bot: calls and chats",
    description:
      "A WhatsApp bot replies to chats; JomCall answers phone calls. JomCall's own WhatsApp agent is waiting for Meta's approval. Which customers each one reaches, and when a chat bot is the better choice.",
    h1: "JomCall or a WhatsApp bot?",
    lead: "A WhatsApp bot replies to chats. JomCall answers phone calls. They reach different customers: the ones who type, and the ones who ring.",
    summary: "Customers who type, and customers who ring. JomCall's WhatsApp agent is waiting for Meta's approval.",
    them: "A WhatsApp bot",
    short: {
      heading: "The short answer",
      body: [
        "If most customers message you, a WhatsApp bot handles chats today and JomCall does not.",
        "If customers still ring your number, a chat bot cannot pick up. JomCall answers the call in the caller's language, books the visit and takes a message.",
      ],
    },
    table: {
      heading: "Side by side",
      lead: "Where each one meets your customers.",
      rows: [
        { topic: "Where customers reach it", them: "In WhatsApp chats.", us: "answers" },
        { topic: "WhatsApp chats", them: "Yes, that is what it is for.", us: "whatsapp" },
        { topic: "Spoken languages", them: "It replies in text.", us: "languages" },
        { topic: "Questions", them: "From the replies you set up in the bot.", us: "questions" },
        { topic: "Bookings", them: "Depends on the bot.", us: "bookings" },
        { topic: "Reaching a person", them: "Hands the chat to your team, if the bot supports it.", us: "transfer" },
        { topic: "Your number", them: "Runs on a WhatsApp Business number.", us: "number" },
      ],
    },
    better: {
      heading: "When each is better",
      them: {
        name: "A WhatsApp bot is better when",
        points: [
          "Your customers message you far more than they call.",
          "Customers send photos, locations or documents.",
          "You want every conversation in writing, in the chat.",
        ],
      },
      us: {
        name: "JomCall is better when",
        points: [
          "Customers still ring your number, or call when something is urgent.",
          "Callers need an answer on the phone: your hours, a price, a free slot.",
          "You want visits booked into JomCall's bookings while the caller is on the line.",
        ],
      },
    },
    faqs: [
      {
        q: "What about JomCall on WhatsApp?",
        a: "WhatsApp is waiting for Meta's approval. Until Meta approves JomCall, a business cannot connect its WhatsApp number. Phone calls do not wait for this.",
      },
      {
        q: "Can I use a WhatsApp bot and JomCall together?",
        a: "Yes. They cover different channels: the bot handles chats, and JomCall takes phone calls.",
      },
      {
        q: "Does the caller know it is an AI?",
        a: "Yes. The agent says it is an AI at the start of the call, and an agent cannot be published without that introduction.",
      },
    ],
  },
};

const ms: Record<CompareSlug, CompareCopy> = {
  voicemail: {
    title: "JomCall berbanding mel suara untuk perniagaan kecil",
    description:
      "Mel suara mengambil pesanan dan menunggu anda telefon semula. JomCall bercakap dengan pemanggil: ia menjawab daripada fakta anda sendiri, membuat tempahan temu janji dan mengambil pesanan. Perbandingan terus: bila setiap satu lebih sesuai.",
    h1: "JomCall atau mel suara?",
    lead: "Mel suara menunggu anda telefon semula. JomCall bercakap dengan pemanggil ketika itu juga: ia menjawab soalan daripada fakta anda sendiri, membuat tempahan temu janji dan mengambil pesanan. Di bawah, bila setiap satu lebih sesuai.",
    summary: "Bila peti mel sudah cukup, dan bila pemanggil perlukan jawapan semasa panggilan.",
    them: "Mel suara",
    short: {
      heading: "Jawapan ringkas",
      body: [
        "Mel suara sudah cukup jika tidak banyak panggilan masuk dan pemanggil tidak kisah meninggalkan pesanan dan menunggu anda.",
        "JomCall sesuai jika pemanggil mahukan jawapan semasa panggilan: waktu buka, harga, slot yang kosong. Ia bercakap dengan mereka, merekodkan tempahan dalam JomCall dan mengambil pesanan untuk pasukan anda.",
      ],
    },
    table: {
      heading: "Perbandingan terus",
      lead: "Apa yang berlaku kepada pemanggil dengan setiap satu.",
      rows: [
        { topic: "Siapa yang angkat", them: "Ucapan anda, kemudian bunyi bip. Pemanggil bercakap dengan peti mel.", us: "answers" },
        { topic: "Soalan tentang waktu buka dan harga", them: "Pemanggil menunggu sehingga anda telefon semula.", us: "questions" },
        { topic: "Menempah lawatan", them: "Anda telefon semula untuk menetapkan masa.", us: "bookings" },
        { topic: "Mengambil pesanan", them: "Ya. Anda dengar setiap satu kemudian.", us: "messages" },
        { topic: "Bercakap dengan orang", them: "Tidak semasa panggilan.", us: "transfer" },
        { topic: "Bahasa", them: "Ucapan anda dalam bahasa yang anda pilih semasa menetapkannya.", us: "languages" },
        { topic: "Nombor anda", them: "Biasanya sebahagian daripada talian telefon anda.", us: "number" },
        { topic: "Kos", them: "Selalunya termasuk dalam talian anda. Tanya pembekal anda.", us: "price" },
      ],
    },
    better: {
      heading: "Bila setiap satu lebih sesuai",
      them: {
        name: "Mel suara lebih sesuai apabila",
        points: [
          "Tidak banyak panggilan masuk, dan pemanggil tidak kisah menunggu anda telefon semula.",
          "Setiap panggilan perlukan anda sendiri, contohnya sebut harga yang hanya anda boleh beri.",
          "Anda tidak mahu membayar yuran bulanan untuk khidmat menjawab panggilan.",
        ],
      },
      us: {
        name: "JomCall lebih sesuai apabila",
        points: [
          "Pemanggil selalu bertanya soalan yang sama tentang waktu buka, harga dan arah jalan.",
          "Pemanggil mahu membuat tempahan semasa masih dalam talian.",
          "Pemanggil anda lebih suka tidak meninggalkan pesanan.",
          "Pemanggil bercakap BM, bahasa Inggeris, Manglish atau Mandarin dan mahukan balasan dalam bahasa mereka.",
        ],
      },
    },
    faqs: [
      {
        q: "Adakah JomCall menggantikan mel suara saya?",
        a: "Hanya bagi panggilan yang anda majukan kepadanya. Jika anda majukan panggilan yang tidak dijawab ke nombor JomCall, ejen menjawabnya dan bukan peti mel, sehingga bilangan panggilan yang boleh diterimanya pada satu masa; selepas itu, pemanggil diberitahu talian sibuk. Anda boleh hentikan pemajuan bila-bila masa dengan kod henti.",
      },
      {
        q: "Bagaimana pesanan sampai kepada saya?",
        a: "Ejen mengambil nama, nombor dan sebab pemanggil menelefon, kemudian menyimpannya sebagai pesanan untuk pasukan anda dalam JomCall.",
      },
      {
        q: "Berapa kos JomCall berbanding mel suara?",
        a: `Mel suara selalunya datang bersama talian telefon anda. Pelan JomCall bermula pada ${fee} sebulan dengan satu nombor telefon dan ${minutes} minit, dibayar daripada dompet prabayar. Halaman Harga ada semua kadar.`,
      },
    ],
  },
  receptionist: {
    title: "JomCall berbanding penyambut tetamu: tugas masing-masing, dan kos anda sendiri",
    description:
      "Penyambut tetamu buat lebih banyak daripada menjawab telefon; JomCall hanya mengurus panggilan. Bila orang lebih sesuai, apa yang JomCall buat di telefon, dan kalkulator untuk meletakkan kos penyambut tetamu anda di sebelah harga JomCall.",
    h1: "JomCall atau penyambut tetamu?",
    lead: "Penyambut tetamu yang baik menyambut pelanggan yang datang, menjaga kaunter dan kenal pelanggan tetap anda. JomCall buat satu kerja sahaja: menjawab talian telefon anda. Ini perbandingan yang adil, dengan angka anda sendiri.",
    summary: "Apa yang orang di kaunter boleh buat tetapi JomCall tidak, dan sebaliknya.",
    them: "Penyambut tetamu",
    short: {
      heading: "Jawapan ringkas",
      body: [
        "Jika anda perlukan orang di kaunter depan, ambil pekerja. JomCall tidak dapat menyambut pelanggan yang datang, menerima bayaran di kaunter atau menyelesaikan aduan secara bersemuka.",
        "Jika masalahnya telefon berdering semasa semua orang sibuk, atau panggilan selepas waktu tutup, JomCall menjawab di nombor JomCall anda, siang dan malam, pada harga yang boleh anda lihat di halaman Harga.",
      ],
    },
    table: {
      heading: "Perbandingan terus",
      lead: "Apa yang setiap satu uruskan pada hari kerja biasa.",
      rows: [
        { topic: "Waktu", them: "Waktu kerja mereka, kecuali anda aturkan pengganti.", us: "answers" },
        { topic: "Pelanggan yang datang ke kedai", them: "Ya, di kaunter.", us: "phoneOnly" },
        { topic: "Bahasa", them: "Bahasa yang mereka tahu.", us: "languages" },
        { topic: "Soalan", them: "Daripada apa yang mereka tahu dan ingat.", us: "questions" },
        { topic: "Tempahan", them: "Dalam buku atau sistem anda, secara manual.", us: "bookings" },
        { topic: "Permintaan luar biasa", them: "Orang boleh membuat keputusan di situ juga.", us: "messages" },
        { topic: "Menyambungkan panggilan", them: "Kepada sesiapa, bila mereka rasa sesuai.", us: "transfer" },
        { topic: "Kos", them: "Gaji dan kos lain. Taip angka anda sendiri dalam kalkulator di bawah.", us: "price" },
      ],
    },
    better: {
      heading: "Bila setiap satu lebih sesuai",
      them: {
        name: "Penyambut tetamu lebih sesuai apabila",
        points: [
          "Pelanggan datang ke kedai dan perlukan orang di kaunter.",
          "Panggilan perlukan pertimbangan, seperti aduan atau harga yang dirunding satu demi satu.",
          "Ramai orang menelefon pada masa yang sama. JomCall menerima bilangan panggilan yang terhad pada satu masa; apabila taliannya penuh, pemanggil seterusnya diberitahu talian sibuk.",
        ],
      },
      us: {
        name: "JomCall lebih sesuai apabila",
        points: [
          "Telefon berdering semasa tangan anda sibuk melayan pelanggan.",
          "Panggilan masuk selepas waktu tutup atau pada cuti umum.",
          "Pemanggil bercakap BM, bahasa Inggeris, Manglish atau Mandarin, dan anda mahu setiap seorang dijawab dalam bahasa mereka.",
          "Anda lebih suka membayar ikut pelan dan minit daripada dompet prabayar berbanding menambah gaji.",
        ],
      },
    },
    faqs: [
      {
        q: "Adakah JomCall menggantikan penyambut tetamu saya?",
        a: "Ia menjawab telefon. Ia tidak menyambut pelanggan yang datang atau menjaga kaunter. Anda boleh majukan hanya panggilan yang tiada siapa angkat, jadi staf anda tetap menjawab dahulu.",
      },
      {
        q: "Apa jadi apabila pemanggil perlu bercakap dengan orang?",
        a: "Dalam waktu operasi, ejen menyambungkan pemanggil kepada staf anda. Di luar waktu operasi, ia mengambil pesanan untuk pasukan anda.",
      },
      {
        q: "Kenapa tiada angka gaji di halaman ini?",
        a: "Gaji berbeza ikut bandar, waktu kerja dan jawatan, jadi kalkulator ini mengambil angka anda sendiri dan tidak meneka.",
      },
    ],
  },
  "answering-service": {
    title: "JomCall berbanding khidmat jawab panggilan",
    description:
      "Khidmat jawab panggilan menggunakan orang untuk menjawab panggilan anda; JomCall menggunakan AI yang disediakan daripada fakta dan senarai harga anda sendiri. Siapa yang bercakap, apa yang mereka tahu, cara menyediakannya dan bila khidmat manusia lebih sesuai.",
    h1: "JomCall atau khidmat jawab panggilan?",
    lead: "Khidmat jawab panggilan menggunakan orang yang terlatih untuk menjawab panggilan anda. JomCall menggunakan AI yang disediakan daripada fakta dan senarai harga anda sendiri. Kedua-duanya angkat panggilan; bezanya pada siapa yang bercakap, apa yang mereka tahu dan cara anda membayar.",
    summary: "Orang yang membaca nota anda, atau AI yang disediakan daripada fakta anda sendiri.",
    them: "Khidmat jawab panggilan",
    short: {
      heading: "Jawapan ringkas",
      body: [
        "Pilih khidmat jawab panggilan jika pemanggil mesti bercakap dengan orang, atau panggilan perlukan pertimbangan yang tidak muat dalam nota.",
        "Pilih JomCall jika pemanggil kebanyakannya bertanya tentang waktu buka, harga dan slot kosong, mahu membuat tempahan semasa panggilan, atau bercakap BM, bahasa Inggeris, Manglish atau Mandarin, dan anda mahu menyediakannya sendiri.",
      ],
    },
    table: {
      heading: "Perbandingan terus",
      lead: "Cara setiap satu mengurus panggilan untuk perniagaan anda.",
      rows: [
        { topic: "Siapa yang bercakap", them: "Orang, selalunya berpandukan nota yang anda beri.", us: "answers" },
        { topic: "Apa yang mereka tahu", them: "Nota dan skrip yang anda hantar.", us: "questions" },
        { topic: "Bahasa", them: "Bergantung pada staf yang bertugas.", us: "languages" },
        { topic: "Tempahan", them: "Bergantung pada khidmat itu. Ada yang menempah, ada yang menyampaikan pesanan.", us: "bookings" },
        { topic: "Pesanan", them: "Biasanya disampaikan kepada anda melalui e-mel atau SMS.", us: "messages" },
        { topic: "Menyambungkan panggilan kepada anda", them: "Bergantung pada khidmat itu.", us: "transfer" },
        { topic: "Menyediakannya", them: "Biasanya diaturkan dengan pihak khidmat.", us: "setup" },
        { topic: "Harga", them: "Ditetapkan oleh setiap khidmat.", us: "price" },
        { topic: "Nombor anda", them: "Biasanya anda majukan panggilan kepada mereka.", us: "number" },
      ],
    },
    better: {
      heading: "Bila setiap satu lebih sesuai",
      them: {
        name: "Khidmat jawab panggilan lebih sesuai apabila",
        points: [
          "Pemanggil mahukan suara manusia dan tiada pilihan lain.",
          "Panggilan perlukan perhatian atau pertimbangan yang tidak muat dalam nota.",
          "Ramai orang menelefon serentak. Khidmat yang ada beberapa staf boleh menerima banyak panggilan sekali gus; JomCall menerima bilangan yang terhad pada satu masa, dan pemanggil seterusnya diberitahu talian sibuk.",
        ],
      },
      us: {
        name: "JomCall lebih sesuai apabila",
        points: [
          "Anda mahu menyediakannya sendiri: pilih jenis perniagaan, jawab beberapa soalan atau bawa senarai harga, kemudian uji dalam pelayar.",
          "Anda mahu jawapan daripada fakta dan senarai harga anda sendiri.",
          "Anda mahu satu ejen yang memahami BM, bahasa Inggeris, Manglish dan Mandarin, tidak kira siapa yang bertugas.",
          `Anda mahu melihat harga sebelum bermula: pelan daripada ${fee} sebulan.`,
        ],
      },
    },
    faqs: [
      {
        q: "Adakah pemanggil tahu mereka bercakap dengan AI?",
        a: "Ya. Ejen memberitahu bahawa ia AI pada awal panggilan, dan ejen tidak boleh diterbitkan tanpa pengenalan itu.",
      },
      {
        q: "Bolehkah saya menguji JomCall sebelum memajukan nombor saya?",
        a: "Boleh. Anda menguji ejen dalam pelayar sebelum menerbitkannya, dan sebelum ada panggilan sebenar sampai kepadanya.",
      },
      {
        q: "Bagaimana hendak beralih daripada khidmat jawab panggilan?",
        a: "Majukan nombor perniagaan anda ke nombor JomCall anda, bukan lagi kepada khidmat itu. Kod dan langkahnya ada di halaman pemajuan panggilan.",
      },
    ],
  },
  "whatsapp-bot": {
    title: "JomCall berbanding bot WhatsApp: panggilan dan sembang",
    description:
      "Bot WhatsApp membalas sembang; JomCall menjawab panggilan telefon. Ejen WhatsApp JomCall sendiri sedang menunggu kelulusan Meta. Pelanggan mana yang dilayan oleh setiap satu, dan bila bot sembang lebih sesuai.",
    h1: "JomCall atau bot WhatsApp?",
    lead: "Bot WhatsApp membalas sembang. JomCall menjawab panggilan telefon. Kedua-duanya melayan pelanggan yang berbeza: yang menaip, dan yang menelefon.",
    summary: "Pelanggan yang menaip, dan pelanggan yang menelefon. Ejen WhatsApp JomCall sedang menunggu kelulusan Meta.",
    them: "Bot WhatsApp",
    short: {
      heading: "Jawapan ringkas",
      body: [
        "Jika kebanyakan pelanggan menghantar mesej kepada anda, bot WhatsApp mengurus sembang sekarang dan JomCall tidak.",
        "Jika pelanggan masih menelefon nombor anda, bot sembang tidak dapat mengangkat panggilan. JomCall menjawab panggilan dalam bahasa pemanggil, membuat tempahan dan mengambil pesanan.",
      ],
    },
    table: {
      heading: "Perbandingan terus",
      lead: "Di mana setiap satu bertemu pelanggan anda.",
      rows: [
        { topic: "Tempat pelanggan menghubunginya", them: "Dalam sembang WhatsApp.", us: "answers" },
        { topic: "Sembang di WhatsApp", them: "Ya, memang itu tujuannya.", us: "whatsapp" },
        { topic: "Bahasa lisan", them: "Ia membalas dalam bentuk teks.", us: "languages" },
        { topic: "Soalan", them: "Daripada balasan yang anda tetapkan dalam bot.", us: "questions" },
        { topic: "Tempahan", them: "Bergantung pada bot itu.", us: "bookings" },
        { topic: "Bercakap dengan orang", them: "Memindahkan sembang kepada pasukan anda, jika bot itu menyokongnya.", us: "transfer" },
        { topic: "Nombor anda", them: "Menggunakan nombor WhatsApp Business.", us: "number" },
      ],
    },
    better: {
      heading: "Bila setiap satu lebih sesuai",
      them: {
        name: "Bot WhatsApp lebih sesuai apabila",
        points: [
          "Pelanggan anda lebih kerap menghantar mesej daripada menelefon.",
          "Pelanggan menghantar gambar, lokasi atau dokumen.",
          "Anda mahu setiap perbualan bertulis, dalam sembang.",
        ],
      },
      us: {
        name: "JomCall lebih sesuai apabila",
        points: [
          "Pelanggan masih menelefon nombor anda, atau menelefon apabila ada hal segera.",
          "Pemanggil perlukan jawapan di telefon: waktu buka, harga, slot yang kosong.",
          "Anda mahu lawatan ditempah dalam JomCall semasa pemanggil masih dalam talian.",
        ],
      },
    },
    faqs: [
      {
        q: "Bagaimana dengan JomCall di WhatsApp?",
        a: "WhatsApp sedang menunggu kelulusan Meta. Selagi Meta belum meluluskan JomCall, perniagaan tidak boleh menyambungkan nombor WhatsApp mereka. Panggilan telefon tidak perlu menunggu kelulusan ini.",
      },
      {
        q: "Bolehkah saya guna bot WhatsApp dan JomCall bersama?",
        a: "Boleh. Kedua-duanya meliputi saluran yang berbeza: bot mengurus sembang, dan JomCall menerima panggilan telefon.",
      },
      {
        q: "Adakah pemanggil tahu mereka bercakap dengan AI?",
        a: "Ya. Ejen memberitahu bahawa ia AI pada awal panggilan, dan ejen tidak boleh diterbitkan tanpa pengenalan itu.",
      },
    ],
  },
};

export const compare: Bilingual<Record<CompareSlug, CompareCopy>> = { en, ms };

export type CompareIndexCopy = { page: PageCopy; heading: string; note: string };

export const compareIndex: Bilingual<CompareIndexCopy> = {
  en: {
    page: {
      title: "Compare JomCall with other ways to handle calls",
      description:
        "Fair comparisons of JomCall with voicemail, a receptionist, an answering service and a WhatsApp bot. Each page says when the other option is the better choice.",
      h1: "Compare JomCall",
      lead: "Fair comparisons with the other ways to handle your calls. Each page says plainly when the other option is the better choice.",
    },
    heading: "Comparisons",
    note: "These pages compare kinds of option, not named products. JomCall's side uses only what JomCall does today.",
  },
  ms: {
    page: {
      title: "Bandingkan JomCall dengan cara lain mengurus panggilan",
      description:
        "Perbandingan yang adil antara JomCall dengan mel suara, penyambut tetamu, bot WhatsApp dan khidmat jawab panggilan. Setiap halaman menyatakan bila pilihan lain lebih sesuai.",
      h1: "Bandingkan JomCall",
      lead: "Perbandingan yang adil dengan cara lain untuk mengurus panggilan anda. Setiap halaman menyatakan dengan jelas bila pilihan lain lebih sesuai.",
    },
    heading: "Perbandingan",
    note: "Halaman ini membandingkan jenis pilihan, bukan produk yang dinamakan. Bahagian JomCall hanya menyebut apa yang JomCall buat sekarang.",
  },
};
