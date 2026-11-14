// Razorpay Curlec (Malaysia). Written from Curlec's public documentation
// (curlec.com/docs, read 2026-11-14) and the owner's own Curlec integration in
// Jomjual; see docs/superpowers/specs/2026-11-14-billing-design.md section 5.
// Reached only through createProvider() when JOMCALL_PAYMENT_PROVIDER=curlec
// and every CURLEC_* setting is present.
import { hmacHex, sameDigest } from "./hmac.ts";
import type {
  PaymentEvent,
  PaymentProvider,
  RefundEvent,
  WebhookEvent,
  WebhookHeaders,
} from "./provider.ts";

// Same host in test and live mode; the keys decide the mode.
export const curlecApi = "https://api.razorpay.com/v1";

export type CurlecConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  sandbox: boolean;
};

const orderId = /^order_[A-Za-z0-9]{6,40}$/;
const paymentId = /^pay_[A-Za-z0-9]{6,40}$/;
const refundId = /^rfnd_[A-Za-z0-9]{6,40}$/;
const refundStatuses = ["created", "pending", "processed", "failed"] as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
// Curlec may send amounts as numbers or numeric strings; anything else is null.
function sen(v: unknown): number | null {
  const n = typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
const time = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0
    ? new Date(v * 1000)
    : null;

// A payment entity as Curlec documents it (api/payments/entity). A payment
// counts as paid only once captured; "refunded" payments were captured first.
export function paymentEvent(
  entity: unknown,
  expectedOrder?: string,
): PaymentEvent {
  const p = obj(entity);
  const id = p?.id,
    order = p?.order_id,
    status = p?.status;
  if (typeof id !== "string" || !paymentId.test(id))
    throw Error("INVALID_CALLBACK");
  if (typeof order !== "string" || !orderId.test(order))
    throw Error("INVALID_CALLBACK");
  if (expectedOrder && order !== expectedOrder) throw Error("INVALID_CALLBACK");
  if (typeof status !== "string" || !/^[a-z_]{1,20}$/.test(status))
    throw Error("INVALID_CALLBACK");
  const paid =
    p!.captured === true || status === "captured" || status === "refunded";
  return {
    kind: "payment",
    orderRef: order,
    paymentRef: id,
    eventKey: `pay:${id}:${paid ? "captured" : status}`,
    paid,
    amountSen: sen(p!.amount),
    currency: typeof p!.currency === "string" ? p!.currency.slice(0, 8) : "",
    paidAt: paid ? time(p!.created_at) : null,
  };
}

// A refund entity (api/refunds/create-normal). Its order comes from the
// payment entity Curlec sends alongside it, or from our own records.
export function refundEvent(
  entity: unknown,
  orderRef: string,
  paymentRef: string,
): RefundEvent {
  const r = obj(entity);
  const id = r?.id,
    status = r?.status;
  if (typeof id !== "string" || !refundId.test(id))
    throw Error("INVALID_CALLBACK");
  if (r!.payment_id !== paymentRef) throw Error("INVALID_CALLBACK");
  if (!refundStatuses.includes(status as (typeof refundStatuses)[number]))
    throw Error("INVALID_CALLBACK");
  return {
    kind: "refund",
    orderRef,
    paymentRef,
    refundRef: id,
    eventKey: `rfnd:${id}:${status}`,
    status: status as RefundEvent["status"],
    amountSen: sen(r!.amount),
    currency: typeof r!.currency === "string" ? r!.currency.slice(0, 8) : "",
  };
}

// Webhook (webhooks/validate-test): X-Razorpay-Signature is HMAC-SHA256 hex
// of the raw body keyed with the webhook secret. The body is verified as
// received, before it is parsed; Curlec's own Node sample re-serializes a
// parsed body, which is not done here.
export function parseCurlecWebhook(
  raw: Uint8Array,
  headers: WebhookHeaders,
  webhookSecret: string,
): WebhookEvent {
  if (!sameDigest(hmacHex(webhookSecret, raw), headers.signature))
    throw Error("BAD_SIGNATURE");
  if (!/^application\/json\b/i.test(headers.contentType ?? ""))
    throw Error("INVALID_CALLBACK");
  let body: Json | null;
  try {
    body = obj(JSON.parse(Buffer.from(raw).toString("utf8")));
  } catch {
    throw Error("INVALID_CALLBACK");
  }
  const event = body?.event;
  if (typeof event !== "string" || !/^[a-z_.]{1,60}$/.test(event))
    throw Error("INVALID_CALLBACK");
  const payload = obj(body!.payload);
  const payment = obj(obj(payload?.payment)?.entity);
  switch (event) {
    case "payment.captured":
    case "order.paid": {
      const e = paymentEvent(payment);
      // order.paid always carries a captured payment; anything else is malformed.
      if (!e.paid) throw Error("INVALID_CALLBACK");
      return e;
    }
    case "payment.failed": {
      const e = paymentEvent(payment);
      return e.paid ? { kind: "ignored", event } : e;
    }
    case "refund.created":
    case "refund.processed":
    case "refund.failed": {
      const refund = obj(obj(payload?.refund)?.entity);
      const order = payment?.order_id,
        pay = payment?.id;
      // A refund of a payment that never belonged to one of our orders.
      if (
        typeof order !== "string" ||
        !orderId.test(order) ||
        typeof pay !== "string" ||
        !paymentId.test(pay)
      )
        return { kind: "ignored", event };
      return refundEvent(refund, order, pay);
    }
    default:
      return { kind: "ignored", event };
  }
}

// Checkout return (payment-gateway/web-integration/standard/integration-steps):
// HMAC-SHA256 hex of `order_id|razorpay_payment_id` keyed with the API key
// secret, with order_id taken from our own records.
export function verifyCurlecReturn(
  keySecret: string,
  input: { orderRef: string; paymentRef: string; signature: string | null },
) {
  if (!orderId.test(input.orderRef) || !paymentId.test(input.paymentRef))
    return false;
  return sameDigest(
    hmacHex(keySecret, `${input.orderRef}|${input.paymentRef}`),
    input.signature,
  );
}

export function createCurlecProvider(
  config: CurlecConfig,
  send: typeof fetch = fetch,
): PaymentProvider {
  const auth =
    "Basic " +
    Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: Json,
    extra?: Record<string, string>,
  ) {
    let response: Response;
    try {
      response = await send(curlecApi + path, {
        method,
        headers: {
          authorization: auth,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (response.status === 401) throw Error("PAYMENT_CREDENTIALS_REJECTED");
    if (response.status === 429) throw Error("PAYMENT_PROVIDER_BUSY");
    if (response.status >= 500) throw Error("PAYMENT_PROVIDER_UNAVAILABLE");
    if (!response.ok) throw Error("PAYMENT_PROVIDER_ERROR");
    try {
      return obj(await response.json()) ?? {};
    } catch {
      throw Error("PAYMENT_PROVIDER_ERROR");
    }
  }
  return {
    name: "curlec",
    sandbox: config.sandbox,
    async createCheckout(input) {
      // api/orders/create: amount in sen, receipt (max 40, unique; Curlec
      // treats it as an idempotency key) is the top-up id.
      const order = await call("POST", "/orders", {
        amount: input.amountSen,
        currency: "MYR",
        receipt: input.topupId,
        notes: { topup_id: input.topupId },
      });
      if (
        typeof order.id !== "string" ||
        !orderId.test(order.id) ||
        sen(order.amount) !== input.amountSen ||
        order.currency !== "MYR"
      )
        throw Error("PAYMENT_PROVIDER_ERROR");
      return {
        orderRef: order.id,
        checkout: {
          kind: "curlec",
          keyId: config.keyId,
          orderId: order.id,
          amountSen: input.amountSen,
          currency: "MYR",
          name: "JomCall",
          description: input.description,
          prefillEmail: input.payerEmail,
          callbackUrl: input.returnUrl,
        },
      };
    },
    async getPayment(orderRef) {
      if (!orderId.test(orderRef)) throw Error("PAYMENT_PROVIDER_ERROR");
      // api/orders/fetch-payments: failed and captured attempts both appear.
      const list = await call("GET", `/orders/${orderRef}/payments`);
      const items = Array.isArray(list.items) ? list.items : [];
      const events = items.flatMap((p) => {
        try {
          return [paymentEvent(p, orderRef)];
        } catch {
          return [];
        }
      });
      const captured = events
        .filter((e) => e.paid)
        .sort(
          (a, b) => (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0),
        );
      if (captured[0]) return captured[0];
      return (
        events.at(-1) ?? {
          kind: "payment",
          orderRef,
          paymentRef: null,
          eventKey: `order:${orderRef}:unpaid`,
          paid: false,
          amountSen: null,
          currency: "MYR",
          paidAt: null,
        }
      );
    },
    parseWebhook(raw, headers) {
      return parseCurlecWebhook(raw, headers, config.webhookSecret);
    },
    verifyReturn(input) {
      return verifyCurlecReturn(config.keySecret, input);
    },
    async refund(input) {
      if (
        !paymentId.test(input.paymentRef) ||
        !/^[A-Za-z0-9_-]{10,40}$/.test(input.idempotencyKey)
      )
        throw Error("PAYMENT_PROVIDER_ERROR");
      // api/refunds/create-normal and normal-refunds-idempotent. Refunds are
      // paid from the Curlec balance and cost RM0.50 each.
      const refund = await call(
        "POST",
        `/payments/${input.paymentRef}/refund`,
        {
          amount: input.amountSen,
          speed: "normal",
          receipt: input.idempotencyKey,
          notes: { reason: input.reason.slice(0, 256) },
        },
        { "x-refund-idempotency": input.idempotencyKey },
      );
      return refundEvent(refund, input.orderRef, input.paymentRef);
    },
  };
}
