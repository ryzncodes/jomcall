import { ZodError } from "zod";
import { CoreError, ProxyError } from "../../lib/core/client";

// Wording for an error code that means something different on one screen.
// The shared table in state.tsx stays the default for every other case.
export type ErrorContext = "voice" | "hours" | "invite";

const overrides: Record<ErrorContext, Record<string, [string, string]>> = {
  invite: {
    // Someone who opened an invitation link without being signed in never
    // had a session, so "Session ended" would be wrong.
    UNAUTHORIZED: [
      "Sign in or create an account with the invited email first, then accept the invitation.",
      "Log masuk atau cipta akaun dengan e-mel jemputan dahulu, kemudian terima jemputan.",
    ],
  },
  hours: {
    // The server does not say how many appointments are in the way.
    BOOKINGS_AFFECTED: [
      "Some appointments fall outside these hours. Move or cancel them under Bookings, then save again.",
      "Ada janji temu di luar waktu ini. Alihkan atau batalkannya di Tempahan, kemudian simpan semula.",
    ],
    CONFLICT: [
      "Someone else changed these hours. This shows the latest.",
      "Orang lain telah mengubah waktu ini. Ini yang terkini.",
    ],
  },
  voice: {
    // The same code refuses publishing an agent; here nothing is published.
    DISCLOSURE_REQUIRED: [
      "Add an AI introduction to the agent before starting a voice test.",
      "Tambah pengenalan AI pada ejen sebelum memulakan ujian suara.",
    ],
  },
};

// Returns [English, Bahasa Melayu], or undefined to use the shared wording.
export function contextCopy(
  code: string,
  context: ErrorContext | undefined,
): [string, string] | undefined {
  return context ? overrides[context][code] : undefined;
}

// Wording for a proxy's or CDN's error page (a body that is not JSON, so no
// code from the app) that a later try will not fix. Only such pages are
// worded by status; an app error keeps its own code.
const proxyCopy: Record<string, [string, string]> = {
  REQUEST_BLOCKED: [
    "The request did not go through. Reload the page and try again.",
    "Permintaan tidak berjaya dihantar. Muat semula halaman dan cuba lagi.",
  ],
  REQUEST_TOO_LARGE: [
    "This is too large to send. Make it smaller and try again.",
    "Ini terlalu besar untuk dihantar. Kurangkan saiznya dan cuba lagi.",
  ],
};

// A proxy's page that may pass on a later try (no status, a non-error
// status, a timeout, too many requests, a server error).
export const proxyRetryable = (status: number | null) =>
  status === null ||
  status < 400 ||
  status === 408 ||
  status === 429 ||
  status >= 500;

// The wording key for a proxy's page: the old "connection interrupted"
// wording (OFFLINE) whenever a later try may pass; otherwise never "signed
// out" or "record gone", which only the app itself may say.
export function proxyKey(status: number | null): string {
  if (proxyRetryable(status)) return "OFFLINE";
  return status === 413 ? "REQUEST_TOO_LARGE" : "REQUEST_BLOCKED";
}

// The key errorText looks up: an app error's own code, a proxy page's key
// by status, a validation error, or no answer at all.
export function errorKey(error: unknown): string {
  if (error instanceof CoreError) return error.code;
  if (error instanceof ProxyError) return proxyKey(error.status);
  if (error instanceof ZodError) return "VALIDATION_ERROR";
  return "OFFLINE";
}

// [English, Bahasa Melayu] for errorText: a screen's own wording, then the
// shared table, then (for a proxy's page only) the wording above. An app
// code no table names is shown as its words, exactly as before.
export function chooseCopy(
  error: unknown,
  code: string,
  table: Record<string, [string, string]>,
  context?: ErrorContext,
): [string, string] {
  return (
    contextCopy(code, context) ??
    table[code] ??
    (error instanceof ProxyError ? proxyCopy[code] : undefined) ?? [
      `Something went wrong. Try again. (${code})`,
      `Ada masalah. Cuba lagi. (${code})`,
    ]
  );
}

// Sentences for codes a person can meet that the shared table in state.tsx
// does not word. A guard test lists every code the server throws and fails
// when one a person can meet has no sentence here or there.
export const moreCopy: Record<string, [string, string]> = {
  INVALID_CREDENTIALS: [
    "That email or password is not right. Check them and try again.",
    "E-mel atau kata laluan itu tidak betul. Semak dan cuba lagi.",
  ],
  RATE_LIMITED: [
    "Too many tries. Wait a minute and try again.",
    "Terlalu banyak cubaan. Tunggu seminit dan cuba lagi.",
  ],
  SIGNUP_FAILED: [
    "We could not create the account. Check the email and password, then try again.",
    "Kami tidak dapat mencipta akaun. Semak e-mel dan kata laluan, kemudian cuba lagi.",
  ],
  PASSWORD_UPDATE_FAILED: [
    "The new password was not saved. Choose a different one and try again.",
    "Kata laluan baharu tidak disimpan. Pilih yang lain dan cuba lagi.",
  ],
  CSRF_REJECTED: [
    "This page is out of date. Reload it and try again.",
    "Halaman ini sudah lama. Muat semula dan cuba lagi.",
  ],
  INVALID_LINK: [
    "This link has expired or was already used. Ask for a new one.",
    "Pautan ini telah tamat tempoh atau sudah digunakan. Minta pautan baharu.",
  ],
  INVALID_CALLBACK: [
    "This sign-in link did not work. Try signing in again.",
    "Pautan log masuk ini tidak berfungsi. Cuba log masuk semula.",
  ],
  LOGOUT_FAILED: [
    "Signing out did not finish. Try again.",
    "Log keluar tidak selesai. Cuba lagi.",
  ],
  SIGNUP_NOT_AVAILABLE: [
    "Connecting WhatsApp is not available yet.",
    "Sambungan WhatsApp belum tersedia.",
  ],
  COEXISTENCE_OFF: [
    "Keeping the WhatsApp Business app on this number is not available yet.",
    "Mengekalkan aplikasi WhatsApp Business pada nombor ini belum tersedia.",
  ],
  WHATSAPP_NOT_CONFIGURED: [
    "WhatsApp is not available yet.",
    "WhatsApp belum tersedia.",
  ],
  WHATSAPP_NOT_CONNECTED: [
    "Connect WhatsApp first.",
    "Sambungkan WhatsApp dahulu.",
  ],
  TEST_TURN_LIMIT: [
    "This test has reached 20 messages. Start a new test.",
    "Ujian ini telah mencapai 20 mesej. Mulakan ujian baharu.",
  ],
  TEST_SESSION_LIMIT: [
    "Too many tests are open. Wait for older ones to end, then try again.",
    "Terlalu banyak ujian dibuka. Tunggu ujian lama tamat, kemudian cuba lagi.",
  ],
  VOICE_DISABLED: [
    "Voice tests are not available right now. Use a typed test.",
    "Ujian suara tidak tersedia buat masa ini. Gunakan ujian bertulis.",
  ],
  CONTACT_MISMATCH: [
    "This test belongs to a different contact. Start a new test.",
    "Ujian ini milik kenalan lain. Mulakan ujian baharu.",
  ],
  PROPOSAL_NOT_READY: [
    "The agent's answer is not finished yet. Wait for it, then try again.",
    "Jawapan ejen belum selesai. Tunggu, kemudian cuba lagi.",
  ],
  SUMMARY_NOT_READY: [
    "This summary is still being written. Try again in a minute.",
    "Ringkasan ini masih ditulis. Cuba lagi sebentar lagi.",
  ],
  NUMBER_IN_USE: [
    "This phone number is already in use.",
    "Nombor telefon ini sudah digunakan.",
  ],
  CONTACT_DELETION_PENDING: [
    "This contact is being deleted, so it cannot be booked.",
    "Kenalan ini sedang dipadam, jadi tidak boleh ditempah.",
  ],
  RESOURCE_LIMIT: [
    "This workspace has reached 100 bookable resources.",
    "Ruang kerja ini telah mencapai 100 sumber tempahan.",
  ],
  RESOURCE_INACTIVE: [
    "This resource is switched off. Choose another or switch it on.",
    "Sumber ini dimatikan. Pilih yang lain atau hidupkannya.",
  ],
  BOOKING_CANCELLED: [
    "This booking was cancelled, so it cannot be changed.",
    "Tempahan ini telah dibatalkan, jadi tidak boleh diubah.",
  ],
  BOOKING_TIMEZONE_UNSUPPORTED: [
    "Bookings need the schedule in Kuala Lumpur time.",
    "Tempahan memerlukan jadual dalam waktu Kuala Lumpur.",
  ],
  KNOWLEDGE_LIMIT: [
    "This is more than the agent can hold. Remove something first.",
    "Ini melebihi apa yang boleh disimpan oleh ejen. Buang sesuatu dahulu.",
  ],
  UNKNOWN_PACK: [
    "That business type is not recognised. Reload and choose again.",
    "Jenis perniagaan itu tidak dikenali. Muat semula dan pilih lagi.",
  ],
  DUPLICATE_PACK: [
    "That business type is already added.",
    "Jenis perniagaan itu sudah ditambah.",
  ],
  UNKNOWN_RULE: [
    "That rule no longer exists. Reload and try again.",
    "Peraturan itu tidak lagi wujud. Muat semula dan cuba lagi.",
  ],
  ITEM_INCOMPLETE: [
    "Fill in every part of this row before confirming.",
    "Lengkapkan setiap bahagian baris ini sebelum mengesahkan.",
  ],
  VALIDATION_FAILED: [
    "Check required fields and valid formats.",
    "Semak medan wajib dan format yang sah.",
  ],
  INVALID_PAYLOAD: [
    "Some details are missing or not in the right form. Check and try again.",
    "Sesetengah butiran tiada atau tidak dalam bentuk yang betul. Semak dan cuba lagi.",
  ],
  VALUE_TOO_LARGE: [
    "This answer is too long. Shorten it and try again.",
    "Jawapan ini terlalu panjang. Pendekkan dan cuba lagi.",
  ],
  PAYLOAD_TOO_LARGE: [
    "This is too large to send. Make it smaller and try again.",
    "Ini terlalu besar untuk dihantar. Kurangkan saiznya dan cuba lagi.",
  ],
  READER_OFF: [
    "Reading documents is not available right now. Answer the questions instead.",
    "Membaca dokumen tidak tersedia buat masa ini. Jawab soalan sebagai ganti.",
  ],
  NOT_READY: [
    "The export is not ready yet. Try again shortly.",
    "Eksport belum sedia. Cuba lagi sebentar lagi.",
  ],
  CONTACT_REQUIRED: [
    "This request has no contact, so it cannot be booked. Decline it, or add the booking under Bookings.",
    "Permintaan ini tiada kenalan, jadi tidak boleh ditempah. Tolak, atau tambah tempahan di Tempahan.",
  ],
  BOOKING_CONFIRM_REQUIRED: [
    "Confirm the booking, or decline it.",
    "Sahkan tempahan, atau tolaknya.",
  ],
  INVALID_STATE: [
    "This cannot be done to this item. Reload and try again.",
    "Ini tidak boleh dibuat pada item ini. Muat semula dan cuba lagi.",
  ],
  INVALID_ASSIGNEE: [
    "That person is no longer in this workspace. Choose someone else.",
    "Orang itu tiada lagi dalam ruang kerja ini. Pilih orang lain.",
  ],
};
