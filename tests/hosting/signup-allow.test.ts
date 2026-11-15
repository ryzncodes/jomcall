import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  signupAllow,
  signupAllowed,
} from "../../packages/contracts/src/hosting.ts";
import { issueCsrf } from "../../web/lib/server/csrf.ts";
import { handleAuth } from "../../web/lib/server/auth.ts";
import { closeServices } from "../../web/lib/server/services.ts";

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
