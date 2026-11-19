// Pure parts of Meta's Embedded Signup popup, kept apart from the screen so
// they can be tested: which window messages count, and what the popup is
// asked for.

export type SignupSession =
  | {
      kind: "finish";
      phoneNumberId: string;
      wabaId: string;
      coexistence: boolean;
    }
  | { kind: "cancel" }
  | { kind: "error" }
  | null;

const id = /^[0-9]{5,30}$/;

// Meta posts the popup's session events to this window from facebook.com.
// Anything else (another origin, another shape) is not a signup event.
export function signupOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (url.hostname === "facebook.com" ||
        url.hostname.endsWith(".facebook.com"))
    );
  } catch {
    return false;
  }
}

export function readSignupMessage(
  origin: string,
  data: unknown,
): SignupSession {
  if (!signupOrigin(origin)) return null;
  let value: any = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (
    !value ||
    typeof value !== "object" ||
    value.type !== "WA_EMBEDDED_SIGNUP"
  )
    return null;
  const event = String(value.event ?? "");
  if (event === "CANCEL") return { kind: "cancel" };
  if (event === "ERROR") return { kind: "error" };
  if (
    event === "FINISH" ||
    event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
  ) {
    const phoneNumberId = String(value.data?.phone_number_id ?? ""),
      wabaId = String(value.data?.waba_id ?? "");
    // Without both IDs there is nothing to connect.
    if (!id.test(phoneNumberId) || !id.test(wabaId)) return { kind: "error" };
    return {
      kind: "finish",
      phoneNumberId,
      wabaId,
      coexistence: event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    };
  }
  return null;
}

// What FB.login is asked for. UNCONFIRMED AGAINST META: written from Meta's
// Embedded Signup pages as read on 2026-11-19.
export function signupLoginOptions(settings: {
  configId: string;
  coexistence: boolean;
}) {
  return {
    config_id: settings.configId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      setup: {},
      ...(settings.coexistence
        ? { featureType: "whatsapp_business_app_onboarding" }
        : {}),
      sessionInfoVersion: "3",
    },
  };
}

export type SignupResult = {
  phoneNumberId: string;
  wabaId: string;
  coexistence: boolean;
  code: string;
};
export type SignupProblem = "cancelled" | "meta";

// One popup attempt. The popup answers twice, in either order: a window
// message with the IDs and the login callback with the code. Both are needed
// and the pair is submitted once. A code with no IDs after `waitMs` is given
// up; anything that arrives after an attempt ended is ignored, so a late
// message can never submit behind an error the owner has already seen.
export function signupCollector(options: {
  submit(result: SignupResult): void;
  problem(kind: SignupProblem): void;
  timer?: {
    set(fire: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
  waitMs?: number;
}) {
  const timer = options.timer ?? {
    set: (fire: () => void, ms: number) => setTimeout(fire, ms),
    clear: (handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let active = false;
  let session: SignupSession = null;
  let code: string | null = null;
  let handle: unknown;
  const end = () => {
    active = false;
    if (handle !== undefined) timer.clear(handle);
    handle = undefined;
  };
  const attempt = () => {
    if (!active || !code || session?.kind !== "finish") return;
    const result = {
      phoneNumberId: session.phoneNumberId,
      wabaId: session.wabaId,
      coexistence: session.coexistence,
      code,
    };
    end();
    options.submit(result);
  };
  return {
    // A new attempt forgets everything from the one before.
    start() {
      end();
      active = true;
      session = null;
      code = null;
    },
    message(read: SignupSession) {
      if (!active || !read) return;
      session = read;
      attempt();
    },
    // The login callback: a code, or nothing when the window was closed.
    callback(value: string | null | undefined) {
      if (!active) return;
      if (!value) {
        const kind = session?.kind === "error" ? "meta" : "cancelled";
        end();
        options.problem(kind);
        return;
      }
      code = value;
      attempt();
      if (!active) return;
      handle = timer.set(() => {
        handle = undefined;
        if (!active) return;
        end();
        options.problem("meta");
      }, options.waitMs ?? 4000);
    },
    stop: end,
    get waiting() {
      return active;
    },
  };
}
