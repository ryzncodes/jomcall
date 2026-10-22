import "server-only";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { cookie, respond, setCookie } from "./http.ts";
import { localConfig } from "./config.ts";
import { AppError } from "../../../packages/contracts/src/index.ts";
function token(challenge: string) {
  const secret = process.env.CSRF_SECRET;
  if (!secret || secret.length < 32) throw Error("CSRF_SECRET_REQUIRED");
  return createHmac("sha256", secret).update(challenge).digest("hex");
}
export function issueCsrf() {
  localConfig();
  const challenge = randomBytes(32).toString("hex");
  const response = respond({ token: token(challenge) });
  setCookie(response, "ca_local_csrf", challenge, 86400);
  return response;
}
export function requireMutation(request: Request) {
  const { origin } = localConfig();
  const challenge = cookie(request, "ca_local_csrf"),
    supplied = request.headers.get("x-csrf-token") ?? "";
  if (
    request.headers.get("origin") !== origin ||
    !/^[a-f0-9]{64}$/.test(challenge) ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(token(challenge)))
  )
    throw new AppError("CSRF_REJECTED", 403);
}
