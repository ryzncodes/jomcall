// Every setting a hosted service reads, which service reads it, and whether it
// is a secret. `infra/hosted/.env.hosted.example` must list exactly these names
// (a test checks both directions). The readiness report below checks them with
// the same guard functions the services use, and reports names and codes only.
import {
  appOrigin,
  databaseConnection,
  isLoopbackHost,
  cloudflareMailSettings,
  liveKitUrlProblem,
  mailProvider,
  mailSettings,
  queueNamespace,
  serviceSecret,
  supabaseUrl,
  turnstileSettings,
  voiceListen,
  type Env,
} from "./hosting.ts";

export const SERVICES = [
  "web",
  "engine",
  "agent",
  "voice",
  "livekit",
  "caddy",
  "release",
  "backup",
] as const;
export type Service = (typeof SERVICES)[number];

export type Setting = {
  name: string;
  services: Service[];
  secret: boolean;
  // Absent: always required. A function: required only when it returns true.
  required?: false | ((env: Env) => boolean);
  description: string;
};

const voiceOn = (env: Env) => env.JOMCALL_VOICE_PROVIDER === "hosted";
const cloudflareMail = (env: Env) =>
  env.JOMCALL_MAIL_PROVIDER?.trim() === "cloudflare";
const smtpMail = (env: Env) => !cloudflareMail(env);

export const SETTINGS: Setting[] = [
  // --- Shared -------------------------------------------------------------
  {
    name: "JOMCALL_MODE",
    services: ["web", "engine", "agent", "voice"],
    secret: false,
    description:
      "Run mode: hosted for staging and production (Vercel previews stay mock)",
  },
  {
    name: "JOMCALL_QUEUE_NAMESPACE",
    services: ["web", "engine", "agent"],
    secret: false,
    description: "Queue label: staging or prod",
  },
  {
    name: "JOMCALL_DATABASE_HOSTS",
    services: ["web", "engine", "agent", "release", "backup"],
    secret: false,
    description:
      "Comma-separated database host names this environment may connect to",
  },
  {
    name: "JOMCALL_DATABASE_CA",
    services: ["web", "engine", "agent", "release", "backup"],
    secret: false,
    required: false,
    description:
      "Optional PEM certificate of the database's certificate authority (\\n for newlines)",
  },
  // --- Web (Vercel) ---------------------------------------------------------
  {
    name: "APP_ORIGIN",
    services: ["web", "engine"],
    secret: false,
    description:
      "The one https origin of this environment, e.g. https://app.example.com",
  },
  {
    name: "SUPABASE_URL",
    services: ["web"],
    secret: false,
    description: "https URL of the Supabase project",
  },
  {
    name: "SUPABASE_ANON_KEY",
    services: ["web"],
    secret: true,
    description: "Supabase anonymous (publishable) key; server-side only here",
  },
  {
    name: "APP_DATABASE_URL",
    services: ["web"],
    secret: true,
    description: "jomcall_app login through the transaction pooler",
  },
  {
    name: "CSRF_SECRET",
    services: ["web"],
    secret: true,
    description: "At least 32 random characters; signs CSRF tokens",
  },
  {
    name: "INVITATION_KEY",
    services: ["web", "engine"],
    secret: true,
    description: "64 hex characters; encrypts invitation tokens until mailed",
  },
  {
    name: "JOMCALL_MODEL_PROVIDER",
    services: ["web", "agent"],
    secret: false,
    description: "disabled or openrouter (typed agent tests)",
  },
  {
    name: "JOMCALL_HOSTED_MODEL",
    services: ["web", "agent"],
    secret: false,
    required: false,
    description: "Optional hosted model ID; web and agent must agree",
  },
  {
    name: "JOMCALL_VOICE_PROVIDER",
    services: ["web", "agent"],
    secret: false,
    description: "disabled or hosted (browser voice tests)",
  },
  {
    name: "LIVEKIT_URL",
    services: ["web", "voice"],
    secret: false,
    required: (env) => voiceOn(env) || env.JOMCALL_MODE === "hosted",
    description:
      "web: public wss:// address; voice: internal ws://livekit:7880",
  },
  {
    name: "LIVEKIT_API_KEY",
    services: ["web", "voice"],
    secret: false,
    required: (env) => voiceOn(env) || env.JOMCALL_MODE === "hosted",
    description: "LiveKit API key name (matches LIVEKIT_KEYS)",
  },
  {
    name: "LIVEKIT_API_SECRET",
    services: ["web", "voice"],
    secret: true,
    required: (env) => voiceOn(env) || env.JOMCALL_MODE === "hosted",
    description: "LiveKit API secret (matches LIVEKIT_KEYS)",
  },
  {
    name: "TURNSTILE_SITE_KEY",
    services: ["web"],
    secret: false,
    required: false,
    description:
      "Optional Cloudflare Turnstile site key for sign-up and login; set both Turnstile keys or neither",
  },
  {
    name: "TURNSTILE_SECRET_KEY",
    services: ["web"],
    secret: true,
    required: false,
    description:
      "Optional Turnstile secret key, verified server-side; set both Turnstile keys or neither",
  },
  // --- Payments (not approved yet; leave JOMCALL_PAYMENT_PROVIDER empty) ---
  {
    name: "JOMCALL_PAYMENT_PROVIDER",
    services: ["web"],
    secret: false,
    required: false,
    description:
      "Optional payment provider: empty or disabled (default) or billplz; fake is refused outside local mode",
  },
  {
    name: "BILLPLZ_ENVIRONMENT",
    services: ["web"],
    secret: false,
    required: false,
    description: "Optional Billplz environment: sandbox (default) or production",
  },
  {
    name: "BILLPLZ_API_KEY",
    services: ["web"],
    secret: true,
    required: (env) => env.JOMCALL_PAYMENT_PROVIDER === "billplz",
    description: "Billplz API secret key (only when JOMCALL_PAYMENT_PROVIDER=billplz)",
  },
  {
    name: "BILLPLZ_X_SIGNATURE_KEY",
    services: ["web"],
    secret: true,
    required: (env) => env.JOMCALL_PAYMENT_PROVIDER === "billplz",
    description: "Billplz X Signature key for callbacks (only when JOMCALL_PAYMENT_PROVIDER=billplz)",
  },
  {
    name: "BILLPLZ_COLLECTION_ID",
    services: ["web"],
    secret: false,
    required: (env) => env.JOMCALL_PAYMENT_PROVIDER === "billplz",
    description: "Billplz collection ID (only when JOMCALL_PAYMENT_PROVIDER=billplz)",
  },
  {
    name: "JOMCALL_PUBLIC_ORIGIN",
    services: ["web"],
    secret: false,
    required: false,
    description: "Optional https origin Billplz calls back; defaults to APP_ORIGIN in hosted mode",
  },
  // --- Engine -------------------------------------------------------------
  {
    name: "WORKER_DATABASE_URL",
    services: ["engine"],
    secret: true,
    description: "jomcall_worker login, session connection",
  },
  {
    name: "QUEUE_DATABASE_URL",
    services: ["engine", "agent"],
    secret: true,
    description:
      "jomcall_queue login, session connection (never the transaction pooler)",
  },
  {
    name: "JOMCALL_MAIL_PROVIDER",
    services: ["engine"],
    secret: false,
    required: false,
    description:
      "Optional: smtp (default) or cloudflare (Cloudflare Email Service REST API)",
  },
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    services: ["engine", "backup"],
    secret: false,
    required: (env) => cloudflareMail(env) || env.BACKUP_ENABLED === "1",
    description:
      "32-hex Cloudflare account ID (email sending and the R2 endpoint)",
  },
  {
    name: "CLOUDFLARE_EMAIL_API_TOKEN",
    services: ["engine"],
    secret: true,
    required: cloudflareMail,
    description:
      'API token with only "Email Sending: Edit" (when JOMCALL_MAIL_PROVIDER=cloudflare)',
  },
  {
    name: "CLOUDFLARE_EMAIL_FROM",
    services: ["engine"],
    secret: false,
    required: cloudflareMail,
    description:
      "Sender address on the onboarded domain, e.g. hello@example.com (when cloudflare)",
  },
  {
    name: "SMTP_HOST",
    services: ["engine"],
    secret: false,
    required: smtpMail,
    description: "Email provider SMTP host (when JOMCALL_MAIL_PROVIDER=smtp)",
  },
  {
    name: "SMTP_PORT",
    services: ["engine"],
    secret: false,
    required: smtpMail,
    description: "465 (TLS) or 587 (STARTTLS)",
  },
  {
    name: "SMTP_USER",
    services: ["engine"],
    secret: false,
    required: smtpMail,
    description: "SMTP login name",
  },
  {
    name: "SMTP_PASSWORD",
    services: ["engine"],
    secret: true,
    required: smtpMail,
    description: "SMTP password or API key",
  },
  {
    name: "SMTP_FROM",
    services: ["engine"],
    secret: false,
    required: smtpMail,
    description: "Sender, e.g. JomCall <hello@example.com> (SPF/DKIM set up)",
  },
  // --- Agent --------------------------------------------------------------
  {
    name: "AGENT_DATABASE_URL",
    services: ["agent"],
    secret: true,
    description: "jomcall_agent login, session connection",
  },
  {
    name: "OPENROUTER_API_KEY",
    services: ["agent"],
    secret: true,
    required: (env) => env.JOMCALL_MODEL_PROVIDER === "openrouter",
    description:
      "Typed-test model key (when JOMCALL_MODEL_PROVIDER=openrouter)",
  },
  {
    name: "ANTHROPIC_API_KEY",
    services: ["agent"],
    secret: true,
    required: voiceOn,
    description: "Spoken-path model key (when JOMCALL_VOICE_PROVIDER=hosted)",
  },
  {
    name: "JOMCALL_VOICE_BIND",
    services: ["agent"],
    secret: false,
    required: voiceOn,
    description: "Agent container's own private address, e.g. 172.30.0.10",
  },
  {
    name: "JOMCALL_VOICE_SERVICE_SECRET",
    services: ["agent", "voice"],
    secret: true,
    required: voiceOn,
    description: "At least 32 random characters, same value in agent and voice",
  },
  // --- Voice worker -------------------------------------------------------
  {
    name: "JOMCALL_VOICE_TURN_URL",
    services: ["voice"],
    secret: false,
    description:
      "Agent turn endpoint on the private network, e.g. http://172.30.0.10:54633",
  },
  {
    name: "DEEPGRAM_API_KEY",
    services: ["voice"],
    secret: true,
    description: "Speech to text key",
  },
  {
    name: "GOOGLE_CLOUD_API_KEY",
    services: ["voice"],
    secret: true,
    description: "Text to speech key",
  },
  {
    name: "JOMCALL_VOICE_CACHE_DIR",
    services: ["voice"],
    secret: false,
    required: false,
    description: "Filler audio cache directory (set by Compose to a volume)",
  },
  {
    name: "JOMCALL_VOICE_STAGES_DIR",
    services: ["voice"],
    secret: false,
    required: false,
    description: "Stage timing directory (set by Compose to a volume)",
  },
  // --- LiveKit and proxy --------------------------------------------------
  {
    name: "LIVEKIT_KEYS",
    services: ["livekit"],
    secret: true,
    description: '"<api key>: <api secret>" for the LiveKit server',
  },
  {
    name: "LIVEKIT_DOMAIN",
    services: ["caddy"],
    secret: false,
    description:
      "Public host name for LiveKit, e.g. livekit.example.com (DNS A record to the server)",
  },
  {
    name: "ACME_EMAIL",
    services: ["caddy"],
    secret: false,
    description: "Email Caddy gives the certificate authority",
  },
  // --- Release job (migration runner, owner only) -------------------------
  {
    name: "HOSTED_TARGET",
    services: ["release", "backup"],
    secret: false,
    description:
      "staging or prod; must equal the --target given to the migration runner or backup job",
  },
  {
    name: "HOSTED_ADMIN_DATABASE_URL",
    services: ["release"],
    secret: true,
    description:
      "postgres admin login, session connection; never given to a service",
  },
  {
    name: "HOSTED_APP_PASSWORD",
    services: ["release"],
    secret: true,
    description: "64 hex characters for jomcall_app",
  },
  {
    name: "HOSTED_WORKER_PASSWORD",
    services: ["release"],
    secret: true,
    description: "64 hex characters for jomcall_worker",
  },
  {
    name: "HOSTED_QUEUE_PASSWORD",
    services: ["release"],
    secret: true,
    description: "64 hex characters for jomcall_queue",
  },
  {
    name: "HOSTED_AGENT_PASSWORD",
    services: ["release"],
    secret: true,
    description: "64 hex characters for jomcall_agent",
  },
  // --- Backup job (nightly encrypted dump to R2, owner's host) ------------
  {
    name: "BACKUP_ENABLED",
    services: ["backup"],
    secret: false,
    description: "1 to allow the backup job to run (anything else refuses)",
  },
  {
    name: "BACKUP_DATABASE_URL",
    services: ["backup"],
    secret: true,
    description:
      "Login that may read every table (session connection, TLS); never given to a service",
  },
  {
    name: "BACKUP_ENCRYPTION_KEY",
    services: ["backup"],
    secret: true,
    description:
      "64 hex characters; AES-256-GCM key, kept offline too: without it no dump can be restored",
  },
  {
    name: "R2_BUCKET",
    services: ["backup"],
    secret: false,
    description: "R2 bucket name for dumps, e.g. jomcall-backups-staging",
  },
  {
    name: "R2_ACCESS_KEY_ID",
    services: ["backup"],
    secret: false,
    description:
      "R2 API token Access Key ID (Object Read & Write, this bucket only)",
  },
  {
    name: "R2_SECRET_ACCESS_KEY",
    services: ["backup"],
    secret: true,
    description: "R2 API token Secret Access Key",
  },
];

// Values docker-compose.yml sets itself, per service, so they are not in the
// env files. `--compose` applies them before checking. A test keeps this and
// the Compose file equal.
export const COMPOSE_ENVIRONMENT: Partial<Record<Service, Env>> = {
  agent: { JOMCALL_MODE: "hosted", JOMCALL_VOICE_BIND: "172.30.0.10" },
  engine: { JOMCALL_MODE: "hosted" },
  voice: {
    JOMCALL_MODE: "hosted",
    JOMCALL_VOICE_TURN_URL: "http://172.30.0.10:54633",
    LIVEKIT_URL: "ws://livekit:7880",
  },
};

export type Finding = { name: string; code: string };

function attempt(
  findings: Finding[],
  fallbackName: string,
  run: () => unknown,
) {
  try {
    run();
  } catch (error) {
    // Guard errors are "CODE" or "CODE: NAME"; anything else is reported by
    // the setting's name alone, so no foreign message can carry a value.
    const message = error instanceof Error ? error.message : "";
    const match = /^([A-Z_]+)(?:: ([A-Z_]+))?$/.exec(message);
    findings.push(
      match
        ? { name: match[2] ?? fallbackName, code: match[1] }
        : { name: fallbackName, code: "INVALID" },
    );
  }
}

// Names what is missing or wrong for one service. Never returns a value.
export function readiness(service: Service, env: Env): Finding[] {
  const findings: Finding[] = [];
  const hostedEnv = { ...env, JOMCALL_MODE: "hosted" };
  if (
    ["web", "engine", "agent", "voice"].includes(service) &&
    env.JOMCALL_MODE !== "hosted"
  )
    findings.push({ name: "JOMCALL_MODE", code: "HOSTED_MODE_REQUIRED" });
  for (const s of SETTINGS) {
    if (!s.services.includes(service) || s.name === "JOMCALL_MODE") continue;
    const needed =
      s.required === undefined
        ? true
        : s.required === false
          ? false
          : s.required(hostedEnv);
    if (needed && !env[s.name]?.trim())
      findings.push({ name: s.name, code: "MISSING" });
  }
  const missing = new Set(findings.map((f) => f.name));
  const check = (name: string, run: () => unknown) => {
    if (!missing.has(name)) attempt(findings, name, run);
  };
  const database = (name: string) =>
    check(name, () => databaseConnection(env[name], name, hostedEnv));
  const hex64 = (name: string) =>
    check(name, () => {
      if (!/^[a-f0-9]{64}$/.test(env[name] ?? ""))
        throw Error("INVALID_SECRET");
    });
  if (["web", "engine", "agent"].includes(service))
    check("JOMCALL_QUEUE_NAMESPACE", () => queueNamespace(hostedEnv));
  if (service === "web") {
    check("TURNSTILE_SITE_KEY", () => turnstileSettings(hostedEnv));
    check("APP_ORIGIN", () => appOrigin(hostedEnv));
    check("SUPABASE_URL", () => supabaseUrl(hostedEnv));
    database("APP_DATABASE_URL");
    check("CSRF_SECRET", () => {
      if ((env.CSRF_SECRET ?? "").length < 32) throw Error("SECRET_TOO_SHORT");
    });
    hex64("INVITATION_KEY");
    check("LIVEKIT_URL", () => {
      const problem = liveKitUrlProblem(hostedEnv);
      if (problem) throw Error(problem);
    });
  }
  if (service === "engine") {
    database("WORKER_DATABASE_URL");
    database("QUEUE_DATABASE_URL");
    hex64("INVITATION_KEY");
    attempt(findings, "JOMCALL_MAIL_PROVIDER", () => {
      if (mailProvider(hostedEnv) === "cloudflare") {
        if (
          ![
            "CLOUDFLARE_ACCOUNT_ID",
            "CLOUDFLARE_EMAIL_API_TOKEN",
            "CLOUDFLARE_EMAIL_FROM",
            "APP_ORIGIN",
          ].some((n) => missing.has(n))
        )
          cloudflareMailSettings(hostedEnv);
      } else if (
        ![
          "SMTP_HOST",
          "SMTP_PORT",
          "SMTP_USER",
          "SMTP_PASSWORD",
          "SMTP_FROM",
          "APP_ORIGIN",
        ].some((n) => missing.has(n))
      )
        mailSettings(hostedEnv);
    });
  }
  if (service === "agent") {
    database("AGENT_DATABASE_URL");
    database("QUEUE_DATABASE_URL");
    if (voiceOn(env)) {
      check("JOMCALL_VOICE_BIND", () =>
        voiceListen({
          ...hostedEnv,
          JOMCALL_VOICE_SERVICE_SECRET: "x".repeat(32),
        }),
      );
      check("JOMCALL_VOICE_SERVICE_SECRET", () => serviceSecret(hostedEnv));
    }
  }
  if (service === "voice") {
    check("JOMCALL_VOICE_SERVICE_SECRET", () => serviceSecret(hostedEnv));
    check("JOMCALL_VOICE_TURN_URL", () => {
      const url = new URL(env.JOMCALL_VOICE_TURN_URL ?? "");
      if (
        url.protocol === "http:" &&
        !/^(10|127|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(url.hostname)
      )
        throw Error("PRIVATE_OR_HTTPS_REQUIRED");
      if (url.protocol === "https:" && isLoopbackHost(url.hostname))
        throw Error("PRIVATE_OR_HTTPS_REQUIRED");
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw Error("PRIVATE_OR_HTTPS_REQUIRED");
    });
  }
  if (service === "livekit")
    check("LIVEKIT_KEYS", () => {
      if (!/^[A-Za-z0-9]{3,}: ?\S{32,}$/.test(env.LIVEKIT_KEYS ?? ""))
        throw Error("INVALID_KEYS_FORMAT");
    });
  if (service === "release") {
    check("HOSTED_TARGET", () => {
      if (!["staging", "prod"].includes(env.HOSTED_TARGET ?? ""))
        throw Error("INVALID_TARGET");
    });
    database("HOSTED_ADMIN_DATABASE_URL");
    for (const name of [
      "HOSTED_APP_PASSWORD",
      "HOSTED_WORKER_PASSWORD",
      "HOSTED_QUEUE_PASSWORD",
      "HOSTED_AGENT_PASSWORD",
    ])
      hex64(name);
  }
  if (service === "backup") {
    check("BACKUP_ENABLED", () => {
      if (env.BACKUP_ENABLED !== "1") throw Error("BACKUP_DISABLED");
    });
    check("HOSTED_TARGET", () => {
      if (!["staging", "prod"].includes(env.HOSTED_TARGET ?? ""))
        throw Error("INVALID_TARGET");
    });
    database("BACKUP_DATABASE_URL");
    hex64("BACKUP_ENCRYPTION_KEY");
    check("CLOUDFLARE_ACCOUNT_ID", () => {
      if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""))
        throw Error("INVALID_ACCOUNT_ID");
    });
    check("R2_BUCKET", () => {
      // R2 bucket names: lowercase letters, digits and hyphens, 3-63 long.
      if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET ?? ""))
        throw Error("INVALID_BUCKET");
    });
  }
  return findings;
}
