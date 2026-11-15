// Pure rules the WhatsApp inbox screen relies on, kept apart so they can be
// tested without a browser.

// The server's limit on a staff reply, in UTF-8 bytes.
export const replyByteLimit = 4000;

export function utf8Bytes(text: string) {
  return new TextEncoder().encode(text).length;
}

// Shows the last four digits only. Country codes vary in length, so none is
// assumed.
export function maskedNumber(waId: string) {
  const d = waId.replace(/\D/g, "");
  return d.length > 4 ? `•••• ${d.slice(-4)}` : "••••";
}

// WhatsApp intake stores "+<wa_id>" as the name when the customer has no
// profile name. A name that is that, or only looks like a phone number, is
// treated as no name, so the full number never shows in the inbox.
export function looksLikeNumber(name: string, waId: string) {
  const n = name.trim();
  if (!n) return true;
  if (n === "+" + waId || n === waId) return true;
  return /^\+?[\d\s().-]{6,}$/.test(n);
}

export function displayName(name: string | null, waId: string) {
  return name && !looksLikeNumber(name, waId) ? name : maskedNumber(waId);
}

// Shortens by code points, so an emoji is never split in half.
export function snippet(text: string, max = 90) {
  const points = Array.from(text);
  return points.length > max ? points.slice(0, max).join("") + "…" : text;
}

// One staff reply attempt: the idempotency key and the exact request first
// sent with it. A retry resends this same request, so if the first one was
// stored the server replays its receipt instead of queuing a second message.
export type ReplyAttempt = {
  key: string;
  text: string;
  expectedRevision: number;
};

// The attempt to send for this draft: the pending one while the draft is
// unchanged, otherwise a new one on the current revision.
export function nextAttempt(
  pending: ReplyAttempt | null,
  draft: string,
  revision: number,
  newKey: () => string,
): ReplyAttempt {
  if (pending && pending.text === draft) return pending;
  return { key: newKey(), text: draft, expectedRevision: revision };
}

// Whether to keep the attempt after an error. A definite refusal from the
// server (a 4xx answer) stored nothing, so the next Send starts fresh on the
// latest revision. A lost or failed response may have been stored, so the
// same request is resent.
export function keepAttempt(error: unknown) {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : NaN;
  return !(status >= 400 && status < 500);
}
