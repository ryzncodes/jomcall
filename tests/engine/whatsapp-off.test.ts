// The default: no switch set. The channel must say "not connected", refuse to
// save and hide the webhook. Runs in its own process so the environment is clean.
import test from "node:test";
import assert from "node:assert/strict";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";

test("WhatsApp is off unless the switch is set", async () => {
  for (const name of [
    "JOMCALL_WHATSAPP_PROVIDER",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_CREDENTIALS_KEY",
  ])
    delete process.env[name];
  const f = await createPhase2Harness();
  try {
    const overview = await f.req("GET", "/channels/whatsapp");
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.readiness.provider, "disabled");
    assert.equal(overview.body.data.readiness.configured, false);
    assert.equal(overview.body.data.channel, null);
    const saved = await f.req("PUT", "/channels/whatsapp", {
      phoneNumberId: "100000009",
      wabaId: "200000009",
      agentEnabled: true,
    });
    assert.equal(saved.status, 503);
    assert.equal(saved.body.error.code, "WHATSAPP_NOT_CONFIGURED");
    const hook = await webhookPost(
      new Request("http://127.0.0.1:4182/api/whatsapp/webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    assert.equal(hook.status, 404);
  } finally {
    await f.close();
  }
});
