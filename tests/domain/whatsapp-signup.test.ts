// Embedded Signup: the popup's messages, the settings that offer the button,
// the sealed one-time code and the Cloud client's two signup calls (against a
// fake fetch only; nothing here reaches Meta).
import test from "node:test";
import assert from "node:assert/strict";
import {
  readSignupMessage,
  signupLoginOptions,
  signupOrigin,
} from "../../web/lib/core/whatsapp-signup.ts";
import {
  openCredentials,
  openSignupCode,
  sealCredentials,
  signupSettings,
  whatsappReadiness,
} from "../../packages/whatsapp/src/index.ts";
import {
  createCloudProvider,
  graphVersion,
} from "../../packages/whatsapp/src/cloud.ts";
import { channelSignup } from "../../packages/contracts/src/whatsapp.ts";

const fb = "https://www.facebook.com";
const finish = {
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH",
  data: {
    phone_number_id: "100000001",
    waba_id: "200000001",
    business_id: "300000001",
  },
};

test("only facebook.com may post a signup event", () => {
  assert.equal(signupOrigin("https://www.facebook.com"), true);
  assert.equal(signupOrigin("https://web.facebook.com"), true);
  assert.equal(signupOrigin("https://facebook.com"), true);
  assert.equal(signupOrigin("http://www.facebook.com"), false);
  assert.equal(signupOrigin("https://facebook.com.evil.example.test"), false);
  assert.equal(signupOrigin("https://notfacebook.com"), false);
  assert.equal(signupOrigin("null"), false);
  assert.equal(readSignupMessage("https://evil.example.test", finish), null);
});

test("a finished popup yields both IDs; anything else connects nothing", () => {
  assert.deepEqual(readSignupMessage(fb, finish), {
    kind: "finish",
    phoneNumberId: "100000001",
    wabaId: "200000001",
    coexistence: false,
  });
  // Meta posts a JSON string; some browsers hand over the parsed object.
  assert.deepEqual(readSignupMessage(fb, JSON.stringify(finish)), {
    kind: "finish",
    phoneNumberId: "100000001",
    wabaId: "200000001",
    coexistence: false,
  });
  assert.deepEqual(
    readSignupMessage(fb, {
      ...finish,
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    }),
    {
      kind: "finish",
      phoneNumberId: "100000001",
      wabaId: "200000001",
      coexistence: true,
    },
  );
  assert.deepEqual(readSignupMessage(fb, { ...finish, event: "CANCEL" }), {
    kind: "cancel",
  });
  assert.deepEqual(readSignupMessage(fb, { ...finish, event: "ERROR" }), {
    kind: "error",
  });
  // A finish without a usable ID is an error, never a half connection.
  assert.deepEqual(
    readSignupMessage(fb, { ...finish, data: { waba_id: "200000001" } }),
    { kind: "error" },
  );
  assert.deepEqual(
    readSignupMessage(fb, {
      ...finish,
      data: { phone_number_id: "1; drop", waba_id: "200000001" },
    }),
    { kind: "error" },
  );
  assert.equal(readSignupMessage(fb, "not json"), null);
  assert.equal(readSignupMessage(fb, { type: "SOMETHING_ELSE" }), null);
  assert.equal(readSignupMessage(fb, null), null);
});

test("the popup is asked for a code, and for coexistence only when switched on", () => {
  assert.deepEqual(
    signupLoginOptions({ configId: "400000001", coexistence: false }),
    {
      config_id: "400000001",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, sessionInfoVersion: "3" },
    },
  );
  assert.equal(
    signupLoginOptions({ configId: "400000001", coexistence: true }).extras
      .featureType,
    "whatsapp_business_app_onboarding",
  );
});

const cloudEnv = {
  JOMCALL_WHATSAPP_PROVIDER: "cloud",
  WHATSAPP_APP_SECRET: "s".repeat(32),
  WHATSAPP_VERIFY_TOKEN: "v".repeat(32),
  WHATSAPP_CREDENTIALS_KEY: "a".repeat(64),
};

test("the button is offered only for the cloud provider with both identifiers", () => {
  assert.equal(whatsappReadiness(cloudEnv).signup, null);
  assert.equal(
    whatsappReadiness({ ...cloudEnv, WHATSAPP_APP_ID: "500000001" }).signup,
    null,
  );
  assert.deepEqual(
    whatsappReadiness({
      ...cloudEnv,
      WHATSAPP_APP_ID: "500000001",
      WHATSAPP_SIGNUP_CONFIG_ID: "400000001",
    }).signup,
    { appId: "500000001", configId: "400000001", coexistence: false },
  );
  assert.equal(
    whatsappReadiness({
      ...cloudEnv,
      WHATSAPP_APP_ID: "500000001",
      WHATSAPP_SIGNUP_CONFIG_ID: "400000001",
      WHATSAPP_SIGNUP_COEXISTENCE: "1",
    }).signup?.coexistence,
    true,
  );
  // Never in practice mode: Meta's script must not load on a local machine.
  assert.equal(
    whatsappReadiness({
      ...cloudEnv,
      JOMCALL_WHATSAPP_PROVIDER: "fake",
      WHATSAPP_APP_ID: "500000001",
      WHATSAPP_SIGNUP_CONFIG_ID: "400000001",
    }).signup,
    null,
  );
  // Not while the provider is half configured.
  assert.equal(
    whatsappReadiness({
      ...cloudEnv,
      WHATSAPP_CREDENTIALS_KEY: "",
      WHATSAPP_APP_ID: "500000001",
      WHATSAPP_SIGNUP_CONFIG_ID: "400000001",
    }).signup,
    null,
  );
  assert.equal(
    signupSettings({
      WHATSAPP_APP_ID: "abc",
      WHATSAPP_SIGNUP_CONFIG_ID: "400000001",
    }),
    null,
  );
});

test("a sealed signup code is not a token, and a sealed token is not a code", () => {
  const key = "b".repeat(64),
    org = "11111111-1111-4111-8111-111111111111";
  const code = sealCredentials({ signupCode: "one-time" }, key, org);
  assert.equal(openSignupCode(code, key, org), "one-time");
  assert.throws(
    () => openCredentials(code, key, org),
    /WHATSAPP_CREDENTIALS_INVALID/,
  );
  const token = sealCredentials({ accessToken: "t", pin: "012345" }, key, org);
  assert.deepEqual(openCredentials(token, key, org), {
    accessToken: "t",
    pin: "012345",
  });
  assert.throws(
    () => openSignupCode(token, key, org),
    /WHATSAPP_CREDENTIALS_INVALID/,
  );
  // A malformed PIN is dropped, not trusted.
  assert.deepEqual(
    openCredentials(
      sealCredentials({ accessToken: "t", pin: "12" }, key, org),
      key,
      org,
    ),
    { accessToken: "t" },
  );
  // Another organization cannot open it.
  assert.throws(
    () => openSignupCode(code, key, "22222222-2222-4222-8222-222222222222"),
    /WHATSAPP_CREDENTIALS_INVALID/,
  );
});

test("the signup request takes the two IDs and a code and nothing else", () => {
  const ok = {
    phoneNumberId: "100000001",
    wabaId: "200000001",
    code: "c",
    agentEnabled: true,
  };
  assert.equal(channelSignup.safeParse(ok).success, true);
  assert.equal(
    channelSignup.safeParse({ ...ok, coexistence: true, expectedRevision: 3 })
      .success,
    true,
  );
  assert.equal(channelSignup.safeParse({ ...ok, code: "" }).success, false);
  assert.equal(
    channelSignup.safeParse({ ...ok, code: "x".repeat(2049) }).success,
    false,
  );
  assert.equal(
    channelSignup.safeParse({ ...ok, phoneNumberId: "12ab" }).success,
    false,
  );
  assert.equal(
    channelSignup.safeParse({ ...ok, accessToken: "t" }).success,
    false,
  );
});

test("cloud code exchange sends the documented request and never accepts a half answer", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  let reply: Response = Response.json({
    access_token: "business-token",
    token_type: "bearer",
  });
  const env = {
    JOMCALL_WHATSAPP_PROVIDER: "cloud",
    WHATSAPP_APP_ID: "500000001",
    WHATSAPP_APP_SECRET: "s".repeat(32),
  };
  const client = createCloudProvider({
    env,
    send: async (url, init) => {
      seen.push({ url: String(url), init });
      return reply;
    },
  });
  assert.deepEqual(await client.exchangeSignupCode({ code: "abc 123" }), {
    ok: true,
    accessToken: "business-token",
  });
  const url = new URL(seen[0].url);
  assert.equal(
    url.origin + url.pathname,
    `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
  );
  assert.equal(url.searchParams.get("client_id"), "500000001");
  assert.equal(url.searchParams.get("client_secret"), "s".repeat(32));
  assert.equal(url.searchParams.get("code"), "abc 123");
  assert.equal(seen[0].init?.method, undefined);

  reply = Response.json(
    { error: { code: 100, error_subcode: 36007 } },
    { status: 400 },
  );
  assert.deepEqual(await client.exchangeSignupCode({ code: "spent" }), {
    ok: false,
    reason: "SIGNUP_CODE_REJECTED",
    detail: "META_100_36007",
  });
  reply = Response.json({ token_type: "bearer" });
  assert.deepEqual(await client.exchangeSignupCode({ code: "c" }), {
    ok: false,
    reason: "SIGNUP_CODE_REJECTED",
  });
  reply = new Response("bad gateway", { status: 502 });
  assert.deepEqual(await client.exchangeSignupCode({ code: "c" }), {
    ok: false,
    reason: "PROVIDER_UNREACHABLE",
  });

  // Without the app ID or secret nothing is sent at all.
  const before = seen.length;
  const bare = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async (url, init) => {
      seen.push({ url: String(url), init });
      return reply;
    },
  });
  assert.deepEqual(await bare.exchangeSignupCode({ code: "c" }), {
    ok: false,
    reason: "SIGNUP_NOT_CONFIGURED",
  });
  assert.equal(seen.length, before);

  const down = createCloudProvider({
    env,
    send: async () => {
      throw Error("network");
    },
  });
  assert.deepEqual(await down.exchangeSignupCode({ code: "c" }), {
    ok: false,
    reason: "PROVIDER_UNREACHABLE",
  });
});

test("cloud number registration sends the PIN and succeeds only on success:true", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let reply: Response = Response.json({ success: true });
  const client = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return reply;
    },
  });
  const target = {
    phoneNumberId: "100000001",
    accessToken: "business-token",
    pin: "012345",
  };
  assert.deepEqual(await client.registerNumber(target), { ok: true });
  assert.equal(
    seen[0].url,
    `https://graph.facebook.com/${graphVersion}/100000001/register`,
  );
  assert.equal(seen[0].init.method, "POST");
  assert.equal(
    (seen[0].init.headers as Record<string, string>).authorization,
    "Bearer business-token",
  );
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), {
    messaging_product: "whatsapp",
    pin: "012345",
  });

  reply = Response.json({ error: { code: 133005 } }, { status: 400 });
  assert.equal((await client.registerNumber(target)).ok, false);
  assert.equal(
    ((await client.registerNumber(target)) as { reason: string }).reason,
    "REGISTER_FAILED",
  );
  reply = Response.json({ success: false });
  assert.deepEqual(await client.registerNumber(target), {
    ok: false,
    reason: "REGISTER_FAILED",
  });
  const calls = seen.length;
  assert.deepEqual(await client.registerNumber({ ...target, pin: "12345" }), {
    ok: false,
    reason: "INVALID_TARGET",
  });
  assert.equal(seen.length, calls);
});
