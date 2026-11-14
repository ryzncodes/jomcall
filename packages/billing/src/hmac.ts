import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-SHA256 as lowercase hex, the form Curlec uses for both the webhook
// signature and the checkout return signature.
export function hmacHex(key: string, message: string | Uint8Array): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

// Constant-time comparison of two hex digests. Anything that is not exactly
// 64 hex characters fails before any comparison.
export function sameDigest(
  expected: string,
  given: string | null | undefined,
): boolean {
  if (typeof given !== "string" || !/^[0-9a-fA-F]{64}$/.test(given))
    return false;
  const a = Buffer.from(expected.toLowerCase(), "utf8");
  const b = Buffer.from(given.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
