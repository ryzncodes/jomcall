// The WhatsApp provider port and the switch that selects an implementation.
//
// JOMCALL_WHATSAPP_PROVIDER selects one of:
//   disabled (default)  nothing is received, nothing is sent
//   fake                in-memory provider; no network; for tests and the
//                       local simulator
//   cloud               Meta's WhatsApp Business Platform Cloud API. This is
//                       an outbound call to a hosted service and needs the
//                       owner's approval before it is turned on.
// Any other value is an error, never a silent fallback.

type Env = Record<string, string | undefined>;

export type WhatsAppMode = "disabled" | "fake" | "cloud";

export function whatsappMode(env: Env = process.env): WhatsAppMode {
  const value = env.JOMCALL_WHATSAPP_PROVIDER ?? "disabled";
  if (value !== "disabled" && value !== "fake" && value !== "cloud")
    throw Error("WHATSAPP_PROVIDER_UNKNOWN");
  return value;
}

// "unknown" means the request may or may not have reached the provider. Such
// a message goes to a person for review and is never sent again by itself.
export type SendOutcome =
  | { outcome: "sent"; providerMessageId: string }
  | { outcome: "failed"; code: string }
  | { outcome: "unknown" };

export type SendTarget = {
  phoneNumberId: string;
  accessToken: string;
  // The customer's WhatsApp ID: country code and number, digits only.
  to: string;
};

export type TemplateMessage = {
  name: string;
  language: string;
  variables: string[];
};

export type NumberCheck =
  | { ok: true; displayPhone: string | null }
  | { ok: false; reason: string };

export interface WhatsAppProvider {
  readonly name: "fake" | "cloud";
  sendText(target: SendTarget, body: string): Promise<SendOutcome>;
  sendTemplate(
    target: SendTarget,
    template: TemplateMessage,
  ): Promise<SendOutcome>;
  // Proves that the stored token controls the stored phone number.
  verifyNumber(target: {
    phoneNumberId: string;
    accessToken: string;
  }): Promise<NumberCheck>;
}

export type WhatsAppReadiness = {
  provider: WhatsAppMode;
  // True when this process has every setting it needs for the provider.
  configured: boolean;
  // Names of missing settings. Never a value.
  missing: string[];
};

const hex64 = /^[a-f0-9]{64}$/;

// What the web process needs: it verifies webhooks and encrypts credentials.
// It never needs, and must not hold, a way to call Meta.
export function whatsappReadiness(env: Env = process.env): WhatsAppReadiness {
  let provider: WhatsAppMode;
  try {
    provider = whatsappMode(env);
  } catch {
    return {
      provider: "disabled",
      configured: false,
      missing: ["JOMCALL_WHATSAPP_PROVIDER"],
    };
  }
  if (provider === "disabled")
    return {
      provider,
      configured: false,
      missing: ["JOMCALL_WHATSAPP_PROVIDER"],
    };
  const missing: string[] = [];
  if ((env.WHATSAPP_APP_SECRET ?? "").length < 16)
    missing.push("WHATSAPP_APP_SECRET");
  if ((env.WHATSAPP_VERIFY_TOKEN ?? "").length < 16)
    missing.push("WHATSAPP_VERIFY_TOKEN");
  if (provider === "cloud" && !hex64.test(env.WHATSAPP_CREDENTIALS_KEY ?? ""))
    missing.push("WHATSAPP_CREDENTIALS_KEY");
  return { provider, configured: missing.length === 0, missing };
}
