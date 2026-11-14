// Guards for the three run modes. `mock` and `local` keep their loopback-only
// rules; `hosted` has its own strict rules and fails closed. Every error is a
// code, optionally followed by the NAME of the variable at fault. No value of
// any variable is ever put in an error, a log line or a report.

export type Env = Record<string, string | undefined>;
export type Mode = "mock" | "local" | "hosted";

export function parseMode(value?: string): Mode {
  if (value === undefined) return "mock";
  if (value !== "mock" && value !== "local" && value !== "hosted")
    throw Error("INVALID_MODE");
  return value;
}

export const isHosted = (env: Env = process.env) =>
  env.JOMCALL_MODE === "hosted";

// Long-running workers have no mock mode: they run only as `local` or `hosted`.
export function workerMode(env: Env = process.env): "local" | "hosted" {
  const mode = env.JOMCALL_MODE;
  if (mode !== "local" && mode !== "hosted") throw Error("LOCAL_ONLY");
  return mode;
}

function ipv4(host: string): number[] | null {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!parts) return null;
  const bytes = parts.slice(1).map(Number);
  return bytes.every((b) => b <= 255) ? bytes : null;
}

// `hostname` as the URL class reports it (IPv6 literals keep their brackets).
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]" || host === "::1" || host === "[::]" || host === "::")
    return true;
  const bytes = ipv4(host);
  return bytes !== null && (bytes[0] === 127 || bytes[0] === 0);
}

// An IPv4 literal on loopback or in a private range. Names and public
// addresses are not private, and neither is the "all interfaces" address.
export function isPrivateAddress(host: string): boolean {
  const bytes = ipv4(host);
  if (!bytes) return false;
  const [a, b] = bytes;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function present(env: Env, name: string, code = name + "_REQUIRED"): string {
  const value = env[name]?.trim();
  if (!value) throw Error(`${code}: ${name}`);
  return value;
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw Error(`INVALID_URL: ${name}`);
  }
}

// --- Web origin and Supabase URL -------------------------------------------

function localHttpUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw Error("LOCAL_ORIGIN_REQUIRED");
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw Error("LOCAL_ORIGIN_REQUIRED");
  return value!;
}

function hostedHttpsUrl(env: Env, name: string): URL {
  const url = parseUrl(present(env, name), name);
  if (url.protocol !== "https:") throw Error(`HTTPS_REQUIRED: ${name}`);
  if (isLoopbackHost(url.hostname))
    throw Error(`HOSTED_LOOPBACK_REFUSED: ${name}`);
  if (url.username || url.password) throw Error(`INVALID_URL: ${name}`);
  return url;
}

// The one origin of this environment: CSRF checks, auth redirects and
// invitation links are all built from it.
export function appOrigin(env: Env = process.env): string {
  if (!isHosted(env)) return localHttpUrl(env.LOCAL_ORIGIN);
  const url = hostedHttpsUrl(env, "APP_ORIGIN");
  if (url.pathname !== "/" || url.search || url.hash)
    throw Error("INVALID_URL: APP_ORIGIN");
  return url.origin;
}

export function supabaseUrl(env: Env = process.env): string {
  if (!isHosted(env)) return localHttpUrl(env.SUPABASE_URL);
  return hostedHttpsUrl(env, "SUPABASE_URL").toString().replace(/\/$/, "");
}

// --- Database --------------------------------------------------------------

export type DatabaseConnection = {
  connectionString: string;
  ssl?: { rejectUnauthorized: true; ca?: string };
};

const SSL_PARAMETERS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslnegotiation",
  "uselibpqcompat",
];

// Local mode: the local Supabase database on 127.0.0.1:54622 and nothing else.
// Hosted mode: TLS with certificate checking, and a host that is on the list in
// JOMCALL_DATABASE_HOSTS, so a typo cannot point a service at another database.
export function databaseConnection(
  value: string | undefined,
  name: string,
  env: Env = process.env,
  localCode = "LOCAL_DATABASE_REQUIRED",
): DatabaseConnection {
  if (!isHosted(env)) {
    let url: URL;
    try {
      url = new URL(value ?? "");
    } catch {
      throw Error(localCode);
    }
    if (url.hostname !== "127.0.0.1" || url.port !== "54622")
      throw Error(localCode);
    return { connectionString: url.toString() };
  }
  if (!value?.trim()) throw Error(`HOSTED_DATABASE_URL_REQUIRED: ${name}`);
  const url = parseUrl(value.trim(), name);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    throw Error(`INVALID_URL: ${name}`);
  const expected = present(
    env,
    "JOMCALL_DATABASE_HOSTS",
    "HOSTED_DATABASE_HOSTS_REQUIRED",
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const host = url.hostname.toLowerCase();
  if (isLoopbackHost(host) || isPrivateAddress(host))
    throw Error(`HOSTED_LOOPBACK_REFUSED: ${name}`);
  if (!expected.includes(host))
    throw Error(`HOSTED_DATABASE_HOST_MISMATCH: ${name}`);
  const sslmode = url.searchParams.get("sslmode");
  const ssl = url.searchParams.get("ssl");
  if (
    (sslmode !== null &&
      !["require", "verify-ca", "verify-full"].includes(sslmode)) ||
    (ssl !== null && !["true", "1"].includes(ssl))
  )
    throw Error(`HOSTED_DATABASE_TLS_REQUIRED: ${name}`);
  // TLS is set here, not by the URL: the driver lets URL parameters override
  // an explicit setting, and some of them turn certificate checking off.
  for (const parameter of SSL_PARAMETERS) url.searchParams.delete(parameter);
  const ca = env.JOMCALL_DATABASE_CA?.trim().replace(/\\n/g, "\n");
  if (
    ca !== undefined &&
    ca !== "" &&
    !ca.includes("-----BEGIN CERTIFICATE-----")
  )
    throw Error("HOSTED_DATABASE_CA_INVALID: JOMCALL_DATABASE_CA");
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  };
}

// --- Queue namespace -------------------------------------------------------

const TEST_NAMESPACE = /^test_[a-f0-9-]{36}$/;

// `local` in local mode, `staging` or `prod` in hosted mode. A `test_<uuid>`
// namespace is legal only under the test runner, and never in hosted mode.
export function validNamespace(value: string, env: Env = process.env): string {
  const legal = isHosted(env)
    ? value === "staging" || value === "prod"
    : value === "local" ||
      (env.NODE_ENV === "test" && TEST_NAMESPACE.test(value));
  if (!legal) throw Error("INVALID_QUEUE_NAMESPACE");
  return value;
}

export function queueNamespace(env: Env = process.env): string {
  const value = env.JOMCALL_QUEUE_NAMESPACE;
  if (value === undefined || value === "") {
    if (isHosted(env))
      throw Error("QUEUE_NAMESPACE_REQUIRED: JOMCALL_QUEUE_NAMESPACE");
    return "local";
  }
  return validNamespace(value, env);
}

// --- Cookies ---------------------------------------------------------------

// Hosted names carry the `__Host-` prefix: browsers accept such a cookie only
// with Secure, Path=/ and no Domain, so a sibling subdomain cannot set it.
export function cookieNames(env: Env = process.env) {
  return isHosted(env)
    ? {
        access: "__Host-jomcall_access",
        refresh: "__Host-jomcall_refresh",
        csrf: "__Host-jomcall_csrf",
        secure: true,
      }
    : {
        access: "ca_local_access",
        refresh: "ca_local_refresh",
        csrf: "ca_local_csrf",
        secure: false,
      };
}

// --- Email -----------------------------------------------------------------

export type MailSettings = {
  transport: {
    host: string;
    port: number;
    secure: boolean;
    ignoreTLS?: boolean;
    requireTLS?: boolean;
    auth?: { user: string; pass: string };
  };
  from: string;
  messageIdDomain: string;
  subject: string;
  inviteBase: string;
};

export function mailSettings(env: Env = process.env): MailSettings {
  if (!isHosted(env)) {
    if (env.SMTP_HOST !== "127.0.0.1" || env.SMTP_PORT !== "54625")
      throw Error("LOCAL_SMTP_REQUIRED");
    return {
      transport: {
        host: "127.0.0.1",
        port: 54625,
        secure: false,
        ignoreTLS: true,
      },
      from: "JomCall <workspace@example.invalid>",
      messageIdDomain: "jomcall.local",
      subject: "Your local workspace invitation",
      inviteBase: "http://127.0.0.1:4182",
    };
  }
  const host = present(env, "SMTP_HOST");
  if (isLoopbackHost(host) || isPrivateAddress(host))
    throw Error("HOSTED_LOOPBACK_REFUSED: SMTP_HOST");
  const port = Number(present(env, "SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("INVALID_PORT: SMTP_PORT");
  const user = present(env, "SMTP_USER");
  const pass = present(env, "SMTP_PASSWORD");
  const from = present(env, "SMTP_FROM");
  if (!/^[^<>\r\n]*<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from))
    throw Error("INVALID_SENDER: SMTP_FROM");
  const origin = appOrigin(env);
  return {
    // 465 is TLS from the first byte; any other port must upgrade with STARTTLS.
    transport: {
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
    },
    from,
    messageIdDomain: new URL(origin).hostname,
    subject: "Your JomCall workspace invitation",
    inviteBase: origin,
  };
}

// --- Mail provider -----------------------------------------------------------
//
// Local mode always uses Mailpit over SMTP. Hosted mode uses SMTP (above) unless
// JOMCALL_MAIL_PROVIDER=cloudflare selects Cloudflare Email Service's REST API.

export type MailProvider = "smtp" | "cloudflare";

export function mailProvider(env: Env = process.env): MailProvider {
  const value = env.JOMCALL_MAIL_PROVIDER?.trim() || "smtp";
  if (value !== "smtp" && value !== "cloudflare")
    throw Error("INVALID_MAIL_PROVIDER: JOMCALL_MAIL_PROVIDER");
  if (value === "cloudflare" && !isHosted(env))
    throw Error("LOCAL_SMTP_REQUIRED: JOMCALL_MAIL_PROVIDER");
  return value;
}

export type CloudflareMailSettings = {
  endpoint: string;
  token: string;
  from: string;
  subject: string;
  inviteBase: string;
};

// POST /accounts/{account_id}/email/sending/send with a Bearer API token that
// has the "Email Sending: Edit" permission (Cloudflare docs, checked
// 2026-11-14). The sender's domain must be onboarded to Email Sending.
export function cloudflareMailSettings(
  env: Env = process.env,
): CloudflareMailSettings {
  if (!isHosted(env)) throw Error("LOCAL_SMTP_REQUIRED: JOMCALL_MAIL_PROVIDER");
  const account = present(env, "CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/.test(account))
    throw Error("INVALID_ACCOUNT_ID: CLOUDFLARE_ACCOUNT_ID");
  const token = present(env, "CLOUDFLARE_EMAIL_API_TOKEN");
  if (/\s/.test(token) || token.length < 20)
    throw Error("INVALID_TOKEN: CLOUDFLARE_EMAIL_API_TOKEN");
  const from = present(env, "CLOUDFLARE_EMAIL_FROM");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from))
    throw Error("INVALID_SENDER: CLOUDFLARE_EMAIL_FROM");
  return {
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
    token,
    from,
    subject: "Your JomCall workspace invitation",
    inviteBase: appOrigin(env),
  };
}

// --- Turnstile ---------------------------------------------------------------
//
// Off unless both keys are set, and never on outside hosted mode. One key
// without the other refuses to start instead of silently skipping the check.

export type TurnstileSettings = {
  siteKey: string;
  secret: string;
  hostname: string;
};

export function turnstileSettings(
  env: Env = process.env,
): TurnstileSettings | null {
  if (!isHosted(env)) return null;
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secret = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (!siteKey && !secret) return null;
  if (!siteKey) throw Error("TURNSTILE_INCOMPLETE: TURNSTILE_SITE_KEY");
  if (!secret) throw Error("TURNSTILE_INCOMPLETE: TURNSTILE_SECRET_KEY");
  return { siteKey, secret, hostname: new URL(appOrigin(env)).hostname };
}

// --- Voice turn endpoint ---------------------------------------------------

export const VOICE_PORT = 54633;
export const SERVICE_KEY_HEADER = "x-jomcall-service-key";
const SERVICE_SECRET_MIN = 32;

export type VoiceListen = {
  mode: "local" | "hosted";
  host: string;
  port: number;
  serviceSecret?: string;
};

// Local mode: 127.0.0.1 and nothing else, and no second key. Hosted mode: a
// loopback or private address from configuration (the port is never published)
// plus a service secret shared with the voice worker.
export function voiceListen(env: Env = process.env): VoiceListen {
  const bind = env.JOMCALL_VOICE_BIND?.trim();
  if (!isHosted(env)) {
    if (bind && bind !== "127.0.0.1") throw Error("LOOPBACK_REQUIRED");
    return { mode: "local", host: "127.0.0.1", port: VOICE_PORT };
  }
  if (!bind) throw Error("VOICE_BIND_REQUIRED: JOMCALL_VOICE_BIND");
  if (!isPrivateAddress(bind))
    throw Error("PRIVATE_BIND_REQUIRED: JOMCALL_VOICE_BIND");
  return {
    mode: "hosted",
    host: bind,
    port: VOICE_PORT,
    serviceSecret: serviceSecret(env),
  };
}

export function serviceSecret(env: Env = process.env): string {
  const secret = env.JOMCALL_VOICE_SERVICE_SECRET ?? "";
  if (secret.length < SERVICE_SECRET_MIN || /\s/.test(secret))
    throw Error("VOICE_SERVICE_SECRET_REQUIRED: JOMCALL_VOICE_SERVICE_SECRET");
  return secret;
}

// The LiveKit address the browser is given. Hosted mode: TLS, never loopback.
export function liveKitUrlProblem(env: Env = process.env): string | null {
  if (!isHosted(env)) return null;
  let url: URL;
  try {
    url = new URL(env.LIVEKIT_URL ?? "");
  } catch {
    return "INVALID_URL: LIVEKIT_URL";
  }
  if (url.protocol !== "wss:") return "WSS_REQUIRED: LIVEKIT_URL";
  if (isLoopbackHost(url.hostname))
    return "HOSTED_LOOPBACK_REFUSED: LIVEKIT_URL";
  return null;
}
