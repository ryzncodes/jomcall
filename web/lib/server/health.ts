import "server-only";
import { appConfig, mode } from "./config.ts";
import { database } from "./services.ts";
// Cheap health check: the mode, and in local or hosted mode one database round
// trip. The body never carries a setting, a host name or an error message;
// `npm run hosted:readiness` names what is missing, on the operator's side.
export async function handleHealth() {
  const headers = { "cache-control": "no-store" };
  let current: string;
  try {
    current = mode();
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
  if (current === "mock")
    return Response.json({ ok: true, mode: current }, { headers });
  let ok = false;
  try {
    appConfig();
    await Promise.race([
      database().pool.query("select 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("HEALTH_TIMEOUT")), 3000),
      ),
    ]);
    ok = true;
  } catch {
    console.error("HEALTH_CHECK_FAILED");
  }
  return Response.json(
    { ok, mode: current, database: ok },
    { status: ok ? 200 : 503, headers },
  );
}
