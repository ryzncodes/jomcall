import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cloudflareMailSettings,
  mailProvider,
} from "../../packages/contracts/src/hosting.ts";
import {
  CloudflareSender,
  createMailSender,
  FakeSender,
  SmtpSender,
} from "../../engine/src/mail.ts";

// No network: the Cloudflare sender gets a recording fake instead of fetch.
const TOKEN = "SUPERSECRETTOKENVALUE123";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const hosted = {
  JOMCALL_MODE: "hosted",
  APP_ORIGIN: "https://app.example.test",
  JOMCALL_MAIL_PROVIDER: "cloudflare",
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  CLOUDFLARE_EMAIL_API_TOKEN: TOKEN,
  CLOUDFLARE_EMAIL_FROM: "hello@example.test",
};
const local = {
  JOMCALL_MODE: "local",
  LOCAL_ORIGIN: "http://127.0.0.1:4182",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "54625",
};
const mail = {
  to: "invitee@example.test",
  subject: "Your JomCall workspace invitation",
  text: "Join your workspace: https://app.example.test/invite?token=t",
  operationId: "11111111-1111-4111-8111-111111111111",
};

test("the mail provider defaults to SMTP, and local mode cannot pick Cloudflare", () => {
  assert.equal(mailProvider(local), "smtp");
  assert.equal(mailProvider({ ...hosted, JOMCALL_MAIL_PROVIDER: "" }), "smtp");
  assert.equal(mailProvider(hosted), "cloudflare");
  assert.throws(
    () => mailProvider({ ...local, JOMCALL_MAIL_PROVIDER: "cloudflare" }),
    /^Error: LOCAL_SMTP_REQUIRED: JOMCALL_MAIL_PROVIDER$/,
  );
  assert.throws(
    () => mailProvider({ ...hosted, JOMCALL_MAIL_PROVIDER: "sendgrid" }),
    /INVALID_MAIL_PROVIDER: JOMCALL_MAIL_PROVIDER/,
  );
  assert.ok(createMailSender(local) instanceof SmtpSender);
  assert.ok(createMailSender(hosted) instanceof CloudflareSender);
});

test("Cloudflare settings need every value and never echo one", () => {
  const s = cloudflareMailSettings(hosted);
  assert.equal(
    s.endpoint,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`,
  );
  assert.equal(s.inviteBase, "https://app.example.test");
  for (const [name, value, code] of [
    ["CLOUDFLARE_ACCOUNT_ID", undefined, "CLOUDFLARE_ACCOUNT_ID_REQUIRED"],
    ["CLOUDFLARE_ACCOUNT_ID", "not-an-id", "INVALID_ACCOUNT_ID"],
    [
      "CLOUDFLARE_EMAIL_API_TOKEN",
      undefined,
      "CLOUDFLARE_EMAIL_API_TOKEN_REQUIRED",
    ],
    ["CLOUDFLARE_EMAIL_API_TOKEN", "short", "INVALID_TOKEN"],
    ["CLOUDFLARE_EMAIL_FROM", "JomCall <hello@example.test>", "INVALID_SENDER"],
    ["APP_ORIGIN", "http://app.example.test", "HTTPS_REQUIRED"],
  ] as const)
    assert.throws(
      () => cloudflareMailSettings({ ...hosted, [name]: value }),
      (e: Error) =>
        e.message.startsWith(code) &&
        e.message.endsWith(name) &&
        !e.message.includes(TOKEN),
      name,
    );
  assert.throws(
    () => cloudflareMailSettings({ ...hosted, JOMCALL_MODE: "local" }),
    /LOCAL_SMTP_REQUIRED/,
  );
});

type Seen = { url: string; init: RequestInit };
const recorder =
  (respond: () => Response | Promise<Response>, seen: Seen[] = []) =>
  async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return respond();
  };
const ok = () =>
  Response.json({
    success: true,
    errors: [],
    messages: [],
    result: { delivered: [mail.to], permanent_bounces: [], queued: [] },
  });

test("the Cloudflare sender posts the documented JSON with a Bearer token", async () => {
  const seen: Seen[] = [];
  await new CloudflareSender(
    cloudflareMailSettings(hosted),
    recorder(ok, seen),
  ).send(mail);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, cloudflareMailSettings(hosted).endpoint);
  assert.equal(seen[0].init.method, "POST");
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), {
    from: "hello@example.test",
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    headers: { "X-JomCall-Operation": mail.operationId },
  });
});

test("Cloudflare errors become codes without the token, the address or the message", async () => {
  const sender = (respond: () => Response | Promise<Response>) =>
    new CloudflareSender(cloudflareMailSettings(hosted), recorder(respond));
  const cases: [() => Response | Promise<Response>, string][] = [
    [
      () =>
        Response.json(
          {
            success: false,
            errors: [{ code: 10004, message: "email.sending.error.throttled" }],
            result: null,
          },
          { status: 429 },
        ),
      "MAIL_REJECTED_429_10004",
    ],
    [
      () =>
        Response.json(
          { success: false, errors: [{ code: 10102 }] },
          { status: 403 },
        ),
      "MAIL_REJECTED_403_10102",
    ],
    [() => new Response("gateway", { status: 502 }), "MAIL_REJECTED_502"],
    [() => Response.json({ success: false }), "MAIL_REJECTED_200"],
    [() => Promise.reject(new TypeError("network")), "MAIL_UNAVAILABLE"],
  ];
  for (const [respond, code] of cases)
    await assert.rejects(sender(respond).send(mail), (e: Error) => {
      assert.equal(e.message, code);
      assert.doesNotMatch(e.message, /SUPERSECRET|invitee|throttled/);
      return true;
    });
});

test("a permanent bounce is accepted once, not retried forever", async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args.join(" "));
  try {
    await new CloudflareSender(
      cloudflareMailSettings(hosted),
      recorder(() =>
        Response.json({
          success: true,
          result: { delivered: [], permanent_bounces: [mail.to], queued: [] },
        }),
      ),
    ).send(mail);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["MAIL_PERMANENT_BOUNCE"]);
});

test("the fake sender records and sends nothing", async () => {
  const fake = new FakeSender();
  await fake.send(mail);
  assert.deepEqual(fake.sent, [mail]);
});
