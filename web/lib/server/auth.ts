import "server-only";
import {
  createClient,
  isAuthRetryableFetchError,
  type Session,
} from "@supabase/supabase-js";
import { z } from "zod";
import {
  AppError,
  type Identity,
} from "../../../packages/contracts/src/index.ts";
import { localConfig } from "./config.ts";
import { database } from "./services.ts";
import { cookie, setCookie, respond, failure, readBody } from "./http.ts";
import { issueCsrf, requireMutation } from "./csrf.ts";
export function authClient() {
  const c = localConfig();
  return createClient(c.url, c.anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
function checkAuthService(error: unknown) {
  if (
    isAuthRetryableFetchError(error) ||
    (error as { status?: number })?.status! >= 500
  )
    throw new AppError("AUTH_UNAVAILABLE", 503);
}
export async function verifyIdentity(request: Request): Promise<Identity> {
  const jwt = cookie(request, "ca_local_access");
  if (!jwt) throw new AppError("UNAUTHORIZED", 401);
  const auth = authClient();
  const claims = await auth.auth.getClaims(jwt);
  checkAuthService(claims.error);
  if (claims.error || !claims.data?.claims.session_id)
    throw new AppError("UNAUTHORIZED", 401);
  const user = await auth.auth.getUser(jwt);
  checkAuthService(user.error);
  if (
    user.error ||
    !user.data.user?.email_confirmed_at ||
    !user.data.user.email
  )
    throw new AppError("UNAUTHORIZED", 401);
  const identity = {
    userId: user.data.user.id,
    sessionId: String(claims.data.claims.session_id),
    confirmedEmail: user.data.user.email,
  };
  await database().withIdentity(identity, async () => true);
  return identity;
}
function sessionResponse(session: Session) {
  const response = respond({ authenticated: true });
  setCookie(
    response,
    "ca_local_access",
    session.access_token,
    session.expires_in,
  );
  setCookie(response, "ca_local_refresh", session.refresh_token, 604800);
  return response;
}
const credentials = z
  .object({ email: z.email().max(254), password: z.string().min(8).max(128) })
  .strict();
const rates = new Map<string, { count: number; until: number }>();
export async function handleAuth(request: Request) {
  try {
    const { origin } = localConfig();
    const action = new URL(request.url).pathname.split("/").at(-1)!;
    const auth = authClient();
    if (action === "csrf" && request.method === "GET") return issueCsrf();
    if (["confirm", "recovery"].includes(action) && request.method === "GET") {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((k) => !["token_hash"].includes(k)))
        throw new AppError("INVALID_CALLBACK", 422);
      const hash = z
        .string()
        .regex(/^[a-f0-9]{40,128}$/)
        .parse(url.searchParams.get("token_hash"));
      const result = await auth.auth.verifyOtp({
        token_hash: hash,
        type: action === "confirm" ? "signup" : "recovery",
      });
      checkAuthService(result.error);
      if (result.error || !result.data.session)
        throw new AppError("INVALID_LINK", 401);
      const response = sessionResponse(result.data.session);
      response.headers.set(
        "location",
        origin + (action === "recovery" ? "/forgot-password?reset=1" : "/app"),
      );
      return new Response(null, { status: 303, headers: response.headers });
    }
    if (request.method !== "POST")
      throw new AppError("METHOD_NOT_ALLOWED", 405);
    requireMutation(request);
    const body = await readBody(request, 16384);
    if (["login", "signup", "forgot-password"].includes(action)) {
      const now = Date.now();
      let rate = rates.get(action);
      if (!rate || now > rate.until) {
        rate = { count: 0, until: now + 60000 };
        rates.set(action, rate);
      }
      if (++rate.count > 10) throw new AppError("RATE_LIMITED", 429);
    }
    if (action === "signup") {
      const value = credentials.parse(body);
      const result = await auth.auth.signUp(value);
      checkAuthService(result.error);
      if (result.error) throw new AppError("SIGNUP_FAILED", 422);
      return respond({ confirmationRequired: true });
    }
    if (action === "login") {
      const result = await auth.auth.signInWithPassword(
        credentials.parse(body),
      );
      checkAuthService(result.error);
      if (result.error || !result.data.session)
        throw new AppError("INVALID_CREDENTIALS", 401);
      return sessionResponse(result.data.session);
    }
    if (action === "refresh") {
      z.object({}).strict().parse(body);
      const result = await auth.auth.refreshSession({
        refresh_token: cookie(request, "ca_local_refresh"),
      });
      checkAuthService(result.error);
      if (result.error || !result.data.session)
        throw new AppError("UNAUTHORIZED", 401);
      return sessionResponse(result.data.session);
    }
    if (action === "forgot-password") {
      const value = z
        .object({ email: z.email().max(254) })
        .strict()
        .parse(body);
      const result = await auth.auth.resetPasswordForEmail(value.email);
      checkAuthService(result.error);
      return respond({
        message:
          "If this account exists, a recovery email is available in the local inbox.",
      });
    }
    if (action === "logout") {
      z.object({}).strict().parse(body);
      await verifyIdentity(request);
      const result = await auth.auth.admin.signOut(
        cookie(request, "ca_local_access"),
        "global",
      );
      checkAuthService(result.error);
      if (result.error) throw new AppError("LOGOUT_FAILED", 503);
      const response = respond({ authenticated: false });
      setCookie(response, "ca_local_access", "", 0);
      setCookie(response, "ca_local_refresh", "", 0);
      return response;
    }
    if (action === "reset-password") {
      const value = z
        .object({ password: z.string().min(8).max(128) })
        .strict()
        .parse(body);
      await verifyIdentity(request);
      const session = await auth.auth.setSession({
        access_token: cookie(request, "ca_local_access"),
        refresh_token: cookie(request, "ca_local_refresh"),
      });
      checkAuthService(session.error);
      if (session.error) throw new AppError("UNAUTHORIZED", 401);
      const updated = await auth.auth.updateUser({ password: value.password });
      checkAuthService(updated.error);
      if (updated.error) throw new AppError("PASSWORD_UPDATE_FAILED", 422);
      const signedOut = await auth.auth.signOut({ scope: "global" });
      if (signedOut.error) throw new AppError("LOGOUT_FAILED", 503);
      const response = respond({ authenticated: false });
      setCookie(response, "ca_local_access", "", 0);
      setCookie(response, "ca_local_refresh", "", 0);
      return response;
    }
    throw new AppError("NOT_FOUND", 404);
  } catch (e) {
    return failure(e);
  }
}
