import { parseBillplzCallback } from "./callback.ts";
import type { PaymentProvider, ProviderResult } from "./provider.ts";

// Billplz client, written from https://support.billplz.com/api (read
// 2026-11-14). Reached only when JOMCALL_PAYMENT_PROVIDER=billplz and every
// credential is set (see provider.ts). Each request sends the bill amount,
// the payer's name and email to billplz.com, outside this machine.
export function createBillplzProvider(
  config: { apiKey: string; signatureKey: string; collectionId: string; sandbox: boolean },
  send: typeof fetch = fetch,
): PaymentProvider {
  if (!config.apiKey || !config.signatureKey || !config.collectionId)
    throw Error("PAYMENT_CREDENTIALS_MISSING");
  const base = config.sandbox
    ? "https://www.billplz-sandbox.com/api"
    : "https://www.billplz.com/api";
  const auth = "Basic " + Buffer.from(config.apiKey + ":").toString("base64");
  async function call(method: string, path: string, body?: unknown) {
    let response: Response;
    try {
      response = await send(base + path, {
        method,
        headers: {
          authorization: auth,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
    } catch {
      throw Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (response.status === 401) throw Error("PAYMENT_CREDENTIALS_REJECTED");
    if (response.status === 429) throw Error("PAYMENT_PROVIDER_BUSY");
    if (!response.ok) throw Error("PAYMENT_PROVIDER_ERROR");
    const text = await response.text();
    if (text.length > 65536) throw Error("PAYMENT_PROVIDER_ERROR");
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw Error("PAYMENT_PROVIDER_ERROR");
    }
  }
  const bill = (v: Record<string, unknown>): ProviderResult => {
    const id = String(v.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw Error("PAYMENT_PROVIDER_ERROR");
    const paid = v.paid === true && v.state === "paid";
    const amount = Number(v.paid_amount);
    return {
      providerRef: id,
      eventKey: `reconcile:${id}:${paid ? "paid" : "unpaid"}`,
      paid,
      amountSen: Number.isSafeInteger(amount) ? amount : null,
      currency: "MYR",
      paidAt: null,
    };
  };
  return {
    name: "billplz",
    sandbox: config.sandbox,
    async createCheckout(input) {
      const v = await call("POST", "/v3/bills", {
        collection_id: config.collectionId,
        email: input.payerEmail,
        name: input.payerName.slice(0, 255),
        amount: input.amountSen,
        callback_url: input.callbackUrl,
        redirect_url: input.redirectUrl,
        description: input.description.slice(0, 200),
        reference_1_label: "Top-up",
        reference_1: input.topupId,
      });
      const id = String(v.id ?? ""),
        url = String(v.url ?? "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^https:\/\/www\.billplz(-sandbox)?\.com\//.test(url))
        throw Error("PAYMENT_PROVIDER_ERROR");
      if (Number(v.amount) !== input.amountSen) throw Error("PAYMENT_PROVIDER_ERROR");
      return { providerRef: id, checkoutUrl: url };
    },
    async getPayment(providerRef) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerRef)) throw Error("PAYMENT_PROVIDER_ERROR");
      return bill(await call("GET", "/v3/bills/" + encodeURIComponent(providerRef)));
    },
    parseCallback(body, contentType) {
      return parseBillplzCallback(body, contentType, config.signatureKey);
    },
  };
}
