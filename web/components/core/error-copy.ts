// Wording for an error code that means something different on one screen.
// The shared table in state.tsx stays the default for every other case.
export type ErrorContext = "voice";

const overrides: Record<ErrorContext, Record<string, [string, string]>> = {
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

// Wording for a failure whose code names nothing in the shared table: a
// proxy's or CDN's error page (no code at all), or an app code no screen
// knows. Chosen by status, so a raw code is never shown.
const statusCopy: Record<string, [string, string]> = {
  REQUEST_BLOCKED: [
    "The request did not go through. Reload the page and try again.",
    "Permintaan tidak sampai. Muat semula halaman dan cuba lagi.",
  ],
  REQUEST_TOO_LARGE: [
    "This is too large to send. Make it smaller and try again.",
    "Ini terlalu besar untuk dihantar. Kecilkan dan cuba lagi.",
  ],
  TRY_LATER: [
    "Too many requests right now. Wait a minute and try again. Your input is preserved.",
    "Terlalu banyak permintaan sekarang. Tunggu seminit dan cuba lagi. Input anda dikekalkan.",
  ],
  SERVICE_ERROR: [
    "Something went wrong on our side. Try again shortly. Your input is preserved.",
    "Ada masalah di pihak kami. Cuba lagi sebentar. Input anda dikekalkan.",
  ],
  REQUEST_REFUSED: [
    "This request could not be completed. Try again, or reload the page.",
    "Permintaan ini tidak dapat diselesaikan. Cuba lagi, atau muat semula halaman.",
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

// The key of the wording for a failure by status. `proxy`: the answer was
// not JSON from the app; such a page keeps the old "connection interrupted"
// wording (OFFLINE) whenever a later try may pass, and otherwise never says
// the owner is signed out or the record is gone.
export function statusKey(status: number | null, proxy: boolean): string {
  if (proxy) {
    if (proxyRetryable(status)) return "OFFLINE";
    return status === 413 ? "REQUEST_TOO_LARGE" : "REQUEST_BLOCKED";
  }
  if (status === null) return "OFFLINE";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404 || status === 410) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 413) return "REQUEST_TOO_LARGE";
  if (status === 408) return "OFFLINE";
  if (status === 429) return "TRY_LATER";
  if (status >= 500) return "SERVICE_ERROR";
  return "REQUEST_REFUSED";
}

// [English, Bahasa Melayu] for a status key that the shared table lacks.
export const statusText = (key: string): [string, string] | undefined =>
  statusCopy[key];
