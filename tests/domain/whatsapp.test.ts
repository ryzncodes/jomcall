import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import {
  buildInboundText,
  buildStatus,
  parseWebhook,
  signBody,
  verifyChallenge,
  verifySignature,
  sealCredentials,
  openCredentials,
  whatsappMode,
  whatsappReadiness,
} from "../../packages/whatsapp/src/index.ts";
import {
  createCloudProvider,
  graphVersion,
} from "../../packages/whatsapp/src/cloud.ts";
import {
  decideSend,
  type SendFacts,
} from "../../packages/domain/src/whatsapp/policy.ts";

const secret = "test-app-secret-0123456789";

test("signature check accepts only the exact body and key, in either documented form", () => {
  const raw = Buffer.from(JSON.stringify({ a: "Selamat pagi" }));
  assert.ok(verifySignature(raw, signBody(raw, secret), secret));
  assert.equal(
    verifySignature(raw, signBody(raw, "another-secret-000000"), secret),
    false,
  );
  assert.equal(
    verifySignature(
      Buffer.from(raw.toString() + " "),
      signBody(raw, secret),
      secret,
    ),
    false,
  );
  assert.equal(verifySignature(raw, null, secret), false);
  assert.equal(verifySignature(raw, "sha1=" + "a".repeat(40), secret), false);
  assert.equal(
    verifySignature(raw, signBody(raw, secret).toUpperCase(), secret),
    false,
  );
  // A short secret is refused outright.
  assert.equal(verifySignature(raw, signBody(raw, "short"), "short"), false);
  // Non-ASCII: the escaped form is also accepted (Meta's form is unconfirmed).
  const text = JSON.stringify({ t: "你好 café" });
  const escaped = text.replace(
    /[^\x00-\x7f]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  const header =
    "sha256=" + createHmac("sha256", secret).update(escaped).digest("hex");
  assert.ok(verifySignature(Buffer.from(text), header, secret));
});

test("subscription handshake echoes the challenge only for the right token", () => {
  const token = "verify-token-0123456789";
  const q = (t: string, mode = "subscribe") =>
    new URLSearchParams({
      "hub.mode": mode,
      "hub.verify_token": t,
      "hub.challenge": "1158201444",
    });
  assert.equal(verifyChallenge(q(token), token), "1158201444");
  assert.equal(verifyChallenge(q("wrong-token-0123456789"), token), null);
  assert.equal(verifyChallenge(q(token, "unsubscribe"), token), null);
  assert.equal(verifyChallenge(q("short"), "short"), null);
});

test("webhook parsing keys deliveries for idempotency and skips unknown shapes", () => {
  const inbound = buildInboundText({
    phoneNumberId: "100000001",
    from: "60123456789",
    name: "Aina Contoh",
    id: "wamid.A1",
    text: "Buka pukul berapa?",
  });
  const [m] = parseWebhook(inbound);
  assert.equal(m.key, "m:wamid.A1");
  assert.equal(m.kind, "message");
  assert.deepEqual(
    [m.payload.from, m.payload.text, m.payload.name],
    ["60123456789", "Buka pukul berapa?", "Aina Contoh"],
  );
  assert.deepEqual(
    parseWebhook(inbound).map((e) => e.key),
    ["m:wamid.A1"],
  );
  const [s] = parseWebhook(
    buildStatus({
      phoneNumberId: "100000001",
      id: "wamid.B1",
      status: "failed",
      recipient: "60123456789",
      errorCode: 131047,
    }),
  );
  assert.equal(s.key, "s:wamid.B1:failed");
  assert.equal(s.payload.errorCode, "131047");
  assert.deepEqual(parseWebhook({ object: "page", entry: [] }), []);
  assert.deepEqual(
    parseWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: { metadata: { phone_number_id: "x" } },
            },
          ],
        },
      ],
    }),
    [],
  );
});

test("credentials are sealed per organization and never open elsewhere", () => {
  const key = randomBytes(32).toString("hex");
  const sealed = sealCredentials(
    { accessToken: "fake-token-value" },
    key,
    "org-a",
  );
  assert.ok(!JSON.stringify(sealed).includes("fake-token-value"));
  assert.equal(
    openCredentials(sealed, key, "org-a").accessToken,
    "fake-token-value",
  );
  assert.throws(
    () => openCredentials(sealed, key, "org-b"),
    /WHATSAPP_CREDENTIALS_INVALID/,
  );
  assert.throws(
    () => openCredentials(sealed, randomBytes(32).toString("hex"), "org-a"),
    /WHATSAPP_CREDENTIALS_INVALID/,
  );
  assert.throws(
    () => sealCredentials({ accessToken: "x" }, "short", "org-a"),
    /KEY_REQUIRED/,
  );
});

test("the switch defaults to disabled, rejects unknown values and reports names only", () => {
  assert.equal(whatsappMode({}), "disabled");
  assert.throws(
    () => whatsappMode({ JOMCALL_WHATSAPP_PROVIDER: "live" }),
    /UNKNOWN/,
  );
  const r = whatsappReadiness({
    JOMCALL_WHATSAPP_PROVIDER: "cloud",
    WHATSAPP_APP_SECRET: "s".repeat(20),
  });
  assert.equal(r.configured, false);
  assert.deepEqual(r.missing, [
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_CREDENTIALS_KEY",
  ]);
  assert.ok(!JSON.stringify(r).includes("sssss"));
});

test("cloud client is unreachable unless switched on, and sends the documented shapes", async () => {
  assert.throws(
    () => createCloudProvider({ env: {} }),
    /WHATSAPP_CLOUD_DISABLED/,
  );
  assert.throws(
    () => createCloudProvider({ env: { JOMCALL_WHATSAPP_PROVIDER: "fake" } }),
    /WHATSAPP_CLOUD_DISABLED/,
  );
  const seen: { url: string; init: RequestInit }[] = [];
  let reply: Response = Response.json({
    messaging_product: "whatsapp",
    messages: [{ id: "wamid.OUT1" }],
  });
  const client = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return reply;
    },
  });
  const target = {
    phoneNumberId: "100000001",
    accessToken: "fake-token",
    to: "60123456789",
  };
  assert.deepEqual(await client.sendText(target, "Hai"), {
    outcome: "sent",
    providerMessageId: "wamid.OUT1",
  });
  assert.equal(
    seen[0].url,
    `https://graph.facebook.com/${graphVersion}/100000001/messages`,
  );
  assert.equal(
    (seen[0].init.headers as Record<string, string>).authorization,
    "Bearer fake-token",
  );
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "60123456789",
    type: "text",
    text: { preview_url: false, body: "Hai" },
  });
  await client.sendTemplate(target, {
    name: "jomcall_reply_request",
    language: "ms",
    variables: ["Aina"],
  });
  assert.deepEqual(JSON.parse(String(seen[1].init.body)).template, {
    name: "jomcall_reply_request",
    language: { code: "ms" },
    components: [
      { type: "body", parameters: [{ type: "text", text: "Aina" }] },
    ],
  });
  reply = Response.json(
    { error: { code: 131047, message: "Re-engagement message" } },
    { status: 400 },
  );
  assert.deepEqual(await client.sendText(target, "x"), {
    outcome: "failed",
    code: "META_131047",
  });
  reply = new Response("", { status: 503 });
  assert.deepEqual(await client.sendText(target, "x"), { outcome: "unknown" });
  const broken = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async () => {
      throw Error("reset");
    },
  });
  assert.deepEqual(await broken.sendText(target, "x"), { outcome: "unknown" });
});

const now = "2026-11-14T10:00:00.000Z";
const approved = {
  id: "t1",
  name: "jomcall_reply_request",
  language: "ms",
  category: "utility" as const,
  status: "approved",
  variables: 0,
};
const base = (over: Partial<SendFacts> = {}): SendFacts => ({
  message: { kind: "text", templateVariables: [], optOutNotice: false },
  channel: { state: "connected" },
  contact: { doNotContact: false, deletionPending: false },
  conversation: { lastInboundAt: "2026-11-14T09:00:00.000Z" },
  consent: { service: null, marketing: null },
  template: null,
  fallback: approved,
  now,
  ...over,
});

test("send rules: do-not-contact blocks even inside the window", () => {
  assert.deepEqual(decideSend(base()), { allow: true, mode: "text" });
  assert.deepEqual(
    decideSend(
      base({ contact: { doNotContact: true, deletionPending: false } }),
    ),
    { allow: false, reason: "DO_NOT_CONTACT" },
  );
  assert.deepEqual(decideSend(base({ channel: { state: "failed" } })), {
    allow: false,
    reason: "CHANNEL_NOT_CONNECTED",
  });
});

test("send rules: a template needs approval and a recorded yes for its purpose", () => {
  const tpl = base({
    message: { kind: "template", templateVariables: [], optOutNotice: false },
    template: approved,
  });
  assert.deepEqual(decideSend(tpl), {
    allow: false,
    reason: "CONSENT_REQUIRED",
  });
  assert.equal(
    decideSend({ ...tpl, consent: { service: true, marketing: null } }).allow,
    true,
  );
  assert.deepEqual(
    decideSend({
      ...tpl,
      consent: { service: true, marketing: null },
      template: { ...approved, category: "marketing" },
    }),
    { allow: false, reason: "CONSENT_REQUIRED" },
  );
  assert.deepEqual(
    decideSend({
      ...tpl,
      consent: { service: true, marketing: null },
      template: { ...approved, status: "pending" },
    }),
    { allow: false, reason: "TEMPLATE_NOT_APPROVED" },
  );
});

test("send rules: an expired window turns text into the reply-request template", () => {
  const late = base({
    conversation: { lastInboundAt: "2026-11-13T09:59:00.000Z" },
  });
  assert.deepEqual(decideSend(late), {
    allow: false,
    reason: "CONSENT_REQUIRED",
  });
  const allowed = decideSend({
    ...late,
    consent: { service: true, marketing: null },
  });
  assert.deepEqual(allowed, {
    allow: true,
    mode: "template",
    template: approved,
    fallback: true,
  });
  assert.deepEqual(
    decideSend({
      ...late,
      fallback: null,
      consent: { service: true, marketing: null },
    }),
    { allow: false, reason: "WINDOW_CLOSED" },
  );
});

test("send rules: after opting out only the confirmation goes out", () => {
  const out = base({ consent: { service: false, marketing: false } });
  assert.deepEqual(decideSend(out), { allow: false, reason: "OPTED_OUT" });
  assert.equal(
    decideSend({
      ...out,
      message: { kind: "text", templateVariables: [], optOutNotice: true },
    }).allow,
    true,
  );
});
