import { createBillplzProvider } from "./billplz.ts";
import { createFakeProvider, fakeSignatureKey } from "./fake.ts";

// A result reported by a payment provider, after its signature was checked.
export type ProviderResult = {
  providerRef: string;
  // One key per distinct provider event; a replay carries the same key.
  eventKey: string;
  paid: boolean;
  amountSen: number | null;
  currency: string;
  paidAt: Date | null;
};
export type CheckoutInput = {
  topupId: string;
  amountSen: number;
  description: string;
  payerName: string;
  payerEmail: string;
  callbackUrl: string;
  redirectUrl: string;
};
export interface PaymentProvider {
  readonly name: "fake" | "billplz";
  readonly sandbox: boolean;
  createCheckout(
    input: CheckoutInput,
  ): Promise<{ providerRef: string; checkoutUrl: string }>;
  // Asks the provider for the current state. Never trusted over a signed
  // callback for crediting unless it reports paid with the exact amount.
  getPayment(providerRef: string): Promise<ProviderResult>;
  // Parses and verifies a callback body. Throws BAD_SIGNATURE or
  // INVALID_CALLBACK; never returns an unverified result.
  parseCallback(body: string, contentType: string | null): ProviderResult;
}

type Env = Record<string, string | undefined>;
export type PaymentReadiness = {
  provider: "disabled" | "fake" | "billplz";
  configured: boolean;
  sandbox: boolean;
  reason: string | null;
};

const billplzNames = [
  "BILLPLZ_API_KEY",
  "BILLPLZ_X_SIGNATURE_KEY",
  "BILLPLZ_COLLECTION_ID",
] as const;

// The public address Billplz calls back. Hosted mode uses its APP_ORIGIN
// unless JOMCALL_PUBLIC_ORIGIN overrides it.
function publicOriginSetting(env: Env): string | undefined {
  const own = env.JOMCALL_PUBLIC_ORIGIN?.trim();
  if (own) return own;
  return env.JOMCALL_MODE === "hosted" ? env.APP_ORIGIN?.trim() || undefined : undefined;
}

// Off unless JOMCALL_PAYMENT_PROVIDER says otherwise. No network call and
// no key value leaves this function.
export function paymentReadiness(env: Env = process.env): PaymentReadiness {
  const provider = env.JOMCALL_PAYMENT_PROVIDER ?? "disabled";
  if (provider === "disabled")
    return { provider, configured: false, sandbox: true, reason: "PAYMENTS_DISABLED" };
  if (provider === "fake")
    return env.JOMCALL_MODE === "local"
      ? { provider, configured: true, sandbox: true, reason: null }
      : { provider, configured: false, sandbox: true, reason: "FAKE_PROVIDER_LOCAL_ONLY" };
  if (provider !== "billplz")
    return { provider: "disabled", configured: false, sandbox: true, reason: "PAYMENT_PROVIDER_UNKNOWN" };
  const environment = env.BILLPLZ_ENVIRONMENT ?? "sandbox";
  const sandbox = environment !== "production";
  if (!["sandbox", "production"].includes(environment))
    return { provider, configured: false, sandbox, reason: "BILLPLZ_ENVIRONMENT_INVALID" };
  if (billplzNames.some((n) => !env[n]?.trim()))
    return { provider, configured: false, sandbox, reason: "PAYMENT_CREDENTIALS_MISSING" };
  const originSetting = publicOriginSetting(env);
  if (!originSetting)
    return { provider, configured: false, sandbox, reason: "PUBLIC_ORIGIN_INVALID" };
  try {
    const origin = new URL(originSetting);
    if (origin.protocol !== "https:" || origin.pathname !== "/")
      return { provider, configured: false, sandbox, reason: "PUBLIC_ORIGIN_INVALID" };
  } catch {
    return { provider, configured: false, sandbox, reason: "PUBLIC_ORIGIN_INVALID" };
  }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(env.BILLPLZ_COLLECTION_ID!))
    return { provider, configured: false, sandbox, reason: "PAYMENT_CREDENTIALS_MISSING" };
  return { provider, configured: true, sandbox, reason: null };
}

// The address the provider calls back and the browser returns to.
export function publicOrigin(env: Env = process.env) {
  return env.JOMCALL_PAYMENT_PROVIDER === "billplz"
    ? publicOriginSetting(env)!.replace(/\/$/, "")
    : (env.LOCAL_ORIGIN ?? "http://127.0.0.1:4182");
}

export function createProvider(
  env: Env = process.env,
  send: typeof fetch = fetch,
): PaymentProvider {
  const ready = paymentReadiness(env);
  if (!ready.configured) throw Error(ready.reason ?? "PAYMENTS_DISABLED");
  if (ready.provider === "fake")
    return createFakeProvider({ key: fakeSignatureKey, origin: publicOrigin(env) });
  return createBillplzProvider(
    {
      apiKey: env.BILLPLZ_API_KEY!,
      signatureKey: env.BILLPLZ_X_SIGNATURE_KEY!,
      collectionId: env.BILLPLZ_COLLECTION_ID!,
      sandbox: ready.sandbox,
    },
    send,
  );
}
