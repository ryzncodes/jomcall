import { randomBytes } from "node:crypto";
import {
  parseCurlecWebhook,
  paymentEvent,
  verifyCurlecReturn,
} from "./curlec.ts";
import { hmacHex } from "./hmac.ts";
import type { PaymentEvent, PaymentProvider } from "./provider.ts";

// Not secrets: the fake provider exists only in local mode. These let the
// simulator and tests sign webhooks the production Curlec parser checks.
export const fakeSecrets = {
  keySecret: "jomcall-local-fake-key-secret",
  webhookSecret: "jomcall-local-fake-webhook-secret",
};

type FakePayment = {
  id: string;
  status: string;
  amountSen: number;
  currency: string;
  createdAt: number;
};
type FakeOrder = { id: string; amountSen: number; payments: FakePayment[] };
const alnum = (n: number) => randomBytes(n).toString("hex").slice(0, n);

// In-memory stand-in for Curlec. Speaks Curlec's shapes; nothing leaves the
// machine.
export function createFakeProvider(secrets: typeof fakeSecrets) {
  const orders = new Map<string, FakeOrder>();
  const entity = (o: FakeOrder, p: FakePayment) => ({
    id: p.id,
    entity: "payment",
    amount: p.amountSen,
    currency: p.currency,
    status: p.status,
    order_id: o.id,
    captured: p.status === "captured",
    method: "fpx",
    created_at: p.createdAt,
  });
  const provider: PaymentProvider & {
    orders: Map<string, FakeOrder>;
    pay(orderRef: string, amountSen?: number): string;
  } = {
    name: "fake",
    sandbox: true,
    orders,
    async createCheckout(input) {
      const id = "order_fake" + alnum(10);
      orders.set(id, { id, amountSen: input.amountSen, payments: [] });
      return { orderRef: id, checkout: { kind: "fake", orderId: id } };
    },
    async getPayment(orderRef) {
      const o = orders.get(orderRef);
      const captured = o?.payments.find((p) => p.status === "captured");
      if (o && captured) return paymentEvent(entity(o, captured), orderRef);
      const unpaid: PaymentEvent = {
        kind: "payment",
        orderRef,
        paymentRef: null,
        eventKey: `order:${orderRef}:unpaid`,
        paid: false,
        amountSen: null,
        currency: "MYR",
        paidAt: null,
      };
      return unpaid;
    },
    parseWebhook(raw, headers) {
      return parseCurlecWebhook(raw, headers, secrets.webhookSecret);
    },
    verifyReturn(input) {
      return verifyCurlecReturn(secrets.keySecret, input);
    },
    async refund(input) {
      const refundRef = "rfnd_fake" + alnum(10);
      return {
        kind: "refund",
        orderRef: input.orderRef,
        paymentRef: input.paymentRef,
        refundRef,
        eventKey: `rfnd:${refundRef}:processed`,
        status: "processed",
        amountSen: input.amountSen,
        currency: "MYR",
      };
    },
    pay(orderRef, amountSen) {
      const o = orders.get(orderRef);
      if (!o) throw Error("NOT_FOUND");
      const id = "pay_fake" + alnum(10);
      o.payments.push({
        id,
        status: "captured",
        amountSen: amountSen ?? o.amountSen,
        currency: "MYR",
        createdAt: Math.floor(Date.now() / 1000),
      });
      return id;
    },
  };
  return provider;
}

// A Curlec-shaped webhook delivery (webhooks/payments, webhooks/refunds),
// signed the way Curlec signs: HMAC-SHA256 hex of the exact body bytes.
export function fakeWebhook(input: {
  event:
    | "payment.captured"
    | "order.paid"
    | "payment.failed"
    | "refund.created"
    | "refund.processed"
    | "refund.failed";
  orderId: string;
  amountSen: number;
  paymentId?: string;
  currency?: string;
  refundId?: string;
  refundAmountSen?: number;
  secret?: string;
}) {
  const paymentId = input.paymentId ?? "pay_fake" + alnum(10);
  const refunding = input.event.startsWith("refund.");
  const status = input.event === "payment.failed" ? "failed" : "captured";
  const payment = {
    id: paymentId,
    entity: "payment",
    amount: input.amountSen,
    currency: input.currency ?? "MYR",
    status: refunding ? "refunded" : status,
    order_id: input.orderId,
    invoice_id: null,
    international: false,
    method: "fpx",
    amount_refunded: refunding ? (input.refundAmountSen ?? input.amountSen) : 0,
    refund_status: refunding ? "full" : null,
    captured: status === "captured",
    description: "JomCall credit top-up",
    card_id: null,
    bank: "TEST",
    wallet: null,
    email: "owner@example.invalid",
    contact: "+60100000000",
    notes: {},
    fee: 0,
    tax: 0,
    error_code: status === "failed" ? "BAD_REQUEST_ERROR" : null,
    error_description: status === "failed" ? "Payment was not completed" : null,
    created_at: Math.floor(Date.now() / 1000),
  };
  const payload: Record<string, unknown> = { payment: { entity: payment } };
  if (input.event === "order.paid")
    payload.order = {
      entity: {
        id: input.orderId,
        entity: "order",
        amount: input.amountSen,
        amount_paid: input.amountSen,
        amount_due: 0,
        currency: "MYR",
        receipt: null,
        status: "paid",
        attempts: 1,
        notes: {},
        created_at: payment.created_at,
      },
    };
  if (refunding)
    payload.refund = {
      entity: {
        id: input.refundId ?? "rfnd_fake" + alnum(10),
        entity: "refund",
        amount: input.refundAmountSen ?? input.amountSen,
        currency: input.currency ?? "MYR",
        payment_id: paymentId,
        notes: {},
        receipt: null,
        acquirer_data: { arn: null },
        created_at: payment.created_at,
        batch_id: null,
        status: input.event.split(".")[1],
        speed_processed: "normal",
        speed_requested: "normal",
      },
    };
  const body = JSON.stringify({
    entity: "event",
    account_id: "acc_fakeaccount01",
    event: input.event,
    contains: Object.keys(payload),
    payload,
    created_at: payment.created_at,
  });
  return {
    body,
    paymentId,
    signature: hmacHex(input.secret ?? fakeSecrets.webhookSecret, body),
    eventId: "evt_fake" + alnum(10),
  };
}

// The signed fields Curlec posts to callback_url after a successful payment.
export function fakeReturn(
  orderId: string,
  paymentId: string,
  secret = fakeSecrets.keySecret,
) {
  return new URLSearchParams({
    razorpay_payment_id: paymentId,
    razorpay_order_id: orderId,
    razorpay_signature: hmacHex(secret, `${orderId}|${paymentId}`),
  }).toString();
}
