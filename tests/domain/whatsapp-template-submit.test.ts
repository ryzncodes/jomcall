// The Cloud client's template creation, against a fake fetch only. Nothing
// here reaches Meta.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createCloudProvider,
  graphVersion,
} from "../../packages/whatsapp/src/cloud.ts";

const draft = {
  wabaId: "200000001",
  accessToken: "business-token",
  name: "jomcall_reply_request",
  language: "en",
  category: "utility" as const,
  body: "We have a reply to your enquiry. Please reply to this message to continue the conversation.",
  variables: 0,
};

function client(reply: () => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const provider = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return reply();
    },
  });
  return { provider, seen };
}

test("template creation sends the documented request and reads the status", async () => {
  const c = client(() =>
    Response.json({ id: "900000001", status: "PENDING", category: "UTILITY" }),
  );
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: true,
    status: "PENDING",
  });
  assert.equal(
    c.seen[0].url,
    `https://graph.facebook.com/${graphVersion}/200000001/message_templates`,
  );
  assert.equal(c.seen[0].init.method, "POST");
  assert.equal(
    (c.seen[0].init.headers as Record<string, string>).authorization,
    "Bearer business-token",
  );
  assert.deepEqual(JSON.parse(String(c.seen[0].init.body)), {
    name: "jomcall_reply_request",
    language: "en",
    category: "UTILITY",
    components: [{ type: "BODY", text: draft.body }],
  });
  // The token is in the header only.
  assert.equal(String(c.seen[0].init.body).includes("business-token"), false);
  assert.equal(c.seen[0].url.includes("business-token"), false);
});

test("a body with placeholders carries one sample value for each", async () => {
  const c = client(() => Response.json({ id: "900000002", status: "PENDING" }));
  await c.provider.createTemplate({
    ...draft,
    category: "marketing",
    body: "Hi {{1}}, your booking on {{2}} is confirmed.",
    variables: 2,
  });
  const sent = JSON.parse(String(c.seen[0].init.body));
  assert.equal(sent.category, "MARKETING");
  assert.deepEqual(sent.components[0].example, {
    body_text: [["Example 1", "Example 2"]],
  });
});

test("an answer without an id is a failure; an unsaid or odd status is null", async () => {
  let reply: Response = Response.json({ status: "PENDING" });
  const c = client(() => reply);
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: false,
    reason: "TEMPLATE_SUBMIT_FAILED",
  });
  reply = Response.json({ id: "900000003" });
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: true,
    status: null,
  });
  reply = Response.json({ id: "900000003", status: "pending; drop" });
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: true,
    status: null,
  });
});

test("refusals keep Meta's code for the log and a fixed reason for the page", async () => {
  let reply: Response = Response.json(
    { error: { code: 100, error_subcode: 2388024 } },
    { status: 400 },
  );
  const c = client(() => reply);
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: false,
    reason: "TEMPLATE_SUBMIT_FAILED",
    detail: "META_100_2388024",
  });
  reply = Response.json({ error: { code: 190 } }, { status: 401 });
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: false,
    reason: "META_190",
    detail: "META_190",
  });
  reply = new Response("bad gateway", { status: 502 });
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: false,
    reason: "PROVIDER_UNREACHABLE",
  });
  reply = new Response("nope", { status: 400 });
  assert.deepEqual(await c.provider.createTemplate(draft), {
    ok: false,
    reason: "TEMPLATE_SUBMIT_FAILED",
  });
  const down = createCloudProvider({
    env: { JOMCALL_WHATSAPP_PROVIDER: "cloud" },
    send: async () => {
      throw Error("network");
    },
  });
  assert.deepEqual(await down.createTemplate(draft), {
    ok: false,
    reason: "PROVIDER_UNREACHABLE",
  });
});

test("a malformed draft is refused before anything is sent", async () => {
  const c = client(() => Response.json({ id: "1", status: "PENDING" }));
  for (const bad of [
    { wabaId: "abc" },
    { accessToken: "" },
    { name: "Has Capitals" },
    { language: "english" },
    { category: "authentication" as never },
    { body: "" },
    { body: "x".repeat(1025) },
    { variables: 11 },
    { variables: 1.5 },
  ])
    assert.deepEqual(await c.provider.createTemplate({ ...draft, ...bad }), {
      ok: false,
      reason: "INVALID_TARGET",
    });
  assert.equal(c.seen.length, 0);
});
