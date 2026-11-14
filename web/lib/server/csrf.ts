import "server-only";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { cookie, respond, setCookie } from "./http.ts";
import { appConfig } from "./config.ts";
import { AppError } from "../../../packages/contracts/src/index.ts";
function token(challenge: string) {
  const secret = process.env.CSRF_SECRET;
  if (!secret || secret.length < 32) throw Error("CSRF_SECRET_REQUIRED");
  return createHmac("sha256", secret).update(challenge).digest("hex");
}
export function issueCsrf() {
  const { cookies } = appConfig();
  const challenge = randomBytes(32).toString("hex");
  const response = respond({ token: token(challenge) });
  setCookie(response, cookies.csrf, challenge, 86400);
  return response;
}
export function requireMutation(request: Request) {
  // Exactly one origin per environment: the configured one, never the
  // request's own Host header.
  const { origin, cookies } = appConfig();
  const challenge = cookie(request, cookies.csrf),
    supplied = request.headers.get("x-csrf-token") ?? "";
  if (
    request.headers.get("origin") !== origin ||
    !/^[a-f0-9]{64}$/.test(challenge) ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(token(challenge)))
  )
    throw new AppError("CSRF_REJECTED", 403);
}
