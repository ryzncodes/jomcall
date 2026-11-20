// The industries index and the six industry pages, in English and Bahasa
// Melayu (spec sections 3, 5 and 13). Each page: the calls this business
// gets and what JomCall does with each, a made-up sample call, how setup
// fits (the setup business type, word for word from the setup picker) and
// questions. Booking-led pages (clinics, salons) say plainly that the agent
// books; the car workshop page is about a message for the mechanic, because
// no job system is connected; restaurants take table requests as messages.
import { businessTypes } from "../../../packages/domain/src/setup/business-types.ts";
import type { Bilingual, FaqItem, PageCopy, SampleLine, Section } from "./types.ts";

export const INDUSTRY_SLUGS = [
  "clinics",
  "salons",
  "car-workshops",
  "aircond-home-repair",
  "restaurants",
  "tuition-centres",
] as const;
export type IndustrySlug = (typeof INDUSTRY_SLUGS)[number];

// The setup business type each page points to (packages/domain/src/setup).
export const SETUP_TYPE_IDS: Record<IndustrySlug, string> = {
  clinics: "clinic",
  salons: "hair-salon",
  "car-workshops": "car-workshop",
  "aircond-home-repair": "aircond-contractor",
  restaurants: "restaurant",
  "tuition-centres": "tuition-centre",
};

function setupType(slug: IndustrySlug, locale: "en" | "ms"): string {
  const type = businessTypes.find((t) => t.id === SETUP_TYPE_IDS[slug]);
  if (!type) throw Error(`UNKNOWN_SETUP_TYPE: ${slug}`);
  return type[locale];
}

export type CallRow = { call: string; does: string };

export type IndustryCopy = PageCopy & {
  // One line for the industries index.
  summary: string;
  calls: Section & { rows: CallRow[] };
  sampleBusiness: string;
  sample: SampleLine[];
  // What staff see afterwards, under the sample.
  sampleOutcome: string;
  setupType: string;
  setup: Section;
  faqs: FaqItem[];
};

// Labels shared by the six pages.
export type IndustryLabels = {
  callHead: string;
  doesHead: string;
  sampleHeading: string;
  setupLabel: string;
  setupLink: string;
  others: string;
};

export const industryLabels: Bilingual<IndustryLabels> = {
  en: {
    callHead: "The caller asks",
    doesHead: "What JomCall does",
    sampleHeading: "A sample call",
    setupLabel: "Business type in setup",
    setupLink: "How setup works",
    others: "Other industries",
  },
  ms: {
    callHead: "Pemanggil bertanya",
    doesHead: "Apa yang JomCall buat",
    sampleHeading: "Contoh panggilan",
    setupLabel: "Jenis perniagaan dalam persediaan",
    setupLink: "Cara persediaan berfungsi",
    others: "Industri lain",
  },
};

// ------------------------------------------------------------- English

const en: Record<IndustrySlug, IndustryCopy> = {
  clinics: {
    title: "AI receptionist for clinics in Malaysia",
    description:
      "JomCall answers your clinic's calls in BM, English, Manglish and Mandarin: opening hours, fees and directions, appointments booked with the time read back, and messages for your staff.",
    h1: "A receptionist for your clinic's phone.",
    lead: "Patients call to ask if you are open, what a visit costs and when they can come in. JomCall answers those calls in their language, books the appointment and leaves the rest for your staff.",
    summary: "Opening hours, fees, appointments and messages for the doctor.",
    calls: {
      heading: "The calls a clinic gets",
      body: ["Most calls to a clinic are the same few questions, and they often come while the counter is full."],
      rows: [
        { call: "Are you open now? Until what time?", does: "Answers from the opening hours you set." },
        { call: "How much is a consultation?", does: "Gives the fee from your price list. If a fee is not there, it says so and takes a message." },
        { call: "Can I see the doctor tomorrow morning?", does: "Finds a free time, reads it back to the caller and records the appointment in JomCall." },
        { call: "Where are you? Is there parking?", does: "Answers from your address and directions." },
        { call: "I have a question for the doctor.", does: "Takes a message with the caller's name, number and question. It does not give medical advice." },
        { call: "My father has chest pain.", does: "Tells the caller to call 999 or go to the nearest emergency department now." },
      ],
    },
    sampleBusiness: "Klinik Contoh",
    sample: [
      { who: "agent", text: "Good morning, Klinik Contoh. I'm the clinic's AI assistant. How can I help?" },
      { who: "caller", text: "Hi, can I see the doctor tomorrow morning? Just a general check-up." },
      { who: "agent", text: "Let me check tomorrow morning for you." },
      { who: "event", text: "Checked bookings: tomorrow, 10:00 am is free" },
      { who: "agent", text: "Tomorrow at 10 am is free. May I have your name, please?" },
      { who: "caller", text: "Aisyah Contoh." },
      { who: "agent", text: "Thank you. A check-up tomorrow at 10 am for Aisyah Contoh. Shall I book it?" },
      { who: "caller", text: "Yes, please." },
      { who: "event", text: "Booked into JomCall: tomorrow, 10:00 am" },
    ],
    sampleOutcome: "Your staff see the appointment in JomCall's bookings.",
    setupType: setupType("clinics", "en"),
    setup: {
      heading: "How setup fits a clinic",
      body: [
        "In setup, pick the business type below. The questions that follow ask about your services and fees, who patients can book with, and anything callers should be told.",
        "Or bring your fee list as a photo, PDF, CSV file or pasted text. You check each row before it goes in, then test the agent in your browser.",
      ],
    },
    faqs: [
      {
        q: "Does the agent give medical advice?",
        a: "No. It does not diagnose or suggest medicine. A question for the doctor becomes a message for your staff, and a caller who describes an emergency is told to call 999.",
      },
      {
        q: "Can patients move or cancel an appointment with the agent?",
        a: "Not yet. The agent takes a message so your staff can change or cancel the appointment.",
      },
      {
        q: "Can the agent pass a call to the counter?",
        a: "Yes, during opening hours. It passes the caller straight to your staff. Outside opening hours it takes a message.",
      },
      {
        q: "What health details does the agent note?",
        a: "Only what your staff need to handle the request, in the caller's own words. It does not ask about medical history, and calls are not recorded.",
      },
    ],
  },

  salons: {
    title: "AI receptionist for hair and beauty salons",
    description:
      "JomCall answers your salon's calls in BM, English, Manglish and Mandarin, books cuts, colour and treatments with the time read back, and answers prices and durations from your price list.",
    h1: "Bookings taken while your hands are busy.",
    lead: "The phone rings in the middle of a colour, a cut or a facial. JomCall picks up, answers the price question and books the slot, so you can stay with the customer in the chair.",
    summary: "Bookings for cuts, colour and treatments, with prices and durations.",
    calls: {
      heading: "The calls a salon gets",
      body: ["Salon calls are mostly about a time and a price. Both can be answered from what you set up."],
      rows: [
        { call: "Can I come in on Saturday for a cut?", does: "Finds a free time, reads it back to the caller and records the booking in JomCall." },
        { call: "How much is a colour for long hair?", does: "Gives the price from your price list, including any “from” price as you wrote it." },
        { call: "How long does a rebonding take?", does: "Answers from the duration in your price list." },
        { call: "Is Kak Mira working tomorrow?", does: "When you list your stylists in setup, it books with the one the caller asks for." },
        { call: "I need to change my appointment.", does: "Takes a message so your staff can move it." },
      ],
    },
    sampleBusiness: "Salun Contoh",
    sample: [
      { who: "agent", text: "Hello, Salun Contoh. I'm the salon's AI assistant. How can I help?" },
      { who: "caller", text: "Hi, I'd like a wash and cut with Kak Mira on Saturday afternoon." },
      { who: "event", text: "Checked bookings for Kak Mira: Saturday, 2:30 pm is free" },
      { who: "agent", text: "Kak Mira is free on Saturday at 2:30 pm. Would that work?" },
      { who: "caller", text: "Can. Book it under Mei Ling." },
      { who: "agent", text: "Let me confirm: a wash and cut with Kak Mira, Saturday at 2:30 pm, for Mei Ling. Is that right?" },
      { who: "caller", text: "Yes, correct." },
      { who: "event", text: "Booked into JomCall: Saturday, 2:30 pm, Kak Mira" },
    ],
    sampleOutcome: "The booking shows in JomCall under Kak Mira's name.",
    setupType: setupType("salons", "en"),
    setup: {
      heading: "How setup fits a salon",
      body: [
        "In setup, pick the business type below. The questions that follow ask about your services, prices and durations, and who customers can book with.",
        "If your price list is on a board or a printed card, take a photo of it. You check each price before it goes in.",
      ],
    },
    faqs: [
      {
        q: "Can the agent book with a particular stylist?",
        a: "Yes. When you list your stylists in setup, the agent books with the stylist the caller asks for, at a time that stylist is free.",
      },
      {
        q: "Can it take bookings at night?",
        a: "Yes. The agent answers day and night and books into the free times you have set, so a late-night caller can book for the next day.",
      },
      {
        q: "Does JomCall send booking reminders to customers?",
        a: "Not yet. The agent reads the time back during the call, and your staff see every booking in JomCall.",
      },
      {
        q: "Can customers move or cancel a booking with the agent?",
        a: "Not yet. The agent takes a message so your staff can move or cancel it.",
      },
    ],
  },

  "car-workshops": {
    title: "AI receptionist for car workshops",
    description:
      "JomCall answers your workshop's calls in BM, English, Manglish and Mandarin while the mechanics are under a car, answers simple questions from your facts and takes a clear message for the mechanic.",
    h1: "A clear message for the mechanic, every time the bay is busy.",
    lead: "When everyone is under a car, the phone rings out. JomCall answers, handles the simple questions from your facts, and leaves the mechanic a message with everything needed to call back.",
    summary: "Clear messages for the mechanic, and answers to the simple questions.",
    calls: {
      heading: "The calls a workshop gets",
      body: ["Many calls are customers checking on a car, and the answer is with the mechanic. The agent makes sure the mechanic gets the question."],
      rows: [
        { call: "Is my car ready?", does: "Takes a message with the caller's name, number and plate number, so the mechanic can call back. It does not look up job progress." },
        { call: "How much for a basic service on a Myvi?", does: "Gives the price from your price list. If the price depends on the car, it says so and takes a message." },
        { call: "Are you open on Sunday?", does: "Answers from the opening hours you set." },
        { call: "My car won't start. Can someone come?", does: "Takes the location and the problem as a message for the mechanic." },
        { call: "Can I talk to the foreman?", does: "During opening hours, passes the caller straight to your staff. Outside opening hours, takes a message." },
      ],
    },
    sampleBusiness: "Bengkel Contoh",
    sample: [
      { who: "agent", text: "Good morning, Bengkel Contoh. I'm the workshop's AI assistant. How can I help?" },
      { who: "caller", text: "Hi, I sent my Saga in yesterday for the brakes. Is it ready?" },
      { who: "agent", text: "I can't see the progress of the work, but I'll leave a message for the mechanic. What's the plate number?" },
      { who: "caller", text: "ABC 1234." },
      { who: "agent", text: "Thank you. Should the mechanic call you back on this number?" },
      { who: "caller", text: "Yes, this one." },
      { who: "event", text: "Message saved for the mechanic: Saga, brakes, ABC 1234, call back" },
    ],
    sampleOutcome: "The mechanic sees the message in JomCall and calls the customer back.",
    setupType: setupType("car-workshops", "en"),
    setup: {
      heading: "How setup fits a workshop",
      body: [
        "In setup, pick the business type below. The questions that follow ask what customers leave with you, how you find a job (plate number, phone number or job sheet) and what a message for the mechanic should include.",
        "Add the prices you are happy to quote by phone, such as a basic service, as a photo, PDF, CSV file or pasted text.",
      ],
    },
    faqs: [
      {
        q: "Can the agent tell customers if their car is ready?",
        a: "Not yet. JomCall has no link to your job list, so the agent takes a message with the plate number and your mechanic calls back.",
      },
      {
        q: "Can it give a repair quote?",
        a: "Only for prices you have listed, such as a basic service. For anything that needs someone to look at the car, it takes a message.",
      },
      {
        q: "What does a message for the mechanic include?",
        a: "The caller's name, number and what they need, plus the details you ask for in setup, such as the plate number and the car model.",
      },
      {
        q: "Can the agent pass a call to the foreman?",
        a: "Yes, during opening hours. It passes the caller straight to your staff. Outside opening hours it takes a message.",
      },
    ],
  },

  "aircond-home-repair": {
    title: "AI receptionist for aircond and home repair contractors",
    description:
      "JomCall answers calls for your aircond or home repair business in BM, English, Manglish and Mandarin: prices from your list, the areas you cover, visits booked when you set visit times, and job details as a message.",
    h1: "Every job request written down, even from the top of a ladder.",
    lead: "You are on a job when the next customer calls. JomCall answers, tells them what you charge and where you go, and writes down the job so you can call back with a time.",
    summary: "Job requests, the areas you cover, prices and service visits.",
    calls: {
      heading: "The calls a contractor gets",
      body: ["A contractor's calls are job requests. Each one needs the same details, and the agent asks for them."],
      rows: [
        { call: "My aircond is leaking water. Can someone come?", does: "Takes the address area, the number of units and the problem. If you set visit times, it books a visit into JomCall." },
        { call: "How much to service two units?", does: "Gives the price from your price list." },
        { call: "Do you cover Shah Alam?", does: "Answers from the areas you cover." },
        { call: "Can you install a new unit this week?", does: "Takes the details as a message, for you to quote and confirm." },
        { call: "Do you fix car aircond?", does: "Says politely that it is not a job you take, when you have listed it as one." },
      ],
    },
    sampleBusiness: "Servis Aircond Contoh",
    sample: [
      { who: "agent", text: "Hello, Servis Aircond Contoh. I'm the AI assistant. How can I help?" },
      { who: "caller", text: "Hi, my aircond in the bedroom is dripping water. Do you cover Kajang?" },
      { who: "agent", text: "Yes, Kajang is in our area. How many units need looking at?" },
      { who: "caller", text: "Just one. The other one is fine." },
      { who: "agent", text: "Noted: one unit dripping water, in Kajang. May I have your name?" },
      { who: "caller", text: "Kumar Contoh." },
      { who: "event", text: "Message saved: one unit leaking, Kajang, Kumar Contoh, call back" },
    ],
    sampleOutcome: "You see the job request in JomCall and call back with a time.",
    setupType: setupType("aircond-home-repair", "en"),
    setup: {
      heading: "How setup fits a contractor",
      body: [
        "In setup, pick the business type below. The questions that follow ask about the jobs you take and the ones you turn down, the areas you cover and what a job request should include.",
        "Bring your price list as a photo, PDF, CSV file or pasted text. You check each price before it goes in.",
      ],
    },
    faqs: [
      {
        q: "Can the agent give a price for a repair?",
        a: "It gives the prices on your list, such as a normal service. For a repair that needs a look first, it takes the details so you can quote.",
      },
      {
        q: "Can it book a service visit?",
        a: "Yes, when you set visit times. It finds a free time, reads it back to the caller and records the visit in JomCall. Otherwise it takes the job details as a message.",
      },
      {
        q: "Does it know which areas I cover?",
        a: "Yes. It answers from the areas you list in setup, and tells callers outside them that you do not go there.",
      },
      {
        q: "What happens with an urgent job at night?",
        a: "The agent takes the details as a message. It passes calls to your staff only during opening hours.",
      },
    ],
  },

  restaurants: {
    title: "AI receptionist for restaurants",
    description:
      "JomCall answers your restaurant's calls in BM, English, Manglish and Mandarin during the rush: opening hours, location, dishes and prices from your menu, and table requests taken as messages for your staff.",
    h1: "Answers for the phone that rings during the dinner rush.",
    lead: "Nobody can leave the kitchen or the floor at eight o'clock to explain where you are. JomCall answers the usual questions from your facts and menu, and writes down table requests for your staff.",
    summary: "Opening hours, location, menu questions and table requests.",
    calls: {
      heading: "The calls a restaurant gets",
      body: ["Most calls ask the same few things. The agent answers them from what you set up."],
      rows: [
        { call: "Are you open tonight? Until what time?", does: "Answers from the opening hours you set." },
        { call: "Where are you? Got parking?", does: "Answers from your address and directions." },
        { call: "Do you have vegetarian dishes?", does: "Answers from your menu and the facts you wrote. If it is not there, it says so and takes a message." },
        { call: "Can I get a table for six at eight?", does: "Takes the request as a message with the name, number, date, time and group size, for your staff to confirm." },
        { call: "Can I talk to the manager?", does: "During opening hours, passes the caller straight to your staff. Outside opening hours, takes a message." },
      ],
    },
    sampleBusiness: "Restoran Contoh",
    sample: [
      { who: "agent", text: "Good evening, Restoran Contoh. I'm the restaurant's AI assistant. How can I help?" },
      { who: "caller", text: "Hi, are you open tonight? And can I get a table for six at eight?" },
      { who: "agent", text: "We're open until 10:30 tonight. I'll pass your table request to the team. May I have your name?" },
      { who: "caller", text: "Jason Contoh." },
      { who: "agent", text: "Thank you, Jason. A table for six, tonight at eight. The team will call this number to confirm." },
      { who: "event", text: "Message saved: table for 6, tonight 8:00 pm, Jason Contoh, call to confirm" },
    ],
    sampleOutcome: "Your staff see the request in JomCall and call to confirm the table.",
    setupType: setupType("restaurants", "en"),
    setup: {
      heading: "How setup fits a restaurant",
      body: [
        "In setup, pick the business type below. The questions that follow ask about your opening hours, what callers can reserve and what a table request should include.",
        "Bring your menu as a photo, PDF, CSV file or pasted text, so the agent can answer questions about dishes and prices. You check each row before it goes in.",
      ],
    },
    faqs: [
      {
        q: "Can the agent take table bookings?",
        a: "It takes each table request as a message with the name, number, date, time and group size, so your staff can confirm it with the customer.",
      },
      {
        q: "Can it answer questions about the menu?",
        a: "Yes. It answers about dishes and prices from the menu you bring in setup. If something is not on it, it says so.",
      },
      {
        q: "Does it answer questions about halal status?",
        a: "Only from what you have written in your facts. If you have written nothing about it, the agent says it does not know and takes a message.",
      },
      {
        q: "Can the agent pass a call to the restaurant?",
        a: "Yes, during opening hours. It passes the caller straight to your staff. Outside opening hours it takes a message.",
      },
    ],
  },

  "tuition-centres": {
    title: "AI receptionist for tuition centres",
    description:
      "JomCall answers parents' calls to your tuition centre in BM, English, Manglish and Mandarin: fees and class times from your list, centre visits when you set visit times, and the parent's details as a message for your staff.",
    h1: "Parents' questions answered, even during class.",
    lead: "Parents call about fees, class times and places while you are teaching. JomCall answers from your fee list and timetable, and takes the parent's details for your staff to follow up.",
    summary: "Fees, class times, centre visits and messages from parents.",
    calls: {
      heading: "The calls a tuition centre gets",
      body: ["Most parents ask the same things before they sign up. The agent answers them and makes sure no parent is lost."],
      rows: [
        { call: "What are the fees for Form 4 Maths?", does: "Gives the fee from your list of classes." },
        { call: "Which days is the class?", does: "Answers from the class times you set." },
        { call: "Is there a place for my son?", does: "Takes the parent's details and the child's level for your staff. It does not promise a place." },
        { call: "Can we come and see the centre?", does: "If you set visit times, it books a visit into JomCall. Otherwise it takes a message." },
        { call: "Can I speak to the teacher?", does: "During opening hours, passes the caller straight to your staff. Outside opening hours, takes a message." },
      ],
    },
    sampleBusiness: "Pusat Tuisyen Contoh",
    sample: [
      { who: "agent", text: "Hello, Pusat Tuisyen Contoh. I'm the centre's AI assistant. How can I help?" },
      { who: "caller", text: "Hi, my daughter is in Form 4. Which days is the Maths class?" },
      { who: "agent", text: "Form 4 Maths is on Tuesday and Thursday, from 5 to 7 pm. Would you like the team to call you about a place?" },
      { who: "caller", text: "Yes, please. I'm Mrs Tan." },
      { who: "agent", text: "Thank you, Mrs Tan. I'll pass on that your daughter is in Form 4 and asked about Maths." },
      { who: "event", text: "Message saved: Form 4 Maths, Mrs Tan, call back about a place" },
    ],
    sampleOutcome: "Your staff see the parent's details in JomCall and call back.",
    setupType: setupType("tuition-centres", "en"),
    setup: {
      heading: "How setup fits a tuition centre",
      body: [
        "In setup, pick the business type below. The questions that follow ask about your classes and fees, the levels you teach and what your staff need to follow up with a parent.",
        "Bring your fee list or timetable as a photo, PDF, CSV file or pasted text. You check each row before it goes in.",
      ],
    },
    faqs: [
      {
        q: "Can the agent register a student?",
        a: "No. It takes the parent's details and what they asked about, so your staff can follow up and register the student.",
      },
      {
        q: "Can it tell parents whether a class is full?",
        a: "Not yet. Your staff confirm places. The agent takes the parent's details so nobody is missed.",
      },
      {
        q: "Can parents speak to it in Mandarin?",
        a: "Yes. The agent speaks BM, English, Manglish and Mandarin, and answers in the language the parent uses.",
      },
      {
        q: "Can it book a visit to the centre?",
        a: "Yes, when you set visit times. It finds a free time, reads it back and records the visit in JomCall.",
      },
    ],
  },
};

// ---------------------------------------------------------- Bahasa Melayu

const ms: Record<IndustrySlug, IndustryCopy> = {
  clinics: {
    title: "Penyambut tetamu AI untuk klinik di Malaysia",
    description:
      "JomCall menjawab panggilan klinik anda dalam BM, bahasa Inggeris, Manglish dan Mandarin: waktu operasi, caj dan arah lokasi, janji temu yang ditempah dengan masa diulang kepada pemanggil, dan pesanan untuk staf anda.",
    h1: "Penyambut tetamu untuk telefon klinik anda.",
    lead: "Pesakit menelefon untuk tanya sama ada klinik buka, berapa caj rawatan dan bila mereka boleh datang. JomCall menjawab dalam bahasa mereka, menempah janji temu dan meninggalkan yang selebihnya untuk staf anda.",
    summary: "Waktu operasi, caj, janji temu dan pesanan untuk doktor.",
    calls: {
      heading: "Panggilan yang klinik terima",
      body: ["Kebanyakan panggilan ke klinik ialah soalan yang sama, dan selalunya datang ketika kaunter sedang penuh."],
      rows: [
        { call: "Klinik buka sekarang? Sampai pukul berapa?", does: "Menjawab berdasarkan waktu operasi yang anda tetapkan." },
        { call: "Berapa caj jumpa doktor?", does: "Memberi caj daripada senarai harga anda. Kalau caj itu tiada, ia berterus terang dan mengambil pesanan." },
        { call: "Boleh jumpa doktor esok pagi?", does: "Mencari masa yang kosong, mengulang masa itu kepada pemanggil dan merekodkan janji temu dalam JomCall." },
        { call: "Klinik di mana? Ada parking?", does: "Menjawab berdasarkan alamat dan arah lokasi anda." },
        { call: "Saya ada soalan untuk doktor.", does: "Mengambil pesanan dengan nama, nombor dan soalan pemanggil. Ia tidak memberi nasihat perubatan." },
        { call: "Ayah saya sakit dada.", does: "Menyuruh pemanggil menelefon 999 atau pergi ke jabatan kecemasan yang terdekat dengan segera." },
      ],
    },
    sampleBusiness: "Klinik Contoh",
    sample: [
      { who: "agent", text: "Selamat pagi, Klinik Contoh. Saya pembantu AI klinik. Boleh saya bantu?" },
      { who: "caller", text: "Assalamualaikum. Boleh saya jumpa doktor esok pagi? Pemeriksaan biasa sahaja." },
      { who: "agent", text: "Boleh, saya semak esok pagi untuk puan." },
      { who: "event", text: "Semak tempahan: esok, 10:00 pagi kosong" },
      { who: "agent", text: "Esok pukul 10 pagi ada kosong. Boleh saya dapatkan nama puan?" },
      { who: "caller", text: "Aisyah Contoh." },
      { who: "agent", text: "Terima kasih. Pemeriksaan esok pukul 10 pagi untuk Aisyah Contoh. Saya tempahkan, ya?" },
      { who: "caller", text: "Ya, terima kasih." },
      { who: "event", text: "Ditempah dalam JomCall: esok, 10:00 pagi" },
    ],
    sampleOutcome: "Staf anda melihat janji temu itu dalam senarai tempahan JomCall.",
    setupType: setupType("clinics", "ms"),
    setup: {
      heading: "Persediaan untuk klinik",
      body: [
        "Dalam persediaan, pilih jenis perniagaan di bawah. Soalan seterusnya bertanya tentang perkhidmatan dan caj, dengan siapa pesakit boleh membuat temu janji, dan apa-apa yang perlu diberitahu kepada pemanggil.",
        "Atau bawa senarai caj anda sebagai foto, PDF, fail CSV atau teks yang ditampal. Anda semak setiap baris sebelum ia dimasukkan, kemudian uji ejen dalam pelayar.",
      ],
    },
    faqs: [
      {
        q: "Adakah ejen memberi nasihat perubatan?",
        a: "Tidak. Ia tidak membuat diagnosis atau mencadangkan ubat. Soalan untuk doktor menjadi pesanan untuk staf anda, dan pemanggil yang menceritakan kecemasan disuruh menelefon 999.",
      },
      {
        q: "Bolehkah pesakit menukar atau membatalkan janji temu melalui ejen?",
        a: "Belum lagi. Ejen mengambil pesanan supaya staf anda boleh menukar atau membatalkan janji temu itu.",
      },
      {
        q: "Bolehkah ejen menyerahkan panggilan ke kaunter?",
        a: "Boleh, dalam waktu operasi. Ia menyerahkan pemanggil terus kepada staf anda. Di luar waktu operasi, ia mengambil pesanan.",
      },
      {
        q: "Butiran kesihatan apa yang ejen catat?",
        a: "Hanya apa yang staf anda perlukan untuk mengurus permintaan itu, dalam perkataan pemanggil sendiri. Ia tidak bertanya tentang sejarah perubatan, dan panggilan tidak dirakam.",
      },
    ],
  },

  salons: {
    title: "Penyambut tetamu AI untuk salun rambut dan kecantikan",
    description:
      "JomCall menjawab panggilan salun anda dalam BM, bahasa Inggeris, Manglish dan Mandarin, menempah gunting, warna dan rawatan dengan masa diulang kepada pemanggil, dan menjawab soalan harga dan tempoh daripada senarai harga anda.",
    h1: "Tempahan diambil ketika tangan anda sibuk.",
    lead: "Telefon berbunyi semasa anda sedang mewarna, menggunting atau membuat rawatan muka. JomCall mengangkat, menjawab soalan harga dan menempah slot, jadi anda boleh terus melayan pelanggan di kerusi.",
    summary: "Tempahan gunting, warna dan rawatan, dengan harga dan tempoh.",
    calls: {
      heading: "Panggilan yang salun terima",
      body: ["Panggilan ke salun kebanyakannya tentang masa dan harga. Kedua-duanya boleh dijawab daripada apa yang anda sediakan."],
      rows: [
        { call: "Boleh datang hari Sabtu untuk gunting rambut?", does: "Mencari masa yang kosong, mengulang masa itu kepada pemanggil dan merekodkan tempahan dalam JomCall." },
        { call: "Berapa harga warna untuk rambut panjang?", does: "Memberi harga daripada senarai harga anda, termasuk harga “bermula dari” seperti yang anda tulis." },
        { call: "Rebonding ambil masa berapa lama?", does: "Menjawab berdasarkan tempoh dalam senarai harga anda." },
        { call: "Kak Mira kerja esok?", does: "Apabila anda senaraikan pendandan dalam persediaan, ia menempah dengan pendandan yang pemanggil minta." },
        { call: "Saya nak tukar masa temu janji.", does: "Mengambil pesanan supaya staf anda boleh mengubahnya." },
      ],
    },
    sampleBusiness: "Salun Contoh",
    sample: [
      { who: "agent", text: "Helo, Salun Contoh. Saya pembantu AI salun. Boleh saya bantu?" },
      { who: "caller", text: "Hai, saya nak cuci dan gunting dengan Kak Mira hari Sabtu petang." },
      { who: "event", text: "Semak tempahan Kak Mira: Sabtu, 2:30 petang kosong" },
      { who: "agent", text: "Kak Mira ada kosong hari Sabtu pukul 2:30 petang. Okey?" },
      { who: "caller", text: "Okey. Tempah atas nama Mei Ling." },
      { who: "agent", text: "Baik: cuci dan gunting dengan Kak Mira, Sabtu pukul 2:30 petang, atas nama Mei Ling. Betul?" },
      { who: "caller", text: "Ya, betul." },
      { who: "event", text: "Ditempah dalam JomCall: Sabtu, 2:30 petang, Kak Mira" },
    ],
    sampleOutcome: "Tempahan itu dipaparkan dalam JomCall di bawah nama Kak Mira.",
    setupType: setupType("salons", "ms"),
    setup: {
      heading: "Persediaan untuk salun",
      body: [
        "Dalam persediaan, pilih jenis perniagaan di bawah. Soalan seterusnya bertanya tentang perkhidmatan, harga dan tempoh, serta dengan siapa pelanggan boleh membuat tempahan.",
        "Kalau senarai harga anda ada pada papan atau kad bercetak, ambil gambarnya. Anda semak setiap harga sebelum ia dimasukkan.",
      ],
    },
    faqs: [
      {
        q: "Bolehkah ejen menempah dengan pendandan tertentu?",
        a: "Boleh. Apabila anda senaraikan pendandan dalam persediaan, ejen menempah dengan pendandan yang pemanggil minta, pada masa pendandan itu kosong.",
      },
      {
        q: "Bolehkah ia mengambil tempahan pada waktu malam?",
        a: "Boleh. Ejen menjawab siang dan malam dan menempah dalam masa kosong yang anda tetapkan, jadi pemanggil lewat malam boleh menempah untuk esok.",
      },
      {
        q: "Adakah JomCall menghantar peringatan tempahan kepada pelanggan?",
        a: "Belum lagi. Ejen mengulang masa tempahan semasa panggilan, dan staf anda boleh melihat setiap tempahan dalam JomCall.",
      },
      {
        q: "Bolehkah pelanggan menukar atau membatalkan tempahan melalui ejen?",
        a: "Belum lagi. Ejen mengambil pesanan supaya staf anda boleh menukar atau membatalkannya.",
      },
    ],
  },

  "car-workshops": {
    title: "Penyambut tetamu AI untuk bengkel kereta",
    description:
      "JomCall menjawab panggilan bengkel anda dalam BM, bahasa Inggeris, Manglish dan Mandarin ketika mekanik sedang di bawah kereta, menjawab soalan mudah daripada fakta anda dan mengambil pesanan yang jelas untuk mekanik.",
    h1: "Pesanan yang jelas untuk mekanik, setiap kali bengkel sibuk.",
    lead: "Apabila semua orang di bawah kereta, telefon tidak berjawab. JomCall menjawab, mengurus soalan mudah daripada fakta anda, dan meninggalkan pesanan untuk mekanik dengan semua butiran yang diperlukan untuk menelefon semula.",
    summary: "Pesanan yang jelas untuk mekanik, dan jawapan kepada soalan mudah.",
    calls: {
      heading: "Panggilan yang bengkel terima",
      body: ["Banyak panggilan ialah pelanggan yang bertanya tentang kereta mereka, dan jawapannya ada pada mekanik. Ejen memastikan soalan itu sampai kepada mekanik."],
      rows: [
        { call: "Kereta saya dah siap?", does: "Mengambil pesanan dengan nama, nombor telefon dan nombor plat pemanggil, supaya mekanik boleh menelefon semula. Ia tidak menyemak perkembangan kerja." },
        { call: "Berapa harga servis biasa untuk Myvi?", does: "Memberi harga daripada senarai harga anda. Kalau harga bergantung pada kereta, ia berterus terang dan mengambil pesanan." },
        { call: "Hari Ahad buka?", does: "Menjawab berdasarkan waktu operasi yang anda tetapkan." },
        { call: "Kereta saya tak boleh hidup. Boleh datang?", does: "Mengambil lokasi dan masalahnya sebagai pesanan untuk mekanik." },
        { call: "Boleh cakap dengan foreman?", does: "Dalam waktu operasi, menyerahkan pemanggil terus kepada staf anda. Di luar waktu operasi, mengambil pesanan." },
      ],
    },
    sampleBusiness: "Bengkel Contoh",
    sample: [
      { who: "agent", text: "Selamat pagi, Bengkel Contoh. Saya pembantu AI bengkel. Boleh saya bantu?" },
      { who: "caller", text: "Hai, semalam saya hantar Saga untuk baiki brek. Dah siap ke?" },
      { who: "agent", text: "Saya tak dapat lihat perkembangan kerja, tapi saya tinggalkan pesanan untuk mekanik. Nombor plat kereta?" },
      { who: "caller", text: "ABC 1234." },
      { who: "agent", text: "Terima kasih. Mekanik boleh telefon semula ke nombor ini?" },
      { who: "caller", text: "Ya, nombor ini." },
      { who: "event", text: "Pesanan untuk mekanik disimpan: Saga, brek, ABC 1234, telefon semula" },
    ],
    sampleOutcome: "Mekanik melihat pesanan itu dalam JomCall dan menelefon pelanggan semula.",
    setupType: setupType("car-workshops", "ms"),
    setup: {
      heading: "Persediaan untuk bengkel",
      body: [
        "Dalam persediaan, pilih jenis perniagaan di bawah. Soalan seterusnya bertanya apa yang pelanggan tinggalkan di bengkel, cara anda mencari sesuatu kerja (nombor plat, nombor telefon atau job sheet) dan apa yang perlu ada dalam pesanan untuk mekanik.",
        "Masukkan harga yang anda sanggup beri melalui telefon, seperti servis biasa, sebagai foto, PDF, fail CSV atau teks yang ditampal.",
      ],
    },
    faqs: [
      {
        q: "Bolehkah ejen memberitahu pelanggan sama ada kereta mereka sudah siap?",
        a: "Belum lagi. JomCall tidak bersambung dengan senarai kerja anda, jadi ejen mengambil pesanan dengan nombor plat dan mekanik anda menelefon semula.",
      },
      {
        q: "Bolehkah ia memberi sebut harga pembaikan?",
        a: "Hanya untuk harga yang anda senaraikan, seperti servis biasa. Untuk apa-apa yang perlu kereta itu diperiksa dahulu, ia mengambil pesanan.",
      },
      {
        q: "Apa yang ada dalam pesanan untuk mekanik?",
        a: "Nama, nombor telefon dan keperluan pemanggil, serta butiran yang anda minta dalam persediaan, seperti nombor plat dan model kereta.",
      },
      {
        q: "Bolehkah ejen menyerahkan panggilan kepada foreman?",
        a: "Boleh, dalam waktu operasi. Ia menyerahkan pemanggil terus kepada staf anda. Di luar waktu operasi, ia mengambil pesanan.",
      },
    ],
  },

  "aircond-home-repair": {
    title: "Penyambut tetamu AI untuk kontraktor aircond dan pembaikan rumah",
    description:
      "JomCall menjawab panggilan perniagaan aircond atau pembaikan rumah anda dalam BM, bahasa Inggeris, Manglish dan Mandarin: harga daripada senarai anda, kawasan yang anda liputi, lawatan yang ditempah apabila anda menetapkan masa lawatan, dan butiran kerja sebagai pesanan.",
    h1: "Setiap permintaan kerja dicatat, walaupun anda di atas tangga.",
    lead: "Anda sedang buat kerja apabila pelanggan seterusnya menelefon. JomCall menjawab, memberitahu caj dan kawasan anda, dan mencatat kerja itu supaya anda boleh menelefon semula untuk menetapkan masa.",
    summary: "Permintaan kerja, kawasan liputan, harga dan lawatan servis.",
    calls: {
      heading: "Panggilan yang kontraktor terima",
      body: ["Panggilan ke kontraktor ialah permintaan kerja. Setiap satu perlukan butiran yang sama, dan ejen akan bertanya."],
      rows: [
        { call: "Aircond saya bocor air. Boleh datang tengok?", does: "Mengambil kawasan alamat, bilangan unit dan masalahnya. Kalau anda tetapkan masa lawatan, ia menempah lawatan dalam JomCall." },
        { call: "Berapa harga servis dua unit?", does: "Memberi harga daripada senarai harga anda." },
        { call: "Ada cover Shah Alam?", does: "Menjawab berdasarkan kawasan yang anda liputi." },
        { call: "Boleh pasang unit baharu minggu ini?", does: "Mengambil butirannya sebagai pesanan, untuk anda beri sebut harga dan sahkan." },
        { call: "Boleh baiki aircond kereta?", does: "Memberitahu dengan sopan bahawa itu bukan kerja yang anda ambil, apabila anda sudah senaraikannya." },
      ],
    },
    sampleBusiness: "Servis Aircond Contoh",
    sample: [
      { who: "agent", text: "Helo, Servis Aircond Contoh. Saya pembantu AI. Boleh saya bantu?" },
      { who: "caller", text: "Hai, aircond bilik tidur saya menitis air. Ada cover Kajang?" },
      { who: "agent", text: "Ada, Kajang dalam kawasan kami. Berapa unit yang perlu diperiksa?" },
      { who: "caller", text: "Satu sahaja. Yang lain okey." },
      { who: "agent", text: "Baik: satu unit menitis air, di Kajang. Boleh saya dapatkan nama?" },
      { who: "caller", text: "Kumar Contoh." },
      { who: "event", text: "Pesanan disimpan: satu unit bocor, Kajang, Kumar Contoh, telefon semula" },
    ],
    sampleOutcome: "Anda melihat permintaan kerja itu dalam JomCall dan menelefon semula untuk menetapkan masa.",
    setupType: setupType("aircond-home-repair", "ms"),
    setup: {
      heading: "Persediaan untuk kontraktor",
      body: [
        "Dalam persediaan, pilih jenis perniagaan di bawah. Soalan seterusnya bertanya tentang kerja yang anda ambil dan yang anda tolak, kawasan yang anda liputi dan apa yang perlu ada dalam permintaan kerja.",
        "Bawa senarai harga anda sebagai foto, PDF, fail CSV atau teks yang ditampal. Anda semak setiap harga sebelum ia dimasukkan.",
      ],
    },
    faqs: [
      {
        q: "Bolehkah ejen memberi harga pembaikan?",
        a: "Ia memberi harga dalam senarai anda, seperti servis biasa. Untuk pembaikan yang perlu diperiksa dahulu, ia mengambil butirannya supaya anda boleh beri sebut harga.",
      },
      {
        q: "Bolehkah ia menempah lawatan servis?",
        a: "Boleh, apabila anda tetapkan masa lawatan. Ia mencari masa yang kosong, mengulang masa itu kepada pemanggil dan merekodkan lawatan dalam JomCall. Jika tidak, ia mengambil butiran kerja sebagai pesanan.",
      },
      {
        q: "Adakah ia tahu kawasan yang saya liputi?",
        a: "Ya. Ia menjawab berdasarkan kawasan yang anda senaraikan dalam persediaan, dan memberitahu pemanggil di luar kawasan itu bahawa anda tidak ke sana.",
      },
      {
        q: "Bagaimana dengan kerja kecemasan pada waktu malam?",
        a: "Ejen mengambil butirannya sebagai pesanan. Ia menyerahkan panggilan kepada staf anda hanya dalam waktu operasi.",
      },
    ],
  },

  restaurants: {
    title: "Penyambut tetamu AI untuk restoran",
    description:
      "JomCall menjawab panggilan restoran anda dalam BM, bahasa Inggeris, Manglish dan Mandarin ketika waktu puncak: waktu operasi, lokasi, hidangan dan harga daripada menu anda, dan permintaan meja diambil sebagai pesanan untuk staf.",
    h1: "Jawapan untuk telefon yang berbunyi ketika waktu makan malam.",
    lead: "Tiada siapa boleh tinggalkan dapur atau lantai pada pukul lapan malam untuk menerangkan lokasi restoran. JomCall menjawab soalan biasa daripada fakta dan menu anda, dan mencatat permintaan meja untuk staf.",
    summary: "Waktu operasi, lokasi, soalan menu dan permintaan meja.",
    calls: {
      heading: "Panggilan yang restoran terima",
      body: ["Kebanyakan panggilan bertanya perkara yang sama. Ejen menjawabnya daripada apa yang anda sediakan."],
      rows: [
        { call: "Malam ni buka? Sampai pukul berapa?", does: "Menjawab berdasarkan waktu operasi yang anda tetapkan." },
        { call: "Restoran di mana? Ada parking?", does: "Menjawab berdasarkan alamat dan arah lokasi anda." },
        { call: "Ada menu vegetarian?", does: "Menjawab daripada menu dan fakta yang anda tulis. Kalau tiada, ia berterus terang dan mengambil pesanan." },
        { call: "Boleh dapat meja untuk enam orang pukul lapan?", does: "Mengambil permintaan itu sebagai pesanan dengan nama, nombor, tarikh, masa dan bilangan orang, untuk staf anda sahkan." },
        { call: "Boleh cakap dengan pengurus?", does: "Dalam waktu operasi, menyerahkan pemanggil terus kepada staf anda. Di luar waktu operasi, mengambil pesanan." },
      ],
    },
    sampleBusiness: "Restoran Contoh",
    sample: [
      { who: "agent", text: "Selamat petang, Restoran Contoh. Saya pembantu AI restoran. Boleh saya bantu?" },
      { who: "caller", text: "Hai, malam ni buka tak? Saya nak meja untuk enam orang pukul lapan." },
      { who: "agent", text: "Kami buka sampai 10:30 malam ini. Saya sampaikan permintaan meja kepada pasukan kami. Boleh saya dapatkan nama?" },
      { who: "caller", text: "Jason Contoh." },
      { who: "agent", text: "Terima kasih, Jason. Meja untuk enam orang, malam ini pukul lapan. Pasukan kami akan telefon nombor ini untuk sahkan." },
      { who: "event", text: "Pesanan disimpan: meja 6 orang, malam ini 8:00, Jason Contoh, telefon untuk sahkan" },
    ],
    sampleOutcome: "Staf anda melihat permintaan itu dalam JomCall dan menelefon untuk mengesahkan meja.",
    setupType: setupType("restaurants", "ms"),
    setup: {
      heading: "Persediaan untuk restoran",
      body: [
        "Dalam persediaan, pilih jenis perniagaan di bawah. Soalan seterusnya bertanya tentang waktu operasi, apa yang pemanggil boleh tempah dan apa yang perlu ada dalam permintaan meja.",
        "Bawa menu anda sebagai foto, PDF, fail CSV atau teks yang ditampal, supaya ejen boleh menjawab soalan tentang hidangan dan harga. Anda semak setiap baris sebelum ia dimasukkan.",
      ],
    },
    faqs: [
      {
        q: "Bolehkah ejen mengambil tempahan meja?",
        a: "Ia mengambil setiap permintaan meja sebagai pesanan dengan nama, nombor, tarikh, masa dan bilangan orang, supaya staf anda boleh mengesahkannya dengan pelanggan.",
      },
      {
        q: "Bolehkah ia menjawab soalan tentang menu?",
        a: "Boleh. Ia menjawab tentang hidangan dan harga daripada menu yang anda bawa semasa persediaan. Kalau sesuatu tiada dalam menu, ia berterus terang.",
      },
      {
        q: "Adakah ia menjawab soalan tentang status halal?",
        a: "Hanya berdasarkan apa yang anda tulis dalam fakta. Kalau anda tidak menulis apa-apa tentangnya, ejen memberitahu bahawa ia tidak tahu dan mengambil pesanan.",
      },
      {
        q: "Bolehkah ejen menyerahkan panggilan kepada restoran?",
        a: "Boleh, dalam waktu operasi. Ia menyerahkan pemanggil terus kepada staf anda. Di luar waktu operasi, ia mengambil pesanan.",
      },
    ],
  },

  "tuition-centres": {
    title: "Penyambut tetamu AI untuk pusat tuisyen",
    description:
      "JomCall menjawab panggilan ibu bapa ke pusat tuisyen anda dalam BM, bahasa Inggeris, Manglish dan Mandarin: yuran dan waktu kelas daripada senarai anda, lawatan ke pusat apabila anda menetapkan masa lawatan, dan butiran ibu bapa sebagai pesanan untuk staf.",
    h1: "Soalan ibu bapa dijawab, walaupun semasa kelas.",
    lead: "Ibu bapa menelefon tentang yuran, waktu kelas dan tempat kosong ketika anda sedang mengajar. JomCall menjawab daripada senarai yuran dan jadual anda, dan mengambil butiran ibu bapa untuk staf membuat susulan.",
    summary: "Yuran, waktu kelas, lawatan ke pusat dan pesanan ibu bapa.",
    calls: {
      heading: "Panggilan yang pusat tuisyen terima",
      body: ["Kebanyakan ibu bapa bertanya perkara yang sama sebelum mendaftar. Ejen menjawabnya dan memastikan tiada ibu bapa yang tercicir."],
      rows: [
        { call: "Berapa yuran Matematik Tingkatan 4?", does: "Memberi yuran daripada senarai kelas anda." },
        { call: "Kelas hari apa?", does: "Menjawab berdasarkan waktu kelas yang anda tetapkan." },
        { call: "Ada tempat untuk anak lelaki saya?", does: "Mengambil butiran ibu bapa dan tahap anak untuk staf anda. Ia tidak menjanjikan tempat." },
        { call: "Boleh kami datang tengok pusat?", does: "Kalau anda tetapkan masa lawatan, ia menempah lawatan dalam JomCall. Jika tidak, ia mengambil pesanan." },
        { call: "Boleh saya cakap dengan cikgu?", does: "Dalam waktu operasi, menyerahkan pemanggil terus kepada staf anda. Di luar waktu operasi, mengambil pesanan." },
      ],
    },
    sampleBusiness: "Pusat Tuisyen Contoh",
    sample: [
      { who: "agent", text: "Helo, Pusat Tuisyen Contoh. Saya pembantu AI pusat ini. Boleh saya bantu?" },
      { who: "caller", text: "Hai, anak perempuan saya Tingkatan 4. Kelas Matematik hari apa?" },
      { who: "agent", text: "Matematik Tingkatan 4 pada hari Selasa dan Khamis, pukul 5 hingga 7 petang. Puan mahu pasukan kami telefon tentang tempat kosong?" },
      { who: "caller", text: "Ya, boleh. Saya Puan Tan." },
      { who: "agent", text: "Terima kasih, Puan Tan. Saya maklumkan bahawa anak puan Tingkatan 4 dan bertanya tentang Matematik." },
      { who: "event", text: "Pesanan disimpan: Matematik Tingkatan 4, Puan Tan, telefon semula tentang tempat" },
    ],
    sampleOutcome: "Staf anda melihat butiran ibu bapa itu dalam JomCall dan menelefon semula.",
    setupType: setupType("tuition-centres", "ms"),
    setup: {
      heading: "Persediaan untuk pusat tuisyen",
      body: [
        "Dalam persediaan, pilih jenis perniagaan di bawah. Soalan seterusnya bertanya tentang kelas dan yuran, tahap yang anda ajar dan apa yang staf perlukan untuk membuat susulan dengan ibu bapa.",
        "Bawa senarai yuran atau jadual anda sebagai foto, PDF, fail CSV atau teks yang ditampal. Anda semak setiap baris sebelum ia dimasukkan.",
      ],
    },
    faqs: [
      {
        q: "Bolehkah ejen mendaftarkan pelajar?",
        a: "Tidak. Ia mengambil butiran ibu bapa dan apa yang mereka tanya, supaya staf anda boleh membuat susulan dan mendaftarkan pelajar itu.",
      },
      {
        q: "Bolehkah ia memberitahu ibu bapa sama ada kelas sudah penuh?",
        a: "Belum lagi. Staf anda yang mengesahkan tempat. Ejen mengambil butiran ibu bapa supaya tiada sesiapa tercicir.",
      },
      {
        q: "Bolehkah ibu bapa bercakap dengannya dalam Mandarin?",
        a: "Boleh. Ejen bercakap dalam BM, bahasa Inggeris, Manglish dan Mandarin, dan menjawab dalam bahasa yang ibu bapa guna.",
      },
      {
        q: "Bolehkah ia menempah lawatan ke pusat?",
        a: "Boleh, apabila anda tetapkan masa lawatan. Ia mencari masa yang kosong, mengulang masa itu dan merekodkan lawatan dalam JomCall.",
      },
    ],
  },
};

export const industries: Bilingual<Record<IndustrySlug, IndustryCopy>> = { en, ms };

// --------------------------------------------------------- the index page

export type IndustriesIndexCopy = {
  page: PageCopy;
  heading: string;
  other: Section;
};

export const industriesIndex: Bilingual<IndustriesIndexCopy> = {
  en: {
    page: {
      title: "JomCall for your industry",
      description:
        "How JomCall handles the calls that clinics, salons, car workshops, aircond and home repair contractors, restaurants and tuition centres get.",
      h1: "Built around the calls your business gets.",
      lead: "Each kind of business gets its own kind of calls. Pick yours to see what callers ask, what the agent does with each call, and a made-up sample call.",
    },
    heading: "Six industries",
    other: {
      heading: "Something else?",
      body: [
        "Setup also has business types for parts shops, bakeries and caterers, homestays and halls, law and consulting firms, and laundry and repair shops.",
        "If none of them fits, pick “Something else” and describe your business in your own words.",
      ],
    },
  },
  ms: {
    page: {
      title: "JomCall untuk industri anda",
      description:
        "Cara JomCall mengurus panggilan yang diterima klinik, salun, bengkel kereta, kontraktor aircond dan pembaikan rumah, restoran dan pusat tuisyen.",
      h1: "Dibina untuk panggilan yang perniagaan anda terima.",
      lead: "Setiap jenis perniagaan menerima panggilan yang berbeza. Pilih perniagaan anda untuk melihat apa yang pemanggil tanya, apa yang ejen buat dengan setiap panggilan, dan satu contoh panggilan rekaan.",
    },
    heading: "Enam industri",
    other: {
      heading: "Perniagaan lain?",
      body: [
        "Persediaan juga ada jenis perniagaan untuk kedai alat ganti, kedai kek dan katering, homestay dan dewan, firma guaman dan perundingan, serta dobi dan kedai baiki.",
        "Kalau tiada yang sesuai, pilih “Lain-lain” dan terangkan perniagaan anda dengan perkataan sendiri.",
      ],
    },
  },
};
