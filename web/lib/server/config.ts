import "server-only";
import { AppError } from "../../../packages/contracts/src/index.ts";
export { parseMode } from "../../../packages/contracts/src/core.ts";
import { parseMode } from "../../../packages/contracts/src/core.ts";
export function mode() {
  return parseMode(process.env.JOMCALL_MODE);
}
export function requireLocal() {
  if (mode() !== "local") throw new AppError("CAPABILITY_UNAVAILABLE", 503);
}
export function localConfig() {
  requireLocal();
  const origin = process.env.LOCAL_ORIGIN!,
    url = process.env.SUPABASE_URL!;
  for (const value of [origin, url]) {
    const u = new URL(value);
    if (u.protocol !== "http:" || u.hostname !== "127.0.0.1")
      throw Error("LOCAL_ORIGIN_REQUIRED");
  }
  return { origin, url, anon: process.env.SUPABASE_ANON_KEY! };
}
