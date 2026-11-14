import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, signatureSource, verify } from "../../packages/billing/src/signature.ts";
import { parseBillplzCallback, parseBillplzTime } from "../../packages/billing/src/callback.ts";
import { fakeCallback, fakeSignatureKey, createFakeProvider } from "../../packages/billing/src/fake.ts";
import { paymentReadiness, createProvider, publicOrigin } from "../../packages/billing/src/provider.ts";
import { createBillplzProvider } from "../../packages/billing/src/billplz.ts";
import { formatSen } from "../../packages/billing/src/money.ts";

// Worked examples from https://support.billplz.com/api (read 2026-11-14).
const docKey = "S-s7b4yWpp9h7rrkNM1i3Z_g";
test("Billplz callback example reproduces", () => {
  const fields: [string, string][] = [
    ["id", "zq0tm2wc"], ["collection_id", "yhx5t1pp"], ["paid", "true"],
    ["state", "paid"], ["amount", "100"], ["paid_amount", "100"],
    ["due_at", "2018-9-27"], ["email", "tester@test.com"], ["mobile", ""],
    ["name", "TESTER"], ["url", "http://www.billplz-sandbox.com/bills/zq0tm2wc"],
    ["paid_at", "2018-09-27 15:15:09 +0800"],
  ];
  assert.equal(
    signatureSource(fields),
    "amount100|collection_idyhx5t1pp|due_at2018-9-27|emailtester@test.com|idzq0tm2wc|mobile|nameTESTER|paid_amount100|paid_at2018-09-27 15:15:09 +0800|paidtrue|statepaid|urlhttp://www.billplz-sandbox.com/bills/zq0tm2wc",
  );
  assert.equal(sign(fields, docKey), "0fe0a20b8d557eeae570377783d062a3816a9ea80f368860bacfa7ec3ca4d00e");
});
test("Billplz redirect example reproduces", () => {
  const fields: [string, string][] = [
    ["billplzid", "zq0tm2wc"], ["billplzpaid", "true"],
    ["billplzpaid_at", "2018-09-27 15:15:09 +0800"],
  ];
  assert.equal(sign(fields, docKey), "4aab095fe5a39b1d534500988f9a0cb085cd1b6d5bbb55dd4e02ea6fa102b47b");
});
test("verify refuses wrong, short, uppercase and missing signatures", () => {
  const fields: [string, string][] = [["id", "a"], ["paid", "true"]];
  const good = sign(fields, "k");
  assert.equal(verify(fields, good, "k"), true);
  assert.equal(verify(fields, good, "other"), false);
  assert.equal(verify(fields, good.slice(1), "k"), false);
  assert.equal(verify(fields, good.toUpperCase(), "k"), false);
  assert.equal(verify(fields, null, "k"), false);
  assert.equal(verify(fields, good, ""), false);
});
test("callback parser verifies before trusting any field", () => {
  const body = fakeCallback({ id: "fake_abc", amountSen: 5000, paid: true, transactionId: "t1" });
  const r = parseBillplzCallback(body, "application/x-www-form-urlencoded", fakeSignatureKey);
  assert.deepEqual(
    { ref: r.providerRef, paid: r.paid, amount: r.amountSen, currency: r.currency, key: r.eventKey },
    { ref: "fake_abc", paid: true, amount: 5000, currency: "MYR", key: "cb:fake_abc:paid:t1" },
  );
  assert.equal(r.paidAt?.toISOString(), "2026-11-14T02:00:00.000Z");
  const tampered = body.replace("paid_amount=5000", "paid_amount=9000");
  assert.throws(() => parseBillplzCallback(tampered, "application/x-www-form-urlencoded", fakeSignatureKey), /BAD_SIGNATURE/);
  assert.throws(() => parseBillplzCallback(body, "application/json", fakeSignatureKey), /INVALID_CALLBACK/);
  // An unsigned extra field breaks the signature; a signed one is accepted and ignored.
  assert.throws(() => parseBillplzCallback(body + "&extra=1", "application/x-www-form-urlencoded", fakeSignatureKey), /BAD_SIGNATURE/);
  const signedExtra = new URLSearchParams(body);
  signedExtra.delete("x_signature");
  signedExtra.append("future_field", "x");
  signedExtra.append("x_signature", sign([...signedExtra], fakeSignatureKey));
  assert.equal(parseBillplzCallback(signedExtra.toString(), "application/x-www-form-urlencoded", fakeSignatureKey).paid, true);
  assert.throws(() => parseBillplzCallback(body + "&id=x", "application/x-www-form-urlencoded", fakeSignatureKey), /INVALID_CALLBACK/);
  const other = fakeCallback({ id: "fake_abc", amountSen: 5000, paid: true, key: "wrong-key" });
  assert.throws(() => parseBillplzCallback(other, "application/x-www-form-urlencoded", fakeSignatureKey), /BAD_SIGNATURE/);
  assert.equal(parseBillplzTime("bad"), null);
});
test("payments are off unless configured; fake is local only", () => {
  assert.equal(paymentReadiness({}).configured, false);
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "fake" }).reason, "FAKE_PROVIDER_LOCAL_ONLY");
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "fake", JOMCALL_MODE: "local" }).configured, true);
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "billplz" }).reason, "PAYMENT_CREDENTIALS_MISSING");
  const full = {
    JOMCALL_PAYMENT_PROVIDER: "billplz", BILLPLZ_API_KEY: "k", BILLPLZ_X_SIGNATURE_KEY: "s",
    BILLPLZ_COLLECTION_ID: "abc123", JOMCALL_PUBLIC_ORIGIN: "https://app.example.invalid",
  };
  assert.deepEqual(paymentReadiness(full), { provider: "billplz", configured: true, sandbox: true, reason: null });
  assert.equal(paymentReadiness({ ...full, JOMCALL_PUBLIC_ORIGIN: "http://app.example.invalid" }).reason, "PUBLIC_ORIGIN_INVALID");
  assert.equal(paymentReadiness({ ...full, BILLPLZ_ENVIRONMENT: "production" }).sandbox, false);
  assert.throws(() => createProvider({}), /PAYMENTS_DISABLED/);
  // Hosted mode: fake refused; the callback origin defaults to APP_ORIGIN.
  assert.equal(paymentReadiness({ JOMCALL_PAYMENT_PROVIDER: "fake", JOMCALL_MODE: "hosted" }).reason, "FAKE_PROVIDER_LOCAL_ONLY");
  const { JOMCALL_PUBLIC_ORIGIN: _, ...keys } = full;
  assert.equal(paymentReadiness(keys).reason, "PUBLIC_ORIGIN_INVALID");
  const hosted = { ...keys, JOMCALL_MODE: "hosted", APP_ORIGIN: "https://app.example.invalid" };
  assert.equal(paymentReadiness(hosted).configured, true);
  assert.equal(publicOrigin(hosted), "https://app.example.invalid");
  assert.equal(paymentReadiness({ ...keys, APP_ORIGIN: "https://app.example.invalid" }).reason, "PUBLIC_ORIGIN_INVALID");
});
test("Billplz client sends the documented request and never calls out when off", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "8X0Iyzaw", amount: 2000, paid: false, state: "due", url: "https://www.billplz-sandbox.com/bills/8X0Iyzaw" }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = createBillplzProvider({ apiKey: "secret", signatureKey: "s", collectionId: "inbmmepb", sandbox: true }, send);
  const out = await p.createCheckout({
    topupId: "t", amountSen: 2000, description: "JomCall credit top-up", payerName: "Kedai Contoh",
    payerEmail: "owner@example.invalid", callbackUrl: "https://app.example.invalid/api/billing/webhook/billplz",
    redirectUrl: "https://app.example.invalid/app/billing?topup=t",
  });
  assert.deepEqual(out, { providerRef: "8X0Iyzaw", checkoutUrl: "https://www.billplz-sandbox.com/bills/8X0Iyzaw" });
  assert.equal(calls[0].url, "https://www.billplz-sandbox.com/api/v3/bills");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Basic " + Buffer.from("secret:").toString("base64"));
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.amount, 2000);
  assert.equal(sent.collection_id, "inbmmepb");
  const bad = createBillplzProvider({ apiKey: "x", signatureKey: "s", collectionId: "c", sandbox: false },
    (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
  await assert.rejects(bad.getPayment("abc"), /PAYMENT_CREDENTIALS_REJECTED/);
});
test("fake provider keeps bills in memory", async () => {
  const f = createFakeProvider({ key: fakeSignatureKey, origin: "http://127.0.0.1:4182" });
  const c = await f.createCheckout({ topupId: "t", amountSen: 2000, description: "d", payerName: "n", payerEmail: "e@example.invalid", callbackUrl: "c", redirectUrl: "r" });
  assert.equal((await f.getPayment(c.providerRef)).paid, false);
  f.markPaid(c.providerRef);
  assert.deepEqual(
    { paid: (await f.getPayment(c.providerRef)).paid, amount: (await f.getPayment(c.providerRef)).amountSen },
    { paid: true, amount: 2000 },
  );
});
test("sen format", () => {
  assert.equal(formatSen(123450), "RM 1,234.50");
  assert.equal(formatSen(-5), "−RM 0.05");
  assert.equal(formatSen(0), "RM 0.00");
});
