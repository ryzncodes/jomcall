import "server-only";
import { AppError } from "../../../packages/contracts/src/index.ts";
import { paymentReadiness } from "../../../packages/billing/src/provider.ts";
import {
  settlePayment,
  settleRefund,
} from "../../../packages/billing/src/settle.ts";
import { paymentProvider } from "../../../packages/domain/src/billing.ts";
import { requireApp } from "./config.ts";
import { database } from "./services.ts";
import { respond, failure } from "./http.ts";

// Provider webhooks and the browser's return from checkout. No session,
// cookie or CSRF token: the provider's signature is the only authority,
// checked before anything is read from the database.
async function readLimited(request: Request, limit: number) {
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
  return Buffer.concat(chunks);
}

// The named provider must be the configured one; anything else looks like an
// unknown path.
function configured(name: string) {
  requireApp();
  const ready = paymentReadiness();
  if (!ready.configured || ready.provider !== name)
    throw new AppError("NOT_FOUND", 404);
  return paymentProvider();
}

// POST /api/billing/webhook/<provider>. Curlec wants a 2xx within 5 seconds
// and retries anything else for 24 hours, so every verified event, including
// ones held for review or ignored, answers 200. A database failure answers
// 500 so Curlec delivers again; settling is idempotent.
export async function handleBillingWebhook(request: Request, name: string) {
  try {
    if (request.method !== "POST")
      throw new AppError("METHOD_NOT_ALLOWED", 405);
    const provider = configured(name);
    const raw = await readLimited(request, 64 * 1024);
    let event;
    try {
      event = provider.parseWebhook(raw, {
        signature: request.headers.get("x-razorpay-signature"),
        contentType: request.headers.get("content-type"),
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "BAD_SIGNATURE") throw new AppError("BAD_SIGNATURE", 401);
      throw new AppError("INVALID_CALLBACK", 400);
    }
    const pool = database().pool;
    if (event.kind === "payment")
      await settlePayment(pool, provider.name, event, "callback");
    if (event.kind === "refund")
      await settleRefund(pool, provider.name, event, "callback");
    // The outcome is not echoed back.
    return respond({ received: true });
  } catch (e) {
    return failure(e);
  }
}

// POST (or GET) /api/billing/return/<provider>: Curlec's callback_url. Curlec
// posts razorpay_payment_id, razorpay_order_id and razorpay_signature after a
// successful payment. The signature proves the pair; the payment itself is
// then fetched with our own credentials, and only a captured payment credits.
// The browser always lands back on the billing screen.
export async function handleBillingReturn(request: Request, name: string) {
  const back = (status: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `/app/billing?payment=${status}`,
        "cache-control": "no-store",
      },
    });
  let provider;
  try {
    provider = configured(name);
  } catch (e) {
    return failure(e);
  }
  try {
    const fields =
      request.method === "POST"
        ? new URLSearchParams(
            (await readLimited(request, 4 * 1024)).toString("utf8"),
          )
        : new URL(request.url).searchParams;
    const orderRef = fields.get("razorpay_order_id") ?? "";
    const paymentRef = fields.get("razorpay_payment_id") ?? "";
    if (
      !provider.verifyReturn({
        orderRef,
        paymentRef,
        signature: fields.get("razorpay_signature"),
      })
    )
      return back("unverified");
    const result = await provider.getPayment(orderRef);
    if (!result.paid) return back("processing");
    const outcome = await settlePayment(
      database().pool,
      provider.name,
      result,
      "reconcile",
    );
    const final =
      outcome.outcome === "duplicate" ? outcome.first : outcome.outcome;
    return back(
      final === "credited" || final === "already_paid" ? "received" : "review",
    );
  } catch {
    // A provider or database hiccup: the webhook or reconciliation finishes it.
    return back("processing");
  }
}
