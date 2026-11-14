import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { appConfig, requireApp } from "../../web/lib/server/config.ts";
import { issueCsrf, requireMutation } from "../../web/lib/server/csrf.ts";
import { handleAuth } from "../../web/lib/server/auth.ts";
import { dispatchCore } from "../../web/lib/server/api.ts";
import { database, closeServices } from "../../web/lib/server/services.ts";
import { handleHealth } from "../../web/lib/server/health.ts";

// No database and no network: every case stops at a guard.
const saved = { ...process.env };
const ORIGIN = "https://app.example.test";
function set(values: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries({ NODE_ENV: "test", ...values }))
    if (value !== undefined) process.env[key] = value;
}
const hosted = (extra: Record<string, string | undefined> = {}) =>
  set({
    JOMCALL_MODE: "hosted",
    APP_ORIGIN: ORIGIN,
    SUPABASE_URL: "https://ref.example.test",
    SUPABASE_ANON_KEY: "anon",
    CSRF_SECRET: "c".repeat(64),
    JOMCALL_DATABASE_HOSTS: "db.example.test",
    APP_DATABASE_URL:
      "postgresql://jomcall_app:pw@db.example.test:6543/postgres",
    JOMCALL_QUEUE_NAMESPACE: "staging",
    ...extra,
  });
const local = (extra: Record<string, string | undefined> = {}) =>
  set({
    JOMCALL_MODE: "local",
    LOCAL_ORIGIN: "http://127.0.0.1:4182",
    SUPABASE_URL: "http://127.0.0.1:54621",
    SUPABASE_ANON_KEY: "anon",
    CSRF_SECRET: "c".repeat(64),
    APP_DATABASE_URL: "postgresql://jomcall_app:pw@127.0.0.1:54622/postgres",
    ...extra,
  });
beforeEach(closeServices);
after(async () => {
  await closeServices();
  set(saved);
});

async function csrfPair() {
  const issued = issueCsrf();
  const cookie = issued.headers.getSetCookie()[0];
  return {
    cookie,
    pair: cookie.split(";")[0],
    token: (await issued.json()).data.token as string,
  };
}
const post = (origin: string | null, pair: string, token: string) =>
  new Request(ORIGIN + "/api/auth/login", {
    method: "POST",
    headers: {
      ...(origin === null ? {} : { origin }),
      cookie: pair,
      "x-csrf-token": token,
      "content-type": "application/json",
    },
    body: "{}",
  });

test("mock mode has no application API; local and hosted do", () => {
  set({ JOMCALL_MODE: "mock" });
  assert.throws(requireApp, /CAPABILITY_UNAVAILABLE/);
  set({});
  assert.throws(requireApp, /CAPABILITY_UNAVAILABLE/);
  local();
  requireApp();
  hosted();
  requireApp();
  set({ JOMCALL_MODE: "production" });
  assert.throws(requireApp, /INVALID_MODE/);
});

test("local mode still refuses a non-loopback origin or Supabase URL", () => {
  local();
  assert.equal(appConfig().origin, "http://127.0.0.1:4182");
  assert.equal(appConfig().hosted, false);
  local({ LOCAL_ORIGIN: ORIGIN });
  assert.throws(appConfig, /LOCAL_ORIGIN_REQUIRED/);
  local({ LOCAL_ORIGIN: undefined, APP_ORIGIN: ORIGIN });
  assert.throws(appConfig, /LOCAL_ORIGIN_REQUIRED/);
  local({ SUPABASE_URL: "https://ref.example.test" });
  assert.throws(appConfig, /LOCAL_ORIGIN_REQUIRED/);
  local({
    APP_DATABASE_URL:
      "postgresql://u:pw@db.example.test:5432/postgres?sslmode=require",
  });
  assert.throws(database, /LOCAL_DATABASE_REQUIRED/);
});

test("hosted mode refuses plain http, loopback and missing settings", () => {
  hosted();
  assert.equal(appConfig().origin, ORIGIN);
  assert.equal(appConfig().hosted, true);
  hosted({ APP_ORIGIN: "http://app.example.test" });
  assert.throws(appConfig, /HTTPS_REQUIRED: APP_ORIGIN/);
  hosted({ APP_ORIGIN: "https://127.0.0.1:4182" });
  assert.throws(appConfig, /HOSTED_LOOPBACK_REFUSED: APP_ORIGIN/);
  hosted({ APP_ORIGIN: undefined, LOCAL_ORIGIN: "http://127.0.0.1:4182" });
  assert.throws(appConfig, /APP_ORIGIN_REQUIRED/);
  hosted({ SUPABASE_URL: "http://127.0.0.1:54621" });
  assert.throws(appConfig, /HTTPS_REQUIRED: SUPABASE_URL/);
  hosted({ SUPABASE_ANON_KEY: undefined });
  assert.throws(appConfig, /SUPABASE_ANON_KEY_REQUIRED/);
  hosted({
    APP_DATABASE_URL: "postgresql://jomcall_app:pw@127.0.0.1:54622/postgres",
  });
  assert.throws(database, /HOSTED_LOOPBACK_REFUSED: APP_DATABASE_URL/);
  hosted({
    APP_DATABASE_URL:
      "postgresql://u:pw@db.example.test:5432/postgres?sslmode=disable",
  });
  assert.throws(database, /HOSTED_DATABASE_TLS_REQUIRED/);
  hosted({ JOMCALL_DATABASE_HOSTS: undefined });
  assert.throws(database, /HOSTED_DATABASE_HOSTS_REQUIRED/);
});

test("hosted cookies are Secure and __Host- prefixed; local cookies are unchanged", async () => {
  hosted();
  const h = await csrfPair();
  assert.match(
    h.cookie,
    /^__Host-jomcall_csrf=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure$/,
  );
  local();
  const l = await csrfPair();
  assert.match(
    l.cookie,
    /^ca_local_csrf=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=86400$/,
  );
});

test("hosted mutations need the configured origin exactly", async () => {
  hosted();
  const { pair, token } = await csrfPair();
  requireMutation(post(ORIGIN, pair, token));
  for (const origin of [
    null,
    "http://app.example.test",
    "https://app.example.test:8443",
    "https://evil.example.test",
    "https://app.example.test.evil.test",
    "http://127.0.0.1:4182",
    "null",
  ])
    assert.throws(
      () => requireMutation(post(origin, pair, token)),
      /CSRF_REJECTED/,
    );
  assert.throws(
    () => requireMutation(post(ORIGIN, pair, "0".repeat(64))),
    /CSRF_REJECTED/,
  );
  // A local-mode cookie name is not accepted in hosted mode.
  assert.throws(
    () =>
      requireMutation(
        post(
          ORIGIN,
          pair.replace("__Host-jomcall_csrf", "ca_local_csrf"),
          token,
        ),
      ),
    /CSRF_REJECTED/,
  );
});

test("local mutations still need the loopback origin exactly", async () => {
  local();
  const { pair, token } = await csrfPair();
  requireMutation(post("http://127.0.0.1:4182", pair, token));
  for (const origin of [
    ORIGIN,
    "http://localhost:4182",
    "http://127.0.0.1:4181",
  ])
    assert.throws(
      () => requireMutation(post(origin, pair, token)),
      /CSRF_REJECTED/,
    );
});

test("the confirmation redirect goes to the configured origin, whatever the request host says", async () => {
  hosted();
  // An unreachable Supabase URL: the handler must fail closed, not redirect.
  const response = await handleAuth(
    new Request(
      "https://evil.example.test/api/auth/confirm?token_hash=" + "a".repeat(40),
      {
        headers: { host: "evil.example.test" },
      },
    ),
  );
  assert.ok(response.status >= 400);
  assert.equal(response.headers.get("location"), null);
});

test("a broken hosted setting is an error, never mock data", async () => {
  hosted({ APP_ORIGIN: "http://app.example.test" });
  const auth = await handleAuth(new Request(ORIGIN + "/api/auth/csrf"));
  assert.equal(auth.status, 500);
  assert.deepEqual((await auth.json()).error.code, "INTERNAL_ERROR");
  const api = await dispatchCore(new Request(ORIGIN + "/api/v1/session"));
  assert.ok(api.status === 401 || api.status === 500);
  assert.equal((await api.json()).ok, false);
  set({ JOMCALL_MODE: "mock" });
  assert.equal(
    (await dispatchCore(new Request(ORIGIN + "/api/v1/session"))).status,
    503,
  );
});

test("the health route reports mode and database without naming any value", async () => {
  set({ JOMCALL_MODE: "mock" });
  const mock = await handleHealth();
  assert.equal(mock.status, 200);
  assert.deepEqual(await mock.json(), { ok: true, mode: "mock" });
  // Hosted, with a database that cannot be reached: 503 and no detail.
  hosted({
    APP_DATABASE_URL: "postgresql://jomcall_app:pw@db.example.test:1/postgres",
  });
  const down = await handleHealth();
  assert.equal(down.status, 503);
  const text = await down.text();
  assert.deepEqual(JSON.parse(text), {
    ok: false,
    mode: "hosted",
    database: false,
  });
  assert.doesNotMatch(text, /example\.test|pw|jomcall_app/);
  hosted({ APP_ORIGIN: undefined });
  const broken = await handleHealth();
  assert.equal(broken.status, 503);
  assert.deepEqual(await broken.json(), {
    ok: false,
    mode: "hosted",
    database: false,
  });
});
