// Phone-first launch (owner decision, 2026-11-20): the phone line is sold
// now; WhatsApp waits for Meta's App Review of the JomCall app, submitted
// that day. Until Meta approves, a business cannot connect its own number
// (Meta answers "can't onboard customers"), so the hosted app says so
// instead of offering a button that fails. Set this to false when Meta
// approves. A workspace that is already connected is never affected.
export const WHATSAPP_WAITING_FOR_META = true;

export const whatsappWaiting = {
  short: ["waiting for Meta's approval", "menunggu kelulusan Meta"],
  title: [
    "WhatsApp is waiting for Meta's approval",
    "WhatsApp sedang menunggu kelulusan Meta",
  ],
  body: [
    "Meta is reviewing JomCall before businesses can connect their WhatsApp numbers. This usually takes a few weeks. Nothing is needed from you, and your phone line works now. We will tell you when WhatsApp is ready.",
    "Meta sedang menyemak JomCall sebelum perniagaan boleh menyambungkan nombor WhatsApp mereka. Ini biasanya mengambil masa beberapa minggu. Tiada apa yang perlu anda lakukan, dan talian telefon anda sudah berfungsi. Kami akan maklumkan apabila WhatsApp sedia.",
  ],
} as const;

// Public copy for the hosted site once the phone line is sold (owner
// decision, 2026-11-20). The shared messages describe the mock preview
// ("fictional calls", "not a price offer"), which is true there and false
// on the hosted site, so the hosted site reads these instead. Each pair is
// English then Bahasa Melayu. "{fee}" and "{minutes}" are filled from the
// Starter plan in web/lib/pricing.ts.
export const launchCopy = {
  // Answers to the home page questions, by position; the others stand.
  faqA: {
    0: [
      "No. Keep the number your customers know and forward its calls to your JomCall number. The steps for mobile and office lines are in the app.",
      "Tidak. Kekalkan nombor yang pelanggan anda kenal dan majukan panggilannya ke nombor JomCall anda. Langkah untuk talian mudah alih dan pejabat ada dalam aplikasi.",
    ],
    2: [
      "The sample on this page uses recorded AI voices and a made-up business. Your JomCall number takes real phone calls: the AI introduces itself, answers in your customer's language and passes the caller to your team when needed.",
      "Contoh di halaman ini menggunakan suara AI yang dirakam dan perniagaan rekaan. Nombor JomCall anda menerima panggilan telefon sebenar: AI memperkenalkan diri, menjawab dalam bahasa pelanggan anda dan menyerahkan pemanggil kepada pasukan anda apabila perlu.",
    ],
    3: [
      "Plans start at {fee} a month with a phone number and {minutes} minutes. You pay in MYR from a prepaid wallet, and no card is charged automatically. See Pricing for every rate.",
      "Pelan bermula pada {fee} sebulan dengan satu nombor telefon dan {minutes} minit. Anda membayar dalam MYR daripada dompet prabayar, dan tiada kad dicaj secara automatik. Lihat Harga untuk semua kadar.",
    ],
  } as Record<number, readonly [string, string]>,
  seePricing: ["See pricing", "Lihat harga"],
  pricingIntro: [
    "Monthly plans on a prepaid wallet, or pay only for what you use.",
    "Pelan bulanan atas dompet prabayar, atau bayar hanya apa yang digunakan.",
  ],
  planButton: ["Get started", "Mula sekarang"],
  paygoBody: [
    "Top up when you need it and see every usage entry.",
    "Tambah nilai bila perlu dan lihat setiap rekod penggunaan.",
  ],
  walletLink: ["Open your wallet", "Buka dompet anda"],
  footer: [
    "Phone line ready · WhatsApp waiting for Meta's approval",
    "Talian telefon sedia · WhatsApp menunggu kelulusan Meta",
  ],
  badge: ["Early access", "Akses awal"],
} as const;
