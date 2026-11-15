import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  signupAllow,
  signupAllowed,
} from "../../packages/contracts/src/hosting.ts";
import { issueCsrf } from "../../web/lib/server/csrf.ts";
import { handleAuth } from "../../web/lib/server/auth.ts";
import { closeServices, database } from "../../web/lib/server/services.ts";
import { dispatchCore } from "../../web/lib/server/api.ts";
import { appConfig } from "../../web/lib/server/config.ts";

// No network: the auth service is a stub that records every request, and the
// database host does not resolve, so an invitation lookup fails (closed).
const hostedEnv = {
  JOMCALL_MODE: "hosted",
  APP_ORIGIN: "https://app.example.test",
  SUPABASE_URL: "https://ref.example.test",
  SUPABASE_ANON_KEY: "anon",
  CSRF_SECRET: "c".repeat(64),
  JOMCALL_DATABASE_HOSTS: "db.invalid",
  APP_DATABASE_URL: "postgresql://jomcall_app:pw@db.invalid:6543/postgres",
  JOMCALL_QUEUE_NAMESPACE: "staging",
};
const LIST = "owner@example.test, @team.example.test";

const saved = { ...process.env };
const savedFetch = globalThis.fetch;
const savedError = console.error;
function set(values: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries({ NODE_ENV: "test", ...values }))
    if (value !== undefined) process.env[key] = value;
}
let calls: string[] = [];
beforeEach(async () => {
  await closeServices();
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = savedFetch;
  console.error = savedError;
  await closeServices();
  set(saved);
});

async function signup(email: string, ip: string) {
  const issued = issueCsrf();
  const pair = issued.headers.getSetCookie()[0].split(";")[0];
  const token = (await issued.json()).data.token as string;
  const origin = process.env.APP_ORIGIN!;
  return handleAuth(
    new Request(origin + "/api/auth/signup", {
      method: "POST",
      headers: {
        origin,
        cookie: pair,
        "x-csrf-token": token,
        "content-type": "application/json",
        "x-real-ip": ip,
      },
      body: JSON.stringify({ email, password: "password123" }),
    }),
  );
}

test("the allow-list parses addresses and whole domains, case-insensitively", () => {
  const allow = signupAllow({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: LIST })!;
  assert.ok(signupAllowed(allow, "Owner@Example.test"));
  assert.ok(signupAllowed(allow, "anyone@team.example.test"));
  assert.ok(!signupAllowed(allow, "other@example.test"));
  // A domain entry is that domain exactly: no subdomains, no suffix matches.
  assert.ok(!signupAllowed(allow, "a@sub.team.example.test"));
  assert.ok(!signupAllowed(allow, "a@evilteam.example.test"));
  assert.ok(!signupAllowed(allow, "not-an-address"));
  // Non-ASCII never matches, even when lower-casing would map it to a listed
  // address (U+212A KELVIN SIGN lower-cases to "k").
  const k = signupAllow({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: "kate@example.test" })!;
  assert.ok(signupAllowed(k, "kate@example.test"));
  assert.equal("\u212Aate@example.test".toLowerCase(), "kate@example.test");
  assert.ok(!signupAllowed(k, "\u212Aate@example.test"));
  assert.ok(!signupAllowed(allow, "owner@exämple.test"));
});

test("unset or empty means sign-up stays open", () => {
  assert.equal(signupAllow(hostedEnv), null);
  assert.equal(signupAllow({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: "  " }), null);
});

test("an invalid value fails closed and names the variable, never the value", () => {
  for (const value of [
    "owner@example.test,",
    ",",
    "example.test",
    "*@example.test",
    "@*.example.test",
    "a@@example.test",
    "a b@example.test",
    "owner@localhost",
  ])
    assert.throws(
      () => signupAllow({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: value }),
      (e: Error) =>
        e.message === "SIGNUP_ALLOW_INVALID: JOMCALL_SIGNUP_ALLOW" &&
        !e.message.includes("example"),
      value,
    );
});

test("mock and local modes ignore the setting", () => {
  for (const mode of [undefined, "mock", "local"])
    assert.equal(
      signupAllow({ JOMCALL_MODE: mode, JOMCALL_SIGNUP_ALLOW: "bad value" }),
      null,
    );
});

test("hosted sign-up: a listed address reaches the auth service", async () => {
  set({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: LIST });
  const response = await signup("owner@example.test", "198.51.100.10");
  // The stubbed auth service answers 500, so the handler reports it down.
  assert.equal(response.status, 503);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((url) => url.startsWith("https://ref.example.test/")));
});

test("hosted sign-up: another address is refused before the auth service", async () => {
  set({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: LIST });
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => logged.push(args.join(" "));
  const response = await signup("stranger@example.test", "198.51.100.11");
  console.error = savedError;
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "SIGNUP_NOT_ALLOWED");
  assert.doesNotMatch(JSON.stringify(body), /example\.test/);
  assert.equal(calls.length, 0);
  // The invitation lookup could not reach a database, so it refused.
  assert.ok(logged.includes("SIGNUP_INVITE_CHECK_FAILED"));
});

test("hosted sign-up with no list is unchanged", async () => {
  set(hostedEnv);
  const response = await signup("stranger@example.test", "198.51.100.12");
  assert.equal(response.status, 503);
  assert.ok(calls.length > 0);
});

test("hosted sign-up with an invalid list refuses everyone", async () => {
  set({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: "example.test" });
  const response = await signup("owner@example.test", "198.51.100.13");
  assert.equal(response.status, 500);
  assert.equal(calls.length, 0);
});

test("hosted sign-up: an unlisted address with a pending invitation reaches the auth service", async () => {
  set({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: LIST });
  const asked: string[] = [];
  database().signupInvited = async (email: string) => {
    asked.push(email);
    return true;
  };
  const response = await signup("invitee@example.test", "198.51.100.14");
  assert.deepEqual(asked, ["invitee@example.test"]);
  // The stubbed auth service answers 500, so the handler reports it down.
  assert.equal(response.status, 503);
  assert.ok(calls.length > 0);
});

// A signed-in, confirmed account (stubbed auth service and database) asking to
// open a workspace. The token is symmetric, so the client asks the stubbed
// auth service to vouch for it.
async function createWorkspace(email: string) {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const jwt = [
    part({ alg: "HS256", typ: "JWT" }),
    part({
      sub: "00000000-0000-4000-8000-000000000001",
      session_id: "00000000-0000-4000-8000-000000000002",
      exp: Math.floor(Date.now() / 1000) + 600,
    }),
    "c2lnbmF0dXJl",
  ].join(".");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.endsWith("/auth/v1/user"))
      return Response.json({
        id: "00000000-0000-4000-8000-000000000001",
        aud: "authenticated",
        email,
        email_confirmed_at: "2026-11-15T00:00:00Z",
      });
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  const db = database();
  const opened: string[] = [];
  db.withIdentity = (async (_identity: unknown, run: (tx: never) => unknown) =>
    run(undefined as never)) as typeof db.withIdentity;
  db.bootstrap = (async () => {
    opened.push(email);
    return { orgId: "00000000-0000-4000-8000-000000000003" };
  }) as unknown as typeof db.bootstrap;
  const issued = issueCsrf();
  const pair = issued.headers.getSetCookie()[0].split(";")[0];
  const token = (await issued.json()).data.token as string;
  const origin = process.env.APP_ORIGIN!;
  const response = await dispatchCore(
    new Request(origin + "/api/v1/organizations", {
      method: "POST",
      headers: {
        origin,
        cookie: pair + "; " + appConfig().cookies.access + "=" + jwt,
        "x-csrf-token": token,
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000004",
      },
      body: JSON.stringify({ name: "Kedai Contoh" }),
    }),
  );
  return { response, opened };
}

test("hosted workspace creation: an account not on the list is refused", async () => {
  set({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: LIST });
  const { response, opened } = await createWorkspace("stranger@example.test");
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "WORKSPACE_NOT_ALLOWED");
  assert.doesNotMatch(JSON.stringify(body), /example\.test/);
  assert.deepEqual(opened, []);
});

test("hosted workspace creation: a listed account reaches bootstrap", async () => {
  set({ ...hostedEnv, JOMCALL_SIGNUP_ALLOW: LIST });
  const { response, opened } = await createWorkspace("anyone@team.example.test");
  assert.equal(response.status, 201);
  assert.deepEqual(opened, ["anyone@team.example.test"]);
});
