// Server-side Turnstile check (Cloudflare Siteverify, docs checked 2026-11-14):
// POST https://challenges.cloudflare.com/turnstile/v0/siteverify with secret,
// response and optional remoteip; JSON back with success, hostname, action and
// error-codes. Tokens are at most 2048 characters, valid for 300 s, single use.
//
// Every failure throws TURNSTILE_FAILED (the caller answers 403). A network
// error, a non-200 answer or a body that is not the expected JSON fails closed.
import type { TurnstileSettings } from "./hosting.ts";

export const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TOKEN_MAX = 2048;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function verifyTurnstile(
  settings: TurnstileSettings,
  input: { token: unknown; action: string; remoteip?: string },
  fetcher: Fetch = fetch,
): Promise<void> {
  const token = input.token;
  if (typeof token !== "string" || !token || token.length > TOKEN_MAX)
    throw Error("TURNSTILE_FAILED");
  const body = new URLSearchParams({
    secret: settings.secret,
    response: token,
  });
  if (input.remoteip && input.remoteip !== "unknown")
    body.set("remoteip", input.remoteip);
  let result: { success?: unknown; hostname?: unknown; action?: unknown };
  try {
    const response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Error();
    result = await response.json();
  } catch {
    throw Error("TURNSTILE_FAILED");
  }
  if (
    result?.success !== true ||
    result.hostname !== settings.hostname ||
    result.action !== input.action
  )
    throw Error("TURNSTILE_FAILED");
}
