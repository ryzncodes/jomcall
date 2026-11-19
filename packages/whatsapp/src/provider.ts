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

// `detail` is for the log only: Meta's code with its subcode when it sent
// one (META_100_33). It is never stored, so it is never shown to staff.
export type NumberCheck =
  | { ok: true; displayPhone: string | null }
  | { ok: false; reason: string; detail?: string };

// One template as the provider lists it. The status is the provider's own
// name, upper case; the database maps it to a local status.
export type ProviderTemplate = {
  name: string;
  language: string;
  status: string;
};

export type TemplateList =
  | { ok: true; templates: ProviderTemplate[] }
  | { ok: false; reason: string };

// The answer to subscribing the app to a business account. Meta delivers no
// webhook event for the account until the app is subscribed.
export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

// The answer to exchanging an Embedded Signup code. The token is the
// business's own; it is sealed at once and never logged.
export type CodeExchange =
  | { ok: true; accessToken: string }
  | { ok: false; reason: string; detail?: string };

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

export interface WhatsAppProvider {
  readonly name: "fake" | "cloud";
  // Embedded Signup: swaps the one-time code from Meta's popup for the
  // business's token. A code works once and for a few minutes only.
  exchangeSignupCode(input: { code: string }): Promise<CodeExchange>;
  // Embedded Signup: registers the number for the Cloud API with a six-digit
  // PIN. Never called for a number that stays on the WhatsApp Business app.
  registerNumber(input: {
    phoneNumberId: string;
    accessToken: string;
    pin: string;
  }): Promise<RegisterResult>;
  // Every template of the business account with its review status. A list
  // that could not be read in full is a failure, never a partial answer:
  // a template missing from the list counts as not at the provider. When
  // `signal` aborts (the caller's deadline), no further page is asked for.
  listTemplates(input: {
    wabaId: string;
    accessToken: string;
    signal?: AbortSignal;
  }): Promise<TemplateList>;
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
  // Subscribes the app to the business account's webhook events. Safe to
  // repeat: Meta answers success again when the app is already subscribed.
  subscribeApp(input: {
    wabaId: string;
    accessToken: string;
  }): Promise<SubscribeResult>;
}

// Public values the browser needs to open Meta's Embedded Signup popup. Both
// are identifiers, not secrets. `coexistence` asks Meta to let a business
// keep its number on the WhatsApp Business app (off unless switched on).
export type SignupSettings = {
  appId: string;
  configId: string;
  coexistence: boolean;
};

export type WhatsAppReadiness = {
  provider: WhatsAppMode;
  // True when this process has every setting it needs for the provider.
  configured: boolean;
  // Names of missing settings. Never a value.
  missing: string[];
  // Set only for the cloud provider with both signup settings present.
  signup: SignupSettings | null;
};

const metaId = /^[0-9]{5,30}$/;

export function signupCoexistence(env: Env = process.env): boolean {
  return env.WHATSAPP_SIGNUP_COEXISTENCE?.trim() === "1";
}

// Null when either value is missing or malformed: the button is then not
// offered and the pasted-values form remains the only way to connect.
export function signupSettings(env: Env = process.env): SignupSettings | null {
  const appId = env.WHATSAPP_APP_ID?.trim() ?? "",
    configId = env.WHATSAPP_SIGNUP_CONFIG_ID?.trim() ?? "";
  if (!metaId.test(appId) || !metaId.test(configId)) return null;
  return { appId, configId, coexistence: signupCoexistence(env) };
}

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
      signup: null,
    };
  }
  if (provider === "disabled")
    return {
      provider,
      configured: false,
      missing: ["JOMCALL_WHATSAPP_PROVIDER"],
      signup: null,
    };
  const missing: string[] = [];
  if ((env.WHATSAPP_APP_SECRET ?? "").length < 16)
    missing.push("WHATSAPP_APP_SECRET");
  if ((env.WHATSAPP_VERIFY_TOKEN ?? "").length < 16)
    missing.push("WHATSAPP_VERIFY_TOKEN");
  if (provider === "cloud" && !hex64.test(env.WHATSAPP_CREDENTIALS_KEY ?? ""))
    missing.push("WHATSAPP_CREDENTIALS_KEY");
  const configured = missing.length === 0;
  return {
    provider,
    configured,
    missing,
    signup: configured && provider === "cloud" ? signupSettings(env) : null,
  };
}
