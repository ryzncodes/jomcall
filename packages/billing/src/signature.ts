import { createHmac, timingSafeEqual } from "node:crypto";

// Billplz "X Signature", as the worked examples in the API reference
// (https://support.billplz.com/api, read 2026-11-14) compute it:
// every field except x_signature becomes key+value with no separator, the
// strings are sorted ignoring case, joined with "|", and signed with
// HMAC-SHA256 using the X Signature key. Lowercase hex.
// The strings are sorted, not the keys: "paid_amount100" < "paid_at…" < "paidtrue".
export function signatureSource(fields: Iterable<[string, string]>) {
  const parts: string[] = [];
  for (const [key, value] of fields)
    if (key !== "x_signature") parts.push(key + value);
  const fold = (s: string) => s.toLowerCase();
  // Plain code-unit order; localeCompare would depend on the server's locale.
  parts.sort((a, b) => (fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : 0));
  return parts.join("|");
}

export function sign(fields: Iterable<[string, string]>, key: string) {
  return createHmac("sha256", key)
    .update(signatureSource(fields))
    .digest("hex");
}

export function verify(
  fields: Iterable<[string, string]>,
  signature: string | null | undefined,
  key: string,
) {
  if (!key || typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature))
    return false;
  const expected = Buffer.from(sign(fields, key), "hex"),
    given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
