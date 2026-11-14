import { createCurlecProvider } from "./curlec.ts";
import { createFakeProvider, fakeSecrets } from "./fake.ts";

// What a provider reported about one payment, after its signature (webhook)
// or our own API credentials (reconciliation) vouched for it.
export type PaymentEvent = {
  kind: "payment";
  // The provider's order id: the top-up's provider_ref.
  orderRef: string;
  paymentRef: string | null;
  // One key per payment state; a replay, order.paid and reconciliation of the
  // same captured payment all carry the same key.
  eventKey: string;
  paid: boolean;
  amountSen: number | null;
  currency: string;
  paidAt: Date | null;
};
export type RefundEvent = {
  kind: "refund";
  orderRef: string;
  paymentRef: string;
  refundRef: string;
  eventKey: string;
  status: "created" | "pending" | "processed" | "failed";
  amountSen: number | null;
  currency: string;
};
export type WebhookEvent =
  | PaymentEvent
  | RefundEvent
  | { kind: "ignored"; event: string };

// Everything the browser needs to open the provider's checkout. Holds the
// public key id only, never a secret.
export type CheckoutHandoff =
  | {
      kind: "curlec";
      keyId: string;
      orderId: string;
      amountSen: number;
      currency: "MYR";
      name: string;
      description: string;
      prefillEmail: string;
      callbackUrl: string;
    }
  | { kind: "fake"; orderId: string };

export type CheckoutInput = {
  topupId: string;
  amountSen: number;
  description: string;
  payerEmail: string;
  // Where the provider sends the browser back (Curlec: POSTs the signed
  // razorpay_* fields there).
  returnUrl: string;
};
export type RefundInput = {
  orderRef: string;
  paymentRef: string;
  amountSen: number;
  // At least 10 characters of [A-Za-z0-9_-]; the same key never refunds twice.
  idempotencyKey: string;
  reason: string;
};
export type WebhookHeaders = {
  signature: string | null;
  contentType: string | null;
};

export interface PaymentProvider {
  readonly name: "fake" | "curlec";
  readonly sandbox: boolean;
  createCheckout(
    input: CheckoutInput,
  ): Promise<{ orderRef: string; checkout: CheckoutHandoff }>;
  // The current state of an order, asked with our own credentials. A captured
  // payment wins over failed attempts on the same order.
  getPayment(orderRef: string): Promise<PaymentEvent>;
  // Verifies the signature over the raw body, then parses. Throws
  // BAD_SIGNATURE or INVALID_CALLBACK; never returns an unverified event.
  parseWebhook(raw: Uint8Array, headers: WebhookHeaders): WebhookEvent;
  // Checks the signature on the browser return (order id from our own
  // records, payment id and signature from the posted form).
  verifyReturn(input: {
    orderRef: string;
    paymentRef: string;
    signature: string | null;
  }): boolean;
  refund(input: RefundInput): Promise<RefundEvent>;
}

type Env = Record<string, string | undefined>;
export type PaymentReadiness = {
  provider: "disabled" | "fake" | "curlec";
  configured: boolean;
  sandbox: boolean;
  reason: string | null;
};

const curlecNames = [
  "CURLEC_KEY_ID",
  "CURLEC_KEY_SECRET",
  "CURLEC_WEBHOOK_SECRET",
] as const;

// The public address Curlec returns the browser to and calls back. Hosted
// mode uses its APP_ORIGIN unless JOMCALL_PUBLIC_ORIGIN overrides it.
function publicOriginSetting(env: Env): string | undefined {
  const own = env.JOMCALL_PUBLIC_ORIGIN?.trim();
  if (own) return own;
  return env.JOMCALL_MODE === "hosted"
    ? env.APP_ORIGIN?.trim() || undefined
    : undefined;
}

// Off unless JOMCALL_PAYMENT_PROVIDER says otherwise. No network call and
// no key value leaves this function.
export function paymentReadiness(env: Env = process.env): PaymentReadiness {
  const provider = env.JOMCALL_PAYMENT_PROVIDER?.trim() || "disabled";
  if (provider === "disabled")
    return {
      provider,
      configured: false,
      sandbox: true,
      reason: "PAYMENTS_DISABLED",
    };
  if (provider === "fake")
    return env.JOMCALL_MODE === "local"
      ? { provider, configured: true, sandbox: true, reason: null }
      : {
          provider,
          configured: false,
          sandbox: true,
          reason: "FAKE_PROVIDER_LOCAL_ONLY",
        };
  if (provider !== "curlec")
    return {
      provider: "disabled",
      configured: false,
      sandbox: true,
      reason: "PAYMENT_PROVIDER_UNKNOWN",
    };
  const environment = env.CURLEC_ENVIRONMENT?.trim() || "test";
  const sandbox = environment !== "live";
  if (!["test", "live"].includes(environment))
    return {
      provider,
      configured: false,
      sandbox,
      reason: "CURLEC_ENVIRONMENT_INVALID",
    };
  if (curlecNames.some((n) => !env[n]?.trim()))
    return {
      provider,
      configured: false,
      sandbox,
      reason: "PAYMENT_CREDENTIALS_MISSING",
    };
  const keyId = env.CURLEC_KEY_ID!.trim();
  if (!/^[A-Za-z0-9_]{8,64}$/.test(keyId))
    return {
      provider,
      configured: false,
      sandbox,
      reason: "PAYMENT_CREDENTIALS_MISSING",
    };
  // Curlec's pages do not state key prefixes; these are the ones seen on the
  // owner's live Curlec account (Jomjual). A key from the other mode is refused.
  if (
    (sandbox && keyId.startsWith("rzp_live_")) ||
    (!sandbox && keyId.startsWith("rzp_test_"))
  )
    return {
      provider,
      configured: false,
      sandbox,
      reason: "CURLEC_KEY_MODE_MISMATCH",
    };
  const origin = publicOriginSetting(env);
  if (!origin)
    return {
      provider,
      configured: false,
      sandbox,
      reason: "PUBLIC_ORIGIN_INVALID",
    };
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.pathname !== "/")
      return {
        provider,
        configured: false,
        sandbox,
        reason: "PUBLIC_ORIGIN_INVALID",
      };
  } catch {
    return {
      provider,
      configured: false,
      sandbox,
      reason: "PUBLIC_ORIGIN_INVALID",
    };
  }
  return { provider, configured: true, sandbox, reason: null };
}

// The address the provider returns the browser to and calls back.
export function publicOrigin(env: Env = process.env) {
  return env.JOMCALL_PAYMENT_PROVIDER?.trim() === "curlec"
    ? publicOriginSetting(env)!.replace(/\/$/, "")
    : (env.LOCAL_ORIGIN ?? "http://127.0.0.1:4182");
}

export function createProvider(
  env: Env = process.env,
  send: typeof fetch = fetch,
): PaymentProvider {
  const ready = paymentReadiness(env);
  if (!ready.configured) throw Error(ready.reason ?? "PAYMENTS_DISABLED");
  if (ready.provider === "fake") return createFakeProvider(fakeSecrets);
  return createCurlecProvider(
    {
      keyId: env.CURLEC_KEY_ID!.trim(),
      keySecret: env.CURLEC_KEY_SECRET!.trim(),
      webhookSecret: env.CURLEC_WEBHOOK_SECRET!.trim(),
      sandbox: ready.sandbox,
    },
    send,
  );
}
