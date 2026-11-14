import "server-only";
import { AppError } from "../../../packages/contracts/src/index.ts";
import { paymentReadiness } from "../../../packages/billing/src/provider.ts";
import { paymentProvider } from "../../../packages/domain/src/billing.ts";
import { requireLocal } from "./config.ts";
import { database } from "./services.ts";
import { respond, failure } from "./http.ts";

// Provider callbacks. No session, cookie or CSRF token: the provider's
// signature is the only authority, checked before anything is read from the
// database. The body is capped at 16 KiB.
const limit = 16 * 1024;
async function readLimited(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new AppError("PAYLOAD_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new AppError("INVALID_CALLBACK", 400);
  }
}

export async function handleBillingWebhook(request: Request, name: string) {
  try {
    requireLocal();
    if (request.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED", 405);
    const ready = paymentReadiness();
    // An unconfigured or different provider gets the same answer as an unknown path.
    if (!ready.configured || ready.provider !== name) throw new AppError("NOT_FOUND", 404);
    const body = await readLimited(request);
    const provider = paymentProvider();
    let result;
    try {
      result = provider.parseCallback(body, request.headers.get("content-type"));
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "BAD_SIGNATURE") throw new AppError("BAD_SIGNATURE", 401);
      throw new AppError("INVALID_CALLBACK", 400);
    }
    const outcome = (
      await database().pool.query(
        "select app_private.settle_topup($1,$2,$3,$4,$5,$6,$7,'callback') as value",
        [
          provider.name,
          result.providerRef,
          result.eventKey,
          result.paid,
          result.amountSen,
          result.currency,
          result.paidAt,
        ],
      )
    ).rows[0].value;
    // 200 for every verified callback, including mismatches held for review,
    // so the provider stops retrying. The outcome is not echoed back.
    void outcome;
    return respond({ received: true });
  } catch (e) {
    return failure(e);
  }
}
