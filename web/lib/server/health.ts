import "server-only";
import { appConfig, mode } from "./config.ts";
import { database } from "./services.ts";
// Cheap health check: the mode, and in local or hosted mode one database round
// trip. The body never carries a setting, a host name or an error message;
// `npm run hosted:readiness` names what is missing, on the operator's side.

// A pooled connection can be dead before the pool notices: on Vercel a frozen
// function handles no socket close, so a connection the database pooler
// dropped meanwhile (seen right after `hosted:migrate` resets the role
// passwords) fails the first query. The pool discards that client, so one
// retry on a connection-class error gets another connection. A server error
// or the timeout is not retried: an unreachable database still reports false.
function connectionLost(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code === "string")
    return (
      /^(08|57P0[123]$)/.test(code) ||
      ["ECONNRESET", "EPIPE", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"].includes(code)
    );
  return typeof message === "string" && /connection terminated/i.test(message);
}
async function probe() {
  await Promise.race([
    database().pool.query("select 1"),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("HEALTH_TIMEOUT")), 3000),
    ),
  ]);
}
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
    try {
      await probe();
    } catch (error) {
      if (!connectionLost(error)) throw error;
      await probe();
    }
    ok = true;
  } catch {
    console.error("HEALTH_CHECK_FAILED");
  }
  return Response.json(
    { ok, mode: current, database: ok },
    { status: ok ? 200 : 503, headers },
  );
}
