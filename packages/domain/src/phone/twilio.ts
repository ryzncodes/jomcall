// Twilio phone numbers, for the operator's provisioning command only. It
// spends money (a number bills monthly until released), so nothing here runs
// from the web app or on its own: an operator runs scripts/hosted/
// phone-provision.ts by hand. Requests go to api.twilio.com with an API key
// (never the account's auth token); errors carry Twilio's numeric code and
// HTTP status only, never a credential or a response body.
import { isE164 } from "./numbers.ts";

export type TwilioSettings = {
  accountSid: string;
  keySid: string;
  keySecret: string;
  // The approved regulatory bundle and its address, and the SIP trunk every
  // number is attached to at purchase.
  bundleSid: string;
  addressSid: string;
  trunkSid: string;
  // The most numbers this account may hold through this command.
  maxNumbers: number;
};

type Env = Record<string, string | undefined>;
const shapes: [keyof TwilioSettings & string, string, RegExp][] = [
  ["accountSid", "TWILIO_ACCOUNT_SID", /^AC[0-9a-f]{32}$/],
  ["keySid", "TWILIO_API_KEY_SID", /^SK[0-9a-f]{32}$/],
  ["keySecret", "TWILIO_API_KEY_SECRET", /^\S{16,128}$/],
  ["bundleSid", "TWILIO_BUNDLE_SID", /^BU[0-9a-f]{32}$/],
  ["addressSid", "TWILIO_ADDRESS_SID", /^AD[0-9a-f]{32}$/],
  ["trunkSid", "TWILIO_TRUNK_SID", /^TK[0-9a-f]{32}$/],
];

// Names what is missing or malformed by variable name, never by value.
export function twilioSettings(env: Env = process.env): TwilioSettings {
  const out: Record<string, unknown> = {};
  const bad: string[] = [];
  for (const [key, name, shape] of shapes) {
    const value = env[name] ?? "";
    if (!shape.test(value)) bad.push(name);
    out[key] = value;
  }
  const raw = env.TWILIO_MAX_NUMBERS ?? "5";
  const max = Number(raw);
  if (!Number.isInteger(max) || max < 1 || max > 100)
    bad.push("TWILIO_MAX_NUMBERS");
  if (bad.length) throw Error("TWILIO_SETTINGS_INVALID: " + bad.join(", "));
  return { ...(out as Omit<TwilioSettings, "maxNumbers">), maxNumbers: max };
}

export type AvailableNumber = { e164: string; locality: string | null };
export type OwnedNumber = {
  sid: string;
  e164: string;
  trunkSid: string | null;
};

export class TwilioError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(`TWILIO_${step}_FAILED status=${status} code=${code ?? "none"}`);
  }
}

export type TwilioNumbers = {
  available(options?: {
    contains?: string;
    limit?: number;
  }): Promise<AvailableNumber[]>;
  owned(): Promise<OwnedNumber[]>;
  buy(e164: string, label: string): Promise<OwnedNumber>;
  release(sid: string): Promise<void>;
};

export function twilioNumbers(
  settings: TwilioSettings,
  fetcher: typeof fetch = fetch,
): TwilioNumbers {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${settings.accountSid}`;
  const auth =
    "Basic " +
    Buffer.from(`${settings.keySid}:${settings.keySecret}`).toString("base64");
  async function call(
    step: string,
    method: string,
    path: string,
    form?: Record<string, string>,
  ) {
    const response = await fetcher(base + path, {
      method,
      headers: {
        authorization: auth,
        ...(form
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 204) return null;
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      // A body that is not JSON is treated as no body.
    }
    if (!response.ok)
      throw new TwilioError(
        step,
        response.status,
        Number.isInteger(body?.code) ? body.code : null,
      );
    return body;
  }
  const owned = (row: any): OwnedNumber => ({
    sid: String(row.sid),
    e164: String(row.phone_number),
    trunkSid: row.trunk_sid ? String(row.trunk_sid) : null,
  });
  return {
    async available({ contains, limit = 10 } = {}) {
      const query = new URLSearchParams({
        VoiceEnabled: "true",
        Beta: "false",
        PageSize: String(Math.min(Math.max(limit, 1), 30)),
      });
      if (contains) query.set("Contains", contains);
      const body = await call(
        "SEARCH",
        "GET",
        `/AvailablePhoneNumbers/MY/Local.json?${query}`,
      );
      return (body?.available_phone_numbers ?? [])
        .filter((row: any) => isE164(row?.phone_number))
        .map((row: any) => ({
          e164: row.phone_number as string,
          locality:
            typeof row.locality === "string" && row.locality
              ? row.locality
              : null,
        }));
    },
    async owned() {
      const body = await call(
        "LIST",
        "GET",
        "/IncomingPhoneNumbers.json?PageSize=200",
      );
      return (body?.incoming_phone_numbers ?? []).map(owned);
    },
    async buy(e164, label) {
      if (!isE164(e164)) throw Error("INVALID_PHONE_NUMBER");
      // TrunkSid at purchase attaches the number to the SIP trunk at once;
      // Twilio then ignores any voice URL on the number.
      return owned(
        await call("BUY", "POST", "/IncomingPhoneNumbers.json", {
          PhoneNumber: e164,
          BundleSid: settings.bundleSid,
          AddressSid: settings.addressSid,
          TrunkSid: settings.trunkSid,
          FriendlyName: label.slice(0, 64),
        }),
      );
    },
    async release(sid) {
      if (!/^PN[0-9a-f]{32}$/.test(sid)) throw Error("INVALID_NUMBER_SID");
      await call("RELEASE", "DELETE", `/IncomingPhoneNumbers/${sid}.json`);
    },
  };
}
