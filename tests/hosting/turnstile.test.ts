import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { turnstileSettings } from "../../packages/contracts/src/hosting.ts";
import {
  SITEVERIFY_URL,
  verifyTurnstile,
} from "../../packages/contracts/src/turnstile.ts";
import { issueCsrf } from "../../web/lib/server/csrf.ts";
import { handleAuth } from "../../web/lib/server/auth.ts";
import { closeServices } from "../../web/lib/server/services.ts";
import { turnstileSiteKey } from "../../web/lib/server/config.ts";

// No network: every outbound request goes to a stub that records it.
const ORIGIN = "https://app.example.test";
const SECRET = "SECRETTURNSTILEVALUE";
const KEYS = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: SECRET };
const hostedEnv = {
  JOMCALL_MODE: "hosted",
  APP_ORIGIN: ORIGIN,
  SUPABASE_URL: "https://ref.example.test",
  SUPABASE_ANON_KEY: "anon",
  CSRF_SECRET: "c".repeat(64),
  JOMCALL_DATABASE_HOSTS: "db.example.test",
  APP_DATABASE_URL: "postgresql://jomcall_app:pw@db.example.test:6543/postgres",
  JOMCALL_QUEUE_NAMESPACE: "staging",
};
const localEnv = {
  JOMCALL_MODE: "local",
  LOCAL_ORIGIN: "http://127.0.0.1:4182",
  SUPABASE_URL: "http://127.0.0.1:54621",
  SUPABASE_ANON_KEY: "anon",
  CSRF_SECRET: "c".repeat(64),
  APP_DATABASE_URL: "postgresql://jomcall_app:pw@127.0.0.1:54622/postgres",
};

const saved = { ...process.env };
const savedFetch = globalThis.fetch;
function set(values: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries({ NODE_ENV: "test", ...values }))
    if (value !== undefined) process.env[key] = value;
}
type Call = { url: string; body: string };
let calls: Call[] = [];
let siteverify: () => Response;
beforeEach(async () => {
  await closeServices();
  calls = [];
  siteverify = () =>
    Response.json({
      success: true,
      hostname: "app.example.test",
      action: "login",
    });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url === SITEVERIFY_URL) return siteverify();
    // Anything else is the auth service: answer "unavailable".
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = savedFetch;
  await closeServices();
  set(saved);
});

const settings = {
  siteKey: "site-key",
  secret: SECRET,
  hostname: "app.example.test",
};
const fakeFetch =
  (respond: () => Response | Promise<Response>, seen: Call[] = []) =>
  async (url: string, init: RequestInit) => {
    seen.push({ url, body: String(init.body) });
    return respond();
  };

test("Turnstile is off outside hosted mode and off without keys", () => {
  assert.equal(turnstileSettings({ JOMCALL_MODE: "mock", ...KEYS }), null);
  assert.equal(turnstileSettings({ ...localEnv, ...KEYS }), null);
  assert.equal(turnstileSettings(hostedEnv), null);
  assert.deepEqual(turnstileSettings({ ...hostedEnv, ...KEYS }), settings);
});

test("one Turnstile key without the other fails closed and names only the variable", () => {
  for (const [env, name] of [
    [{ TURNSTILE_SITE_KEY: "site-key" }, "TURNSTILE_SECRET_KEY"],
    [{ TURNSTILE_SECRET_KEY: SECRET }, "TURNSTILE_SITE_KEY"],
  ] as const)
    assert.throws(
      () => turnstileSettings({ ...hostedEnv, ...env }),
      (e: Error) =>
        e.message === `TURNSTILE_INCOMPLETE: ${name}` &&
        !e.message.includes(SECRET),
    );
});

test("siteverify gets secret, token and client address; success needs hostname and action", async () => {
  const seen: Call[] = [];
  await verifyTurnstile(
    settings,
    { token: "tok", action: "login", remoteip: "203.0.113.9" },
    fakeFetch(
      () =>
        Response.json({
          success: true,
          hostname: "app.example.test",
          action: "login",
        }),
      seen,
    ),
  );
  assert.equal(seen[0].url, SITEVERIFY_URL);
  const body = new URLSearchParams(seen[0].body);
  assert.equal(body.get("secret"), SECRET);
  assert.equal(body.get("response"), "tok");
  assert.equal(body.get("remoteip"), "203.0.113.9");
});

test("siteverify failures of every kind are rejected", async () => {
  const cases: [unknown, () => Response | Promise<Response>][] = [
    [
      "tok",
      () =>
        Response.json({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
    ],
    [
      "tok",
      () =>
        Response.json({
          success: true,
          hostname: "evil.example.test",
          action: "login",
        }),
    ],
    [
      "tok",
      () =>
        Response.json({
          success: true,
          hostname: "app.example.test",
          action: "signup",
        }),
    ],
    ["tok", () => new Response("not json", { status: 200 })],
    ["tok", () => new Response("{}", { status: 503 })],
    ["tok", () => Promise.reject(new TypeError("network"))],
    ["", () => Response.json({ success: true })],
    [undefined, () => Response.json({ success: true })],
    [42, () => Response.json({ success: true })],
    ["x".repeat(2049), () => Response.json({ success: true })],
  ];
  for (const [token, respond] of cases)
    await assert.rejects(
      verifyTurnstile(settings, { token, action: "login" }, fakeFetch(respond)),
      /^Error: TURNSTILE_FAILED$/,
    );
});

async function login(body: object, ip: string, path = "login") {
  const issued = issueCsrf();
  const pair = issued.headers.getSetCookie()[0].split(";")[0];
  const token = (await issued.json()).data.token as string;
  const origin = new URL(process.env.APP_ORIGIN ?? process.env.LOCAL_ORIGIN!)
    .origin;
  return handleAuth(
    new Request(origin + "/api/auth/" + path, {
      method: "POST",
      headers: {
        origin,
        cookie: pair,
        "x-csrf-token": token,
        "content-type": "application/json",
        "x-real-ip": ip,
      },
      body: JSON.stringify(body),
    }),
  );
}
const credentials = { email: "owner@example.test", password: "password123" };

test("hosted login and sign-up without a valid token stop before the auth service", async () => {
  set({ ...hostedEnv, ...KEYS });
  for (const path of ["login", "signup"]) {
    calls = [];
    const missing = await login(credentials, "198.51.100.1", path);
    assert.equal(missing.status, 403);
    assert.equal((await missing.json()).error.code, "VERIFICATION_FAILED");
    assert.equal(calls.length, 0);
  }
  siteverify = () => Response.json({ success: false });
  const bad = await login(
    { ...credentials, turnstileToken: "tok" },
    "198.51.100.2",
  );
  assert.equal(bad.status, 403);
  assert.deepEqual(
    calls.map((c) => c.url),
    [SITEVERIFY_URL],
  );
});

test("hosted login with a valid token reaches the auth service", async () => {
  set({ ...hostedEnv, ...KEYS });
  const ok = await login(
    { ...credentials, turnstileToken: "tok" },
    "198.51.100.3",
  );
  // The stubbed auth service answers 500, so the handler reports it down.
  assert.equal(ok.status, 503);
  assert.equal(calls[0].url, SITEVERIFY_URL);
  assert.ok(
    calls.slice(1).every((c) => c.url.startsWith("https://ref.example.test/")),
  );
  assert.ok(calls.length > 1);
});

test("a half-configured Turnstile refuses every hosted sign-in", async () => {
  set({ ...hostedEnv, TURNSTILE_SITE_KEY: "site-key" });
  const response = await login(
    { ...credentials, turnstileToken: "tok" },
    "198.51.100.4",
  );
  assert.equal(response.status, 500);
  assert.equal(calls.length, 0);
  assert.equal(turnstileSiteKey(), undefined);
});

test("local mode ignores Turnstile keys and tokens entirely", async () => {
  set({ ...localEnv, ...KEYS });
  assert.equal(turnstileSiteKey(), undefined);
  await login({ ...credentials, turnstileToken: "tok" }, "198.51.100.5");
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c.url !== SITEVERIFY_URL));
});
