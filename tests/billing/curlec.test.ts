import { test } from "node:test";
import assert from "node:assert/strict";
import { hmacHex, sameDigest } from "../../packages/billing/src/hmac.ts";
import {
  createCurlecProvider,
  curlecApi,
  parseCurlecWebhook,
  verifyCurlecReturn,
} from "../../packages/billing/src/curlec.ts";
import {
  createFakeProvider,
  fakeReturn,
  fakeSecrets,
  fakeWebhook,
} from "../../packages/billing/src/fake.ts";
import {
  createProvider,
  paymentReadiness,
  publicOrigin,
} from "../../packages/billing/src/provider.ts";
import { formatSen } from "../../packages/billing/src/money.ts";

// Payload shapes follow curlec.com/docs/webhooks/payments, /webhooks/orders
// and /webhooks/refunds (read 2026-11-14).
const secret = "test-webhook-secret";
const json = "application/json";
const bytes = (s: string) => new TextEncoder().encode(s);
const parse = (d: { body: string; signature: string }, type = json) =>
  parseCurlecWebhook(bytes(d.body), { signature: d.signature, contentType: type }, secret);

test("HMAC-SHA256 hex matches the RFC 4231-style reference and compares safely", () => {
  assert.equal(
    hmacHex("key", "The quick brown fox jumps over the lazy dog"),
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  );
  const d = hmacHex("k", "m");
  assert.equal(sameDigest(d, d), true);
  assert.equal(sameDigest(d, d.toUpperCase()), true);
  assert.equal(sameDigest(d, d.slice(0, 63)), false);
  assert.equal(sameDigest(d, d.slice(0, 63) + "g"), false);
  assert.equal(sameDigest(d, null), false);
  assert.equal(sameDigest(d, hmacHex("other", "m")), false);
});

test("webhook: captured payment, order.paid and failure parse to one key per payment state", () => {
  const captured = fakeWebhook({ event: "payment.captured", orderId: "order_Abc123456789", amountSen: 5000, paymentId: "pay_Xyz123456789", secret });
  const e = parse(captured);
  assert.equal(e.kind, "payment");
  if (e.kind !== "payment") return;
  assert.deepEqual(
    { order: e.orderRef, pay: e.paymentRef, key: e.eventKey, paid: e.paid, amount: e.amountSen, currency: e.currency },
    { order: "order_Abc123456789", pay: "pay_Xyz123456789", key: "pay:pay_Xyz123456789:captured", paid: true, amount: 5000, currency: "MYR" },
  );
  const orderPaid = parse(fakeWebhook({ event: "order.paid", orderId: "order_Abc123456789", amountSen: 5000, paymentId: "pay_Xyz123456789", secret }));
  assert.equal(orderPaid.kind === "payment" && orderPaid.eventKey, e.eventKey);
  const failed = parse(fakeWebhook({ event: "payment.failed", orderId: "order_Abc123456789", amountSen: 5000, paymentId: "pay_Fail23456789", secret }));
  assert.equal(failed.kind === "payment" && failed.paid, false);
  assert.equal(failed.kind === "payment" && failed.eventKey, "pay:pay_Fail23456789:failed");
});

test("webhook: signature is checked over the raw body before parsing", () => {
  const d = fakeWebhook({ event: "payment.captured", orderId: "order_Abc123456789", amountSen: 5000, secret });
  assert.throws(() => parse({ ...d, signature: hmacHex("wrong", d.body) }), /BAD_SIGNATURE/);
  assert.throws(() => parse({ ...d, signature: "" }), /BAD_SIGNATURE/);
  assert.throws(() => parse({ ...d, body: d.body.replace('"amount":5000', '"amount":9000') }), /BAD_SIGNATURE/);
  // The same JSON re-serialized differently is a different body.
  assert.throws(() => parse({ ...d, body: JSON.stringify(JSON.parse(d.body), null, 2) }), /BAD_SIGNATURE/);
  assert.throws(() => parse(d, "application/x-www-form-urlencoded"), /INVALID_CALLBACK/);
  const notJson = { body: "not json", signature: hmacHex(secret, "not json") };
  assert.throws(() => parse(notJson), /INVALID_CALLBACK/);
});

test("webhook: refunds, unknown events and foreign payments", () => {
  const r = parse(fakeWebhook({ event: "refund.processed", orderId: "order_Abc123456789", amountSen: 5000, paymentId: "pay_Xyz123456789", refundId: "rfnd_Ref123456789", refundAmountSen: 2000, secret }));
  assert.equal(r.kind, "refund");
  if (r.kind === "refund")
    assert.deepEqual(
      { order: r.orderRef, pay: r.paymentRef, refund: r.refundRef, status: r.status, amount: r.amountSen, key: r.eventKey },
      { order: "order_Abc123456789", pay: "pay_Xyz123456789", refund: "rfnd_Ref123456789", status: "processed", amount: 2000, key: "rfnd:rfnd_Ref123456789:processed" },
    );
  const other = JSON.stringify({ entity: "event", event: "settlement.processed", payload: {} });
  assert.deepEqual(parse({ body: other, signature: hmacHex(secret, other) }), { kind: "ignored", event: "settlement.processed" });
  // A refund of a payment made without one of our orders is not ours to settle.
  const d = JSON.parse(fakeWebhook({ event: "refund.processed", orderId: "order_Abc123456789", amountSen: 100, secret }).body);
  d.payload.payment.entity.order_id = null;
  const foreign = JSON.stringify(d);
  assert.equal(parse({ body: foreign, signature: hmacHex(secret, foreign) }).kind, "ignored");
  // order.paid must carry a captured payment.
  const bad = JSON.parse(fakeWebhook({ event: "order.paid", orderId: "order_Abc123456789", amountSen: 100, secret }).body);
  Object.assign(bad.payload.payment.entity, { status: "failed", captured: false });
  const badBody = JSON.stringify(bad);
  assert.throws(() => parse({ body: badBody, signature: hmacHex(secret, badBody) }), /INVALID_CALLBACK/);
});

test("checkout return signature is order_id|payment_id with the key secret", () => {
  const form = new URLSearchParams(fakeReturn("order_Abc123456789", "pay_Xyz123456789", "key-secret"));
  const input = { orderRef: "order_Abc123456789", paymentRef: "pay_Xyz123456789", signature: form.get("razorpay_signature") };
  assert.equal(verifyCurlecReturn("key-secret", input), true);
  assert.equal(verifyCurlecReturn("other-secret", input), false);
  assert.equal(verifyCurlecReturn("key-secret", { ...input, orderRef: "order_Other3456789" }), false);
  assert.equal(verifyCurlecReturn("key-secret", { ...input, paymentRef: "not-a-payment" }), false);
  assert.equal(verifyCurlecReturn("key-secret", { ...input, signature: null }), false);
});

test("payments are off unless configured; fake is local only; Curlec needs every setting", () => {
  assert.equal(paymentReadiness({}).reason, "PAYMENTS_DISABLED");
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "fake" }).reason, "FAKE_PROVIDER_LOCAL_ONLY");
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "fake", JOMCALL_MODE: "local" }).configured, true);
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "fake", JOMCALL_MODE: "hosted" }).reason, "FAKE_PROVIDER_LOCAL_ONLY");
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "billplz" }).reason, "PAYMENT_PROVIDER_UNKNOWN");
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "curlec" }).reason, "PAYMENT_CREDENTIALS_MISSING");
  const full = {
    JOMCALL_PAYMENT_PROVIDER: "curlec", CURLEC_KEY_ID: "rzp_test_Abc123", CURLEC_KEY_SECRET: "s",
    CURLEC_WEBHOOK_SECRET: "w", JOMCALL_PUBLIC_ORIGIN: "https://app.example.invalid",
  };
  assert.deepEqual(paymentReadiness(full), { provider: "curlec", configured: true, sandbox: true, reason: null });
  assert.equal(paymentReadiness({ ...full, CURLEC_WEBHOOK_SECRET: "" }).reason, "PAYMENT_CREDENTIALS_MISSING");
  assert.equal(paymentReadiness({ ...full, CURLEC_ENVIRONMENT: "prod" }).reason, "CURLEC_ENVIRONMENT_INVALID");
  assert.equal(paymentReadiness({ ...full, CURLEC_ENVIRONMENT: "live" }).reason, "CURLEC_KEY_MODE_MISMATCH");
  assert.equal(paymentReadiness({ ...full, CURLEC_KEY_ID: "rzp_live_Abc123" }).reason, "CURLEC_KEY_MODE_MISMATCH");
  assert.equal(paymentReadiness({ ...full, CURLEC_KEY_ID: "rzp_live_Abc123", CURLEC_ENVIRONMENT: "live" }).sandbox, false);
  assert.equal(paymentReadiness({ ...full, JOMCALL_PUBLIC_ORIGIN: "http://app.example.invalid" }).reason, "PUBLIC_ORIGIN_INVALID");
  const { JOMCALL_PUBLIC_ORIGIN: _, ...keys } = full;
  assert.equal(paymentReadiness(keys).reason, "PUBLIC_ORIGIN_INVALID");
  assert.equal(paymentReadiness({ ...keys, APP_ORIGIN: "https://app.example.invalid" }).reason, "PUBLIC_ORIGIN_INVALID");
  const hosted = { ...keys, JOMCALL_MODE: "hosted", APP_ORIGIN: "https://app.example.invalid" };
  assert.equal(paymentReadiness(hosted).configured, true);
  assert.equal(publicOrigin(hosted), "https://app.example.invalid");
  assert.throws(() => createProvider({}), /PAYMENTS_DISABLED/);
});

test("Curlec client sends the documented requests", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let reply: unknown = {};
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
  const p = createCurlecProvider({ keyId: "rzp_test_Abc123", keySecret: "ks", webhookSecret: "ws", sandbox: true }, send);
  reply = { id: "order_Abc123456789", entity: "order", amount: 2000, amount_paid: 0, amount_due: 2000, currency: "MYR", receipt: "t-1", status: "created", attempts: 0, notes: {}, created_at: 1763100000 };
  const out = await p.createCheckout({ topupId: "0b6c5a52-6f0e-4f9b-9d7a-0d5f3b1d2a10", amountSen: 2000, description: "JomCall credit top-up", payerEmail: "owner@example.invalid", returnUrl: "https://app.example.invalid/api/billing/return/curlec" });
  assert.equal(calls[0].url, `${curlecApi}/orders`);
  assert.equal(curlecApi, "https://api.razorpay.com/v1");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Basic " + Buffer.from("rzp_test_Abc123:ks").toString("base64"));
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    amount: 2000, currency: "MYR", receipt: "0b6c5a52-6f0e-4f9b-9d7a-0d5f3b1d2a10",
    notes: { topup_id: "0b6c5a52-6f0e-4f9b-9d7a-0d5f3b1d2a10" },
  });
  assert.deepEqual(out, {
    orderRef: "order_Abc123456789",
    checkout: {
      kind: "curlec", keyId: "rzp_test_Abc123", orderId: "order_Abc123456789", amountSen: 2000, currency: "MYR",
      name: "JomCall", description: "JomCall credit top-up", prefillEmail: "owner@example.invalid",
      callbackUrl: "https://app.example.invalid/api/billing/return/curlec",
    },
  });
  assert.equal(JSON.stringify(out).includes("ks"), false);
  // An order whose amount differs from the top-up is refused.
  reply = { id: "order_Abc123456789", amount: "1999", currency: "MYR" };
  await assert.rejects(p.createCheckout({ topupId: "t", amountSen: 2000, description: "d", payerEmail: "e", returnUrl: "r" }), /PAYMENT_PROVIDER_ERROR/);
  // Order payments: a captured payment wins over a failed attempt.
  reply = {
    entity: "collection", count: 2,
    items: [
      { id: "pay_Fail23456789", order_id: "order_Abc123456789", status: "failed", captured: false, amount: 2000, currency: "MYR", created_at: 1763100100 },
      { id: "pay_Good23456789", order_id: "order_Abc123456789", status: "captured", captured: true, amount: "2000", currency: "MYR", created_at: 1763100200 },
    ],
  };
  const paid = await p.getPayment("order_Abc123456789");
  assert.equal(calls.at(-1)!.url, `${curlecApi}/orders/order_Abc123456789/payments`);
  assert.deepEqual({ pay: paid.paymentRef, paid: paid.paid, amount: paid.amountSen, key: paid.eventKey }, { pay: "pay_Good23456789", paid: true, amount: 2000, key: "pay:pay_Good23456789:captured" });
  reply = { entity: "collection", count: 0, items: [] };
  assert.equal((await p.getPayment("order_Abc123456789")).paid, false);
  // Refund with an idempotency key.
  reply = { id: "rfnd_Ref123456789", entity: "refund", amount: 500, currency: "MYR", payment_id: "pay_Good23456789", status: "pending", speed_requested: "normal" };
  const refund = await p.refund({ orderRef: "order_Abc123456789", paymentRef: "pay_Good23456789", amountSen: 500, idempotencyKey: "jc-0123456789abcdef", reason: "Customer asked" });
  const last = calls.at(-1)!;
  assert.equal(last.url, `${curlecApi}/payments/pay_Good23456789/refund`);
  assert.equal((last.init.headers as Record<string, string>)["x-refund-idempotency"], "jc-0123456789abcdef");
  assert.deepEqual(JSON.parse(String(last.init.body)), { amount: 500, speed: "normal", receipt: "jc-0123456789abcdef", notes: { reason: "Customer asked" } });
  assert.deepEqual({ status: refund.status, key: refund.eventKey }, { status: "pending", key: "rfnd:rfnd_Ref123456789:pending" });
});

test("Curlec client maps failures to safe codes", async () => {
  const status = (s: number) =>
    createCurlecProvider({ keyId: "rzp_test_Abc123", keySecret: "ks", webhookSecret: "ws", sandbox: true },
      (async () => new Response("{}", { status: s })) as unknown as typeof fetch);
  await assert.rejects(status(401).getPayment("order_Abc123456789"), /PAYMENT_CREDENTIALS_REJECTED/);
  await assert.rejects(status(429).getPayment("order_Abc123456789"), /PAYMENT_PROVIDER_BUSY/);
  await assert.rejects(status(502).getPayment("order_Abc123456789"), /PAYMENT_PROVIDER_UNAVAILABLE/);
  await assert.rejects(status(400).getPayment("order_Abc123456789"), /PAYMENT_PROVIDER_ERROR/);
  const down = createCurlecProvider({ keyId: "rzp_test_Abc123", keySecret: "ks", webhookSecret: "ws", sandbox: true },
    (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch);
  await assert.rejects(down.getPayment("order_Abc123456789"), /PAYMENT_PROVIDER_UNAVAILABLE/);
  // Bad ids never reach the network.
  let called = false;
  const guard = createCurlecProvider({ keyId: "rzp_test_Abc123", keySecret: "ks", webhookSecret: "ws", sandbox: true },
    (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch);
  await assert.rejects(guard.getPayment("../payments"), /PAYMENT_PROVIDER_ERROR/);
  await assert.rejects(guard.refund({ orderRef: "order_Abc123456789", paymentRef: "pay_Good23456789", amountSen: 1, idempotencyKey: "short", reason: "r" }), /PAYMENT_PROVIDER_ERROR/);
  assert.equal(called, false);
});

test("fake provider speaks Curlec's shapes in memory", async () => {
  const f = createFakeProvider(fakeSecrets);
  const c = await f.createCheckout({ topupId: "t", amountSen: 2000, description: "d", payerEmail: "e@example.invalid", returnUrl: "r" });
  assert.match(c.orderRef, /^order_fake[0-9a-f]{10}$/);
  assert.deepEqual(c.checkout, { kind: "fake", orderId: c.orderRef });
  assert.equal((await f.getPayment(c.orderRef)).paid, false);
  const pay = f.pay(c.orderRef);
  const r = await f.getPayment(c.orderRef);
  assert.deepEqual({ paid: r.paid, amount: r.amountSen, pay: r.paymentRef }, { paid: true, amount: 2000, pay });
  const d = fakeWebhook({ event: "payment.captured", orderId: c.orderRef, amountSen: 2000, paymentId: pay });
  assert.equal(f.parseWebhook(bytes(d.body), { signature: d.signature, contentType: json }).kind, "payment");
});

test("sen format", () => {
  assert.equal(formatSen(123450), "RM 1,234.50");
  assert.equal(formatSen(-5), "−RM 0.05");
  assert.equal(formatSen(0), "RM 0.00");
});
