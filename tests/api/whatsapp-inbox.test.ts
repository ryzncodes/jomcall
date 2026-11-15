// The inbox read the web screen relies on: compliance, the reply outlook and
// the system-line flags on messages, checked against what the agent process
// then actually does with a staff reply. Local database, fake provider, no
// network. Fake names and numbers only.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";
import {
  buildInboundText,
  signBody,
} from "../../packages/whatsapp/src/index.ts";
import { createFakeProvider } from "../../packages/whatsapp/src/fake.ts";
import { WhatsAppWorker } from "../../engine/src/whatsapp/worker.ts";

const secret = "inbox-app-secret-" + randomUUID();
const phone = String(100000000 + Math.floor(Math.random() * 899999999));
const customer =
  "6011" + String(Math.floor(Math.random() * 9000000) + 1000000);

async function setup() {
  Object.assign(process.env, {
    JOMCALL_WHATSAPP_PROVIDER: "fake",
    WHATSAPP_APP_SECRET: secret,
    WHATSAPP_VERIFY_TOKEN: "verify-token-" + randomUUID(),
  });
  const f = await createPhase2Harness();
  const { h } = f;
  const version = (
    await h.cleanup.query(
      "insert into app.agent_version(org_id,agent_id,sequence,snapshot,actor_id)values($1,$2,1,$3,$4)returning id",
      [
        h.orgA.id,
        h.orgA.agentId,
        JSON.stringify({
          settings: { name: "Agent", aiDisclosure: "" },
          knowledge: [
            { kind: "faq", name: "Hours", content: "Kami buka 9 pagi." },
          ],
        }),
        h.alice.userId,
      ],
    )
  ).rows[0].id;
  await h.cleanup.query(
    "update app.agent set published_version_id=$1 where id=$2",
    [version, h.orgA.agentId],
  );
  const saved = await f.req("PUT", "/channels/whatsapp", {
    phoneNumberId: phone,
    wabaId: "200000002",
    agentEnabled: true,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const provider = createFakeProvider();
  const worker = new WhatsAppWorker(h.namespace, {
    provider,
    model: {
      generate: async () => ({
        kind: "answer",
        text: "Kami buka 9 pagi.",
        citations: [],
      }),
    },
  });
  await worker.tick(); // pending -> connected
  const say = (text: string) => {
    const raw = JSON.stringify(
      buildInboundText({
        phoneNumberId: phone,
        from: customer,
        name: "Siti Contoh",
        id: "wamid.IN" + randomUUID(),
        text,
      }),
    );
    return webhookPost(
      new Request("http://127.0.0.1:4182/api/whatsapp/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signBody(raw, secret),
        },
        body: raw,
      }),
    );
  };
  const staffReq = (method: string, path: string, body?: unknown) =>
    f.api.request(h.staff, h.orgA.id, method, "/api/v1" + path, body);
  const latest = async () =>
    (await f.req("GET", "/conversations")).body.data[0];
  const detail = async (id: string) =>
    (await f.req("GET", `/conversations/${id}`)).body.data;
  const reply = async (text: string) => {
    const c = await latest();
    const r = await f.req("POST", `/conversations/${c.id}/messages`, {
      text,
      expectedRevision: c.revision,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await worker.tick();
    const d = await detail(c.id);
    return d.messages.filter((m: any) => m.body === text).at(-1);
  };
  return {
    ...f,
    worker,
    say,
    staffReq,
    latest,
    detail,
    reply,
    close: async () => {
      await worker.close();
      await h.cleanup.query(
        "delete from app.whatsapp_event where namespace=$1",
        [h.namespace],
      );
      await f.close();
    },
  };
}

test("WhatsApp inbox read and staff replies", async (t) => {
  const f = await setup();
  try {
    await t.test(
      "a new conversation shows compliance, an open outlook and the disclosure flag",
      async () => {
        assert.equal((await f.say("Pukul berapa buka?")).status, 200);
        await f.worker.tick();
        const c = await f.latest();
        const d = await f.detail(c.id);
        assert.deepEqual(d.compliance, {
          do_not_contact: false,
          deletion_pending: false,
          consent_service: null,
          consent_marketing: null,
        });
        assert.equal(d.window_open, true);
        assert.deepEqual(d.reply_outlook, {
          allow: true,
          mode: "text",
          fallback: false,
          reason: null,
        });
        const agent = d.messages.filter((m: any) => m.author === "agent");
        assert.equal(agent.length, 1);
        assert.equal(agent[0].disclosure, true);
        assert.equal(agent[0].notice, null);
        assert.equal(
          d.messages.find((m: any) => m.direction === "inbound").disclosure,
          false,
        );
      },
    );

    await t.test(
      "staff role reads the conversation and its reply is sent inside the window",
      async () => {
        const c = await f.latest();
        const read = await f.staffReq("GET", `/conversations/${c.id}`);
        assert.equal(read.status, 200);
        assert.ok(read.body.data.messages.length >= 2);
        const r = await f.staffReq("POST", `/conversations/${c.id}/messages`, {
          text: "Staf di sini, boleh saya bantu?",
          expectedRevision: c.revision,
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.owner, "staff");
        await f.worker.tick();
        const m = (await f.detail(c.id)).messages.at(-1);
        assert.equal(m.author, "staff");
        assert.equal(m.status, "sent");
        assert.equal(m.kind, "text");
      },
    );

    await t.test("a stale revision is refused with CONFLICT", async () => {
      const c = await f.latest();
      const r = await f.req("POST", `/conversations/${c.id}/messages`, {
        text: "Lama",
        expectedRevision: c.revision - 1,
      });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "CONFLICT");
    });

    await t.test("hand back and take over change who handles it", async () => {
      let c = await f.latest();
      const back = await f.req("POST", `/conversations/${c.id}/handback`, {
        expectedRevision: c.revision,
      });
      assert.equal(back.status, 200);
      assert.equal(back.body.data.owner, "agent");
      c = await f.latest();
      const take = await f.staffReq("POST", `/conversations/${c.id}/takeover`, {
        expectedRevision: c.revision,
      });
      assert.equal(take.status, 200);
      assert.equal(take.body.data.owner, "staff");
    });

    await t.test(
      "the staff keyword shows a handoff notice and needs staff",
      async () => {
        let c = await f.latest();
        await f.req("POST", `/conversations/${c.id}/handback`, {
          expectedRevision: c.revision,
        });
        await f.say("STAF");
        await f.worker.tick();
        c = await f.latest();
        assert.equal(c.needs_attention, true);
        assert.equal(c.attention_reason, "HANDOFF_REQUESTED");
        const notice = (await f.detail(c.id)).messages.at(-1);
        assert.equal(notice.author, "system");
        assert.equal(notice.notice, "notice_handoff");
      },
    );

    await t.test(
      "do-not-contact shows in the outlook and the worker blocks the reply",
      async () => {
        const c = await f.latest();
        const contact = (await f.req("GET", `/contacts/${c.contact_id}`)).body
          .data;
        const on = await f.req(
          "PUT",
          `/contacts/${c.contact_id}/do-not-contact`,
          {
            expectedRevision: contact.revision,
            enabled: true,
            reason: "Fake test request",
          },
        );
        assert.equal(on.status, 200, JSON.stringify(on.body));
        const d = await f.detail(c.id);
        assert.equal(d.compliance.do_not_contact, true);
        assert.deepEqual(d.reply_outlook, {
          allow: false,
          mode: null,
          fallback: false,
          reason: "DO_NOT_CONTACT",
        });
        const m = await f.reply("Ini tidak patut dihantar");
        assert.equal(m.status, "blocked");
        assert.equal(m.error_code, "DO_NOT_CONTACT");
        const after = (await f.req("GET", `/contacts/${c.contact_id}`)).body
          .data;
        const off = await f.req(
          "PUT",
          `/contacts/${c.contact_id}/do-not-contact`,
          {
            expectedRevision: after.revision,
            enabled: false,
            reason: "Fake test cleared",
          },
        );
        assert.equal(off.status, 200, JSON.stringify(off.body));
      },
    );

    await t.test(
      "outside the window a reply is blocked, then replaced by the reply-request template once allowed",
      async () => {
        const c = await f.latest();
        await f.h.cleanup.query(
          "update app.conversation set last_inbound_at=now()-interval '25 hours' where id=$1",
          [c.id],
        );
        let d = await f.detail(c.id);
        assert.equal(d.window_open, false);
        assert.equal(d.reply_outlook.reason, "WINDOW_CLOSED");
        let m = await f.reply("Maaf lambat membalas");
        assert.equal(m.status, "blocked");
        assert.equal(m.error_code, "WINDOW_CLOSED");

        const tpl = await f.req("POST", "/channels/whatsapp/templates", {
          name: "jomcall_reply_request",
          language: "ms",
          category: "utility",
          purpose: "reengage",
          body: "Kami ada balasan untuk pertanyaan anda. Sila balas mesej ini.",
          variables: 0,
        });
        assert.equal(tpl.status, 200, JSON.stringify(tpl.body));
        const approved = await f.req(
          "PATCH",
          `/channels/whatsapp/templates/${tpl.body.data.id}`,
          { status: "approved", expectedRevision: tpl.body.data.revision },
        );
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        // A template still needs a recorded yes.
        d = await f.detail(c.id);
        assert.equal(d.reply_outlook.reason, "CONSENT_REQUIRED");

        const contact = (await f.req("GET", `/contacts/${c.contact_id}`)).body
          .data;
        const yes = await f.req("POST", `/contacts/${c.contact_id}/consents`, {
          expectedRevision: contact.revision,
          channel: "whatsapp",
          purpose: "service",
          granted: true,
          source: "Fake test",
          evidence: "Fake customer said yes in the test",
        });
        assert.equal(yes.status, 200, JSON.stringify(yes.body));
        d = await f.detail(c.id);
        assert.equal(d.compliance.consent_service, true);
        assert.deepEqual(d.reply_outlook, {
          allow: true,
          mode: "template",
          fallback: true,
          reason: null,
        });
        m = await f.reply("Kami sudah ada jawapan");
        assert.equal(m.status, "sent");
        assert.equal(m.kind, "template");
      },
    );

    await t.test(
      "STOP shows an opt-out notice and the worker blocks a later reply",
      async () => {
        await f.say("STOP");
        await f.worker.tick();
        const c = await f.latest();
        const d = await f.detail(c.id);
        assert.equal(d.compliance.consent_service, false);
        assert.equal(d.reply_outlook.reason, "OPTED_OUT");
        const notice = d.messages.find(
          (m: any) => m.notice === "notice_opt_out",
        );
        assert.ok(notice, "no opt-out notice");
        assert.equal(notice.author, "system");
        assert.equal(notice.status, "sent");
        const m = await f.reply("Satu lagi soalan");
        assert.equal(m.status, "blocked");
        assert.equal(m.error_code, "OPTED_OUT");
      },
    );

    await t.test("a resolved conversation refuses replies", async () => {
      let c = await f.latest();
      const done = await f.req("POST", `/conversations/${c.id}/resolve`, {
        expectedRevision: c.revision,
      });
      assert.equal(done.status, 200);
      c = await f.latest();
      const r = await f.req("POST", `/conversations/${c.id}/messages`, {
        text: "Selepas tutup",
        expectedRevision: c.revision,
      });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "CONVERSATION_CLOSED");
    });
  } finally {
    await f.close();
  }
});
