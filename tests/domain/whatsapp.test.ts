import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { mappedProviderStatuses, providerStatusMap, providerStatusNotFound } from "../../packages/contracts/src/whatsapp.ts";

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

test("webhook parsing names each media type, keeps non-text types, and drops reactions", () => {
  const deliver = (messages: Record<string, unknown>[]) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "100000001" },
              contacts: [{ profile: { name: "Aina Contoh" }, wa_id: "60123456789" }],
              messages: messages.map((m, i) => ({
                from: "60123456789",
                id: "wamid.M" + i,
                timestamp: "1700000000",
                ...m,
              })),
            },
          },
        ],
      },
    ],
  });
  const media = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    mime_type: "application/octet-stream",
    sha256: "c2hhLWZha2U=",
    ...extra,
  });
  const events = parseWebhook(
    deliver([
      { type: "image", image: media("MEDIA1", { mime_type: "image/jpeg", caption: "Rosak macam ni" }) },
      { type: "audio", audio: media("MEDIA2", { mime_type: "audio/ogg; codecs=opus", voice: true }) },
      { type: "document", document: media("MEDIA3", { mime_type: "application/pdf", filename: "sebut-harga.pdf" }) },
      { type: "sticker", sticker: media("MEDIA4", { mime_type: "image/webp", animated: false }) },
      { type: "location", location: { latitude: 3.139, longitude: 101.6869, name: "Contoh" } },
      { type: "reaction", reaction: { message_id: "wamid.OUT1", emoji: "👍" } },
    ]),
  );
  // A customer's file name loses control and bidirectional characters; one
  // with nothing else left has no name.
  const named = (filename: string) =>
    (parseWebhook(deliver([{ type: "document", document: media("MEDIA9", { filename }) }]))[0].payload as any).media;
  assert.equal(named("\u202Efdp.exe\u0000harga\u2066\u009f").filename, "fdp.exeharga");
  assert.equal(named("a\u0007b\u007fc\u202ad\u2069").filename, "abcd");
  const emptied = named("\u0001\u202e\u0085");
  assert.equal("filename" in emptied, false);
  assert.equal("filename" in named(""), false);
  // The reaction (sixth message) is not stored at all.
  assert.deepEqual(
    events.map((e) => e.key),
    ["m:wamid.M0", "m:wamid.M1", "m:wamid.M2", "m:wamid.M3", "m:wamid.M4"],
  );
  const [image, audio, doc, sticker, location] = events.map((e) => e.payload as any);
  assert.equal(image.type, "image");
  assert.equal(image.media.kind, "image");
  assert.equal(image.media.caption, "Rosak macam ni");
  assert.equal(image.text, undefined);
  assert.equal(audio.media.kind, "audio");
  assert.equal(audio.media.mimeType, "audio/ogg; codecs=opus");
  assert.equal(doc.media.kind, "document");
  assert.equal(doc.media.filename, "sebut-harga.pdf");
  assert.equal(sticker.media.kind, "sticker");
  assert.equal(location.type, "location");
  assert.equal(location.media, undefined);
  assert.deepEqual(parseWebhook(deliver([{ type: "reaction", reaction: { message_id: "wamid.X", emoji: "" } }])), []);
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

test("cloud template listing sends the recorded request, follows cursors and refuses a partial list", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let replies: Response[] = [];
  const client = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return replies.shift() ?? Response.json({ data: [] });
    },
  });
  const input = { wabaId: "200000001", accessToken: "fake-token" };
  replies = [
    Response.json({
      data: [
        { name: "jomcall_reply_request", language: "ms", status: "APPROVED", id: "1" },
        { name: "jomcall_reply_request", language: "en", status: "PENDING" },
        // A name or language no local template can have cannot match a
        // local row, so it is left out.
        { name: "Bad Name", language: "ms", status: "APPROVED" },
        { name: "x", language: "malay", status: "APPROVED" },
      ],
      paging: {
        cursors: { after: "QVFIUmFmZAWtl" },
        next: "https://elsewhere.example/steal?after=QVFIUmFmZAWtl",
      },
    }),
    Response.json({
      data: [{ name: "jomcall_reply_request", language: "zh_CN", status: "IN_REVIEW" }],
      paging: { cursors: { after: "QVFIUmFmZAWtm" } },
    }),
  ];
  assert.deepEqual(await client.listTemplates(input), {
    ok: true,
    templates: [
      { name: "jomcall_reply_request", language: "ms", status: "APPROVED" },
      { name: "jomcall_reply_request", language: "en", status: "PENDING" },
      { name: "jomcall_reply_request", language: "zh_CN", status: "IN_REVIEW" },
    ],
  });
  assert.equal(seen.length, 2);
  const first = new URL(seen[0].url);
  assert.equal(
    first.origin + first.pathname,
    `https://graph.facebook.com/${graphVersion}/200000001/message_templates`,
  );
  assert.equal(first.searchParams.get("fields"), "name,language,status");
  assert.equal(first.searchParams.get("after"), null);
  // The next page is built from the cursor on Meta's own origin; the URL in
  // the response is never fetched.
  const second = new URL(seen[1].url);
  assert.equal(second.origin, "https://graph.facebook.com");
  assert.equal(second.searchParams.get("after"), "QVFIUmFmZAWtl");
  assert.equal(
    (seen[0].init.headers as Record<string, string>).authorization,
    "Bearer fake-token",
  );
  assert.equal(seen[0].init.method ?? "GET", "GET");

  // More pages than the cap: a failure, not part of the list.
  seen.length = 0;
  const page = (i: number) =>
    Response.json({
      data: [{ name: "t" + i, language: "ms", status: "APPROVED" }],
      paging: { cursors: { after: "c" + i }, next: "https://graph.facebook.com/next" },
    });
  replies = Array.from({ length: 12 }, (_, i) => page(i));
  assert.deepEqual(await client.listTemplates(input), {
    ok: false,
    reason: "TEMPLATE_LIST_TOO_LONG",
  });
  assert.equal(seen.length, 10);

  replies = [Response.json({ error: { code: 190, message: "expired" } }, { status: 401 })];
  assert.deepEqual(await client.listTemplates(input), { ok: false, reason: "META_190" });
  replies = [new Response("", { status: 500 })];
  assert.deepEqual(await client.listTemplates(input), {
    ok: false,
    reason: "TEMPLATE_LIST_FAILED",
  });
  replies = [Response.json({ nothing: true })];
  assert.deepEqual(await client.listTemplates(input), {
    ok: false,
    reason: "TEMPLATE_LIST_INVALID",
  });
  replies = [Response.json({ data: [], paging: { next: "https://graph.facebook.com/n", cursors: { after: "bad cursor/" } } })];
  assert.deepEqual(await client.listTemplates(input), {
    ok: false,
    reason: "TEMPLATE_LIST_INVALID",
  });
  assert.deepEqual(
    await client.listTemplates({ wabaId: "../me", accessToken: "fake-token" }),
    { ok: false, reason: "INVALID_TARGET" },
  );
  const broken = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async () => {
      throw Error("reset");
    },
  });
  assert.deepEqual(await broken.listTemplates(input), {
    ok: false,
    reason: "PROVIDER_UNREACHABLE",
  });
});

test("cloud template listing fails the whole list on one malformed item", async () => {
  let replies: Response[] = [];
  const client = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async () => replies.shift() ?? Response.json({ data: [] }),
  });
  const input = { wabaId: "200000001", accessToken: "fake-token" };
  const good = { name: "jomcall_reply_request", language: "ms", status: "APPROVED" };
  for (const bad of [
    { language: "ms", status: "APPROVED" },
    { name: "jomcall_reply_request", status: "APPROVED" },
    { name: "jomcall_reply_request", language: "ms" },
    { name: "", language: "ms", status: "APPROVED" },
    { name: "jomcall_reply_request", language: "ms", status: 3 },
    // Not upper case: never upper-cased here, refused.
    { name: "jomcall_reply_request", language: "en", status: "approved" },
    { name: "jomcall_reply_request", language: "en", status: "IN REVIEW" },
    null,
  ]) {
    replies = [Response.json({ data: [good, bad] })];
    assert.deepEqual(
      await client.listTemplates(input),
      { ok: false, reason: "TEMPLATE_LIST_INVALID" },
      JSON.stringify(bad),
    );
  }
  // A malformed item on a later page fails the pages already read too.
  replies = [
    Response.json({ data: [good], paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/n" } }),
    Response.json({ data: [{ name: "x", language: "ms", status: "lower" }] }),
  ];
  assert.deepEqual(await client.listTemplates(input), { ok: false, reason: "TEMPLATE_LIST_INVALID" });
});

test("cloud template listing stops paging when the caller's deadline passes", async () => {
  const stop = new AbortController();
  const seen: string[] = [];
  const page = (i: number) =>
    Response.json({
      data: [{ name: "t" + i, language: "ms", status: "APPROVED" }],
      paging: { cursors: { after: "c" + i }, next: "https://graph.facebook.com/next" },
    });
  const client = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async (url, init) => {
      seen.push(String(url));
      // The request carries a signal that follows the caller's deadline.
      assert.ok(init?.signal);
      // The deadline passes while the first page is in flight.
      if (seen.length === 1) stop.abort();
      return page(seen.length);
    },
  });
  const input = { wabaId: "200000001", accessToken: "fake-token", signal: stop.signal };
  assert.deepEqual(await client.listTemplates(input), { ok: false, reason: "TEMPLATE_LIST_TIMEOUT" });
  assert.equal(seen.length, 1);
  // Already past the deadline: nothing is asked for.
  assert.deepEqual(await client.listTemplates(input), { ok: false, reason: "TEMPLATE_LIST_TIMEOUT" });
  assert.equal(seen.length, 1);
  // A request aborted by the deadline is a timeout, not an unreachable provider.
  const late = new AbortController();
  const hanging = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        late.abort();
      }),
  });
  assert.deepEqual(
    await hanging.listTemplates({ ...input, signal: late.signal }),
    { ok: false, reason: "TEMPLATE_LIST_TIMEOUT" },
  );
});

test("the screen's list of mapped provider statuses matches the sync migration", () => {
  const sql = readFileSync(
    "supabase/migrations/20261116150000_whatsapp_template_sync.sql",
    "utf8",
  );
  const block = sql.slice(sql.indexOf("v_new=case v_raw"), sql.indexOf("else t.status end"));
  const names = [...block.matchAll(/when '([A-Z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, [...mappedProviderStatuses].sort());
  // The local status each name maps to is the same on both sides.
  const pairs = [...block.matchAll(/when '([A-Z_]+)' then '([a-z]+)'/g)].map((m) => [m[1], m[2]]);
  assert.equal(pairs.length, names.length);
  assert.deepEqual(Object.fromEntries(pairs), providerStatusMap);
});

test("the screen's NOT_FOUND marker is the one the sync migration writes, and is not a mapped status", () => {
  const sql = readFileSync(
    "supabase/migrations/20261116150000_whatsapp_template_sync.sql",
    "utf8",
  );
  assert.ok(sql.includes(`provider_status='${providerStatusNotFound}'`));
  assert.ok(!(mappedProviderStatuses as readonly string[]).includes(providerStatusNotFound));
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

test("cloud subscribeApp posts to the business account's subscribed_apps and reads the answer", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let reply: Response = Response.json({ success: true });
  let fail = false;
  const client = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async (url, init) => {
      seen.push({ url: String(url), init: init! });
      if (fail) throw Error("reset");
      return reply;
    },
  });
  const input = { wabaId: "200000001", accessToken: "fake-token" };
  assert.deepEqual(await client.subscribeApp(input), { ok: true });
  assert.equal(
    seen[0].url,
    `https://graph.facebook.com/${graphVersion}/200000001/subscribed_apps`,
  );
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.body, undefined);
  assert.equal(
    (seen[0].init.headers as Record<string, string>).authorization,
    "Bearer fake-token",
  );
  // Success only when Meta says so.
  reply = Response.json({ success: false });
  assert.deepEqual(await client.subscribeApp(input), { ok: false, reason: "SUBSCRIBE_FAILED" });
  reply = Response.json({});
  assert.deepEqual(await client.subscribeApp(input), { ok: false, reason: "SUBSCRIBE_FAILED" });
  reply = Response.json({ error: { code: 190, message: "Expired" } }, { status: 401 });
  assert.deepEqual(await client.subscribeApp(input), { ok: false, reason: "META_190" });
  reply = new Response("", { status: 503 });
  assert.deepEqual(await client.subscribeApp(input), { ok: false, reason: "SUBSCRIBE_FAILED" });
  fail = true;
  assert.deepEqual(await client.subscribeApp(input), { ok: false, reason: "PROVIDER_UNREACHABLE" });
  const before = seen.length;
  assert.deepEqual(await client.subscribeApp({ wabaId: "x", accessToken: "t" }), { ok: false, reason: "INVALID_TARGET" });
  assert.deepEqual(await client.subscribeApp({ wabaId: "200000001", accessToken: "" }), { ok: false, reason: "INVALID_TARGET" });
  assert.equal(seen.length, before);
});
