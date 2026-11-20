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
