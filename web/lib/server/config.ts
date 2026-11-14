import "server-only";
import { AppError } from "../../../packages/contracts/src/index.ts";
export { parseMode } from "../../../packages/contracts/src/core.ts";
import { parseMode } from "../../../packages/contracts/src/core.ts";
import {
  appOrigin,
  cookieNames,
  isHosted,
  supabaseUrl,
} from "../../../packages/contracts/src/hosting.ts";
export function mode() {
  return parseMode(process.env.JOMCALL_MODE);
}
// The real application runs in `local` and `hosted` mode. Mock mode has no
// server-side records, and nothing here ever falls back to it.
export function requireApp() {
  if (mode() === "mock") throw new AppError("CAPABILITY_UNAVAILABLE", 503);
}
// Local mode: http on 127.0.0.1 only. Hosted mode: https on the configured
// origin only. A missing or wrong setting throws; it never picks a default.
export function appConfig() {
  requireApp();
  const origin = appOrigin(),
    url = supabaseUrl(),
    anon = process.env.SUPABASE_ANON_KEY;
  if (isHosted() && !anon)
    throw Error("SUPABASE_ANON_KEY_REQUIRED: SUPABASE_ANON_KEY");
  return {
    origin,
    url,
    anon: anon!,
    hosted: isHosted(),
    cookies: cookieNames(),
  };
}
