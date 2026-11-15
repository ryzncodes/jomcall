import { ZodError } from "zod";
import { CoreError, ProxyError } from "../../lib/core/client";

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
      code.replaceAll("_", " "),
      code.replaceAll("_", " "),
    ]
  );
}
