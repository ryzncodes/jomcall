// End to end against the local database: webhook route, intake, agent turn
// through the shared brain, send rules and the fake provider. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";
import {
  buildInboundText,
  buildStatus,
  signBody,
} from "../../packages/whatsapp/src/index.ts";
import { createFakeProvider } from "../../packages/whatsapp/src/fake.ts";
import { WhatsAppWorker } from "../../engine/src/whatsapp/worker.ts";
import type { ModelDecision } from "../../packages/contracts/src/agent-test.ts";

const secret = "test-app-secret-" + randomUUID();
const phone = String(100000000 + Math.floor(Math.random() * 899999999));
const customer = "6011" + String(Math.floor(Math.random() * 9000000) + 1000000);

async function setup() {
  Object.assign(process.env, {
    JOMCALL_WHATSAPP_PROVIDER: "fake",
    WHATSAPP_APP_SECRET: secret,
    WHATSAPP_VERIFY_TOKEN: "verify-token-" + randomUUID(),
  });
  const f = await createPhase2Harness();
  const { h } = f;
  // Publish a minimal agent version directly; publishing rules are tested elsewhere.
  const version = (
    await h.cleanup.query(
      "insert into app.agent_version(org_id,agent_id,sequence,snapshot,actor_id)values($1,$2,1,$3,$4)returning id",
      [
        h.orgA.id,
        h.orgA.agentId,
        JSON.stringify({
          settings: { name: "Agent", aiDisclosure: "" },
          knowledge: [
            {
              kind: "faq",
              name: "Hours",
              content: "Kami buka 9 pagi hingga 6 petang.",
            },
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
    wabaId: "200000001",
    agentEnabled: true,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const provider = createFakeProvider();
  let next: ModelDecision[] = [];
  const worker = new WhatsAppWorker(h.namespace, {
    provider,
    model: {
      generate: async () =>
        next.shift() ?? { kind: "answer", text: "Baik.", citations: [] },
    },
  });
  await worker.tick(); // verifies the number: pending -> connected
  const deliver = async (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return webhookPost(
      new Request("http://127.0.0.1:4182/api/whatsapp/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature ?? signBody(raw, secret),
        },
        body: raw,
      }),
    );
  };
  const say = (text: string, id = "wamid.IN" + randomUUID()) =>
    deliver(
      buildInboundText({
        phoneNumberId: phone,
        from: customer,
        name: "Aina Contoh",
        id,
        text,
      }),
    );
  const conversation = async () =>
    (
      await h.cleanup.query(
        "select * from app.conversation where org_id=$1 order by created_at desc limit 1",
        [h.orgA.id],
      )
    ).rows[0];
  const messages = async () =>
    (
      await h.cleanup.query(
        "select * from app.message where org_id=$1 order by created_at,id",
        [h.orgA.id],
      )
    ).rows;
  return {
    ...f,
    provider,
    worker,
    deliver,
    say,
    conversation,
    messages,
    answer: (d: ModelDecision[]) => (next = d),
    close: async () => {
      await worker.close();
      await f.close();
    },
  };
}

test("WhatsApp flow against the local database", async (t) => {
  const f = await setup();
  try {
    await t.test(
      "channel connects after the provider check and never returns the token",
      async () => {
        const overview = (await f.req("GET", "/channels/whatsapp")).body.data;
        assert.equal(overview.channel.state, "connected");
        assert.ok(!("credentials" in overview.channel));
      },
    );

    await t.test(
      "a bad signature is rejected and nothing is stored",
      async () => {
        const body = buildInboundText({
          phoneNumberId: phone,
          from: customer,
          name: "X",
          id: "wamid.BAD",
          text: "hi",
        });
        assert.equal(
          (await f.deliver(body, signBody("other", secret))).status,
          401,
        );
        assert.equal(
          (await f.deliver(body, "sha256=" + "0".repeat(64))).status,
          401,
        );
        const stored = await f.h.cleanup.query(
          "select count(*)::int as n from app.whatsapp_event where dedupe_key='m:wamid.BAD'",
        );
        assert.equal(stored.rows[0].n, 0);
      },
    );

    await t.test(
      "duplicate delivery stores one message and one reply, with the AI disclosure",
      async () => {
        const id = "wamid.DUP" + randomUUID();
        f.answer([
          { kind: "answer", text: "Kami buka 9 pagi.", citations: [] },
        ]);
        assert.equal((await f.say("Pukul berapa buka?", id)).status, 200);
        assert.equal((await f.say("Pukul berapa buka?", id)).status, 200);
        await f.worker.tick();
        await f.worker.tick();
        const all = await f.messages();
        assert.equal(all.filter((m) => m.direction === "inbound").length, 1);
        const out = all.filter((m) => m.direction === "outbound");
        assert.equal(out.length, 1);
        assert.equal(out[0].status, "sent");
        assert.match(out[0].body, /pembantu AI/);
        assert.match(out[0].body, /Kami buka 9 pagi\./);
        assert.equal(f.provider.sent.length, 1);
      },
    );

    await t.test("the disclosure appears once per conversation", async () => {
      f.answer([
        { kind: "answer", text: "Ya, ada tempat letak kereta.", citations: [] },
      ]);
      await f.say("Ada parking?");
      await f.worker.tick();
      const out = (await f.messages()).filter(
        (m) => m.direction === "outbound",
      );
      assert.equal(out.length, 2);
      assert.equal(out.filter((m) => /pembantu AI/.test(m.body)).length, 1);
      assert.equal(out[1].body, "Ya, ada tempat letak kereta.");
    });

    await t.test(
      "statuses only move forward, whatever order they arrive in",
      async () => {
        const sent = (await f.messages()).find(
          (m) => m.direction === "outbound",
        );
        const status = (s: "sent" | "delivered" | "read") =>
          f.deliver(
            buildStatus({
              phoneNumberId: phone,
              id: sent.provider_message_id,
              status: s,
              recipient: customer,
            }),
          );
        await status("read");
        await status("delivered");
        await status("sent");
        await f.worker.tick();
        const row = (
          await f.h.cleanup.query(
            "select status from app.message where id=$1",
            [sent.id],
          )
        ).rows[0];
        assert.equal(row.status, "read");
      },
    );

    await t.test(
      "a handoff proposal pauses the agent on that conversation",
      async () => {
        f.answer([
          {
            kind: "tool",
            call: {
              name: "handoff_to_human",
              args: { reason: "Customer asks for a refund" },
            },
          },
          {
            kind: "answer",
            text: "Saya telah minta pekerja kami menyemak permintaan anda.",
            citations: [],
          },
        ]);
        await f.say("Saya nak refund");
        await f.worker.tick();
        const c = await f.conversation();
        assert.equal(c.owner, "staff");
        assert.equal(c.attention_reason, "HANDOFF_REQUESTED");
        const before = (await f.messages()).length;
        await f.say("Hello?");
        await f.worker.tick();
        const after = await f.messages();
        assert.equal(after.length, before + 1); // the customer's message only
        assert.equal(
          (await f.conversation()).attention_reason,
          "CUSTOMER_REPLIED",
        );
        // Staff hand it back; the agent answers again.
        const detail = (await f.req("GET", `/conversations/${c.id}`)).body.data;
        assert.equal(
          (
            await f.req("POST", `/conversations/${c.id}/handback`, {
              expectedRevision: detail.revision,
            })
          ).status,
          200,
        );
      },
    );

    await t.test(
      "typing staff reaches a person without the model",
      async () => {
        f.answer([
          { kind: "answer", text: "MODEL SHOULD NOT ANSWER", citations: [] },
        ]);
        await f.say("staf");
        await f.worker.tick();
        const c = await f.conversation();
        assert.equal(c.owner, "staff");
        const last = (await f.messages()).at(-1);
        assert.equal(last.author, "system");
        assert.match(last.body, /pekerja kami/);
        assert.ok(
          !(await f.messages()).some((m) =>
            m.body.includes("MODEL SHOULD NOT ANSWER"),
          ),
        );
        const detail = (await f.req("GET", `/conversations/${c.id}`)).body.data;
        await f.req("POST", `/conversations/${c.id}/handback`, {
          expectedRevision: detail.revision,
        });
      },
    );

    await t.test(
      "do-not-contact blocks a send, even inside the window",
      async () => {
        const c = await f.conversation();
        await f.h.cleanup.query(
          "update app.contact set do_not_contact=true where id=$1",
          [c.contact_id],
        );
        const sentBefore = f.provider.sent.length;
        f.answer([
          {
            kind: "answer",
            text: "Jawapan yang tidak patut dihantar.",
            citations: [],
          },
        ]);
        await f.say("Satu lagi soalan");
        await f.worker.tick();
        const last = (await f.messages()).at(-1);
        assert.equal(last.status, "blocked");
        assert.equal(last.error_code, "DO_NOT_CONTACT");
        assert.equal(f.provider.sent.length, sentBefore);
        await f.h.cleanup.query(
          "update app.contact set do_not_contact=false where id=$1",
          [c.contact_id],
        );
      },
    );

    await t.test(
      "an expired window forces the template, and no consent blocks it",
      async () => {
        const c = await f.conversation();
        const overview = (await f.req("GET", "/channels/whatsapp")).body.data;
        const created = await f.req("POST", "/channels/whatsapp/templates", {
            name: "jomcall_reply_request",
            language: "ms",
            category: "utility",
            purpose: "reengage",
            body: "Kami ada balasan untuk pertanyaan anda. Sila balas mesej ini untuk menyambung perbualan.",
            variables: 0,
          });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const tpl = created.body.data;
        assert.ok(overview.channel);
        await f.req("PATCH", `/channels/whatsapp/templates/${tpl.id}`, {
          status: "approved",
          expectedRevision: tpl.revision,
        });
        // The customer's last message is now 25 hours old.
        await f.h.cleanup.query(
          "update app.conversation set last_inbound_at=now()-interval '25 hours' where id=$1",
          [c.id],
        );
        const reply = async (text: string) => {
          const d = (await f.req("GET", `/conversations/${c.id}`)).body.data;
          const r = await f.req("POST", `/conversations/${c.id}/messages`, {
            text,
            expectedRevision: d.revision,
          });
          assert.equal(r.status, 200, JSON.stringify(r.body));
          await f.worker.tick();
          return (await f.messages()).at(-1);
        };
        const blocked = await reply("Maaf lambat balas.");
        assert.equal(blocked.status, "blocked");
        assert.equal(blocked.error_code, "CONSENT_REQUIRED");
        await f.req("POST", `/contacts/${c.contact_id}/consents`, {
          channel: "whatsapp",
          purpose: "service",
          granted: true,
          source: "in_person",
          evidence: "Borang di kaunter (contoh)",
          expectedRevision: (await f.req("GET", `/contacts/${c.contact_id}`))
            .body.data.revision,
        });
        const sentBefore = f.provider.sent.length;
        const fallback = await reply("Maaf lambat balas, sekali lagi.");
        assert.equal(fallback.status, "sent");
        assert.equal(fallback.kind, "template");
        const last = f.provider.sent[sentBefore];
        assert.equal(last.kind, "template");
        assert.equal(
          last.kind === "template" && last.template.name,
          "jomcall_reply_request",
        );
      },
    );

    await t.test(
      "other organizations see nothing and cannot claim the number",
      async () => {
        const c = await f.conversation();
        const asBob = (method: string, path: string, body?: unknown) =>
          f.api.request(f.h.bob, f.h.orgB.id, method, "/api/v1" + path, body);
        assert.equal(
          (await asBob("GET", `/conversations/${c.id}`)).status,
          404,
        );
        assert.deepEqual((await asBob("GET", "/conversations")).body.data, []);
        assert.equal(
          (await asBob("GET", "/channels/whatsapp")).body.data.channel,
          null,
        );
        // Alice's workspace header with Bob's session is refused.
        assert.equal(
          (
            await f.api.request(
              f.h.bob,
              f.h.orgA.id,
              "GET",
              "/api/v1/conversations",
            )
          ).status,
          404,
        );
        const taken = await asBob("PUT", "/channels/whatsapp", {
          phoneNumberId: phone,
          wabaId: "200000002",
          agentEnabled: true,
        });
        assert.equal(taken.status, 409);
        // Staff may work the inbox but not change the channel.
        const asStaff = (method: string, path: string, body?: unknown) =>
          f.api.request(f.h.staff, f.h.orgA.id, method, "/api/v1" + path, body);
        assert.equal(
          (await asStaff("GET", `/conversations/${c.id}`)).status,
          200,
        );
        assert.equal(
          (
            await asStaff("POST", "/channels/whatsapp/disconnect", {
              expectedRevision: 1,
            })
          ).status,
          403,
        );
      },
    );

    await t.test(
      "PDPA export includes the conversation; deletion removes it",
      async () => {
        const c = await f.conversation();
        const contact = (await f.req("GET", `/contacts/${c.contact_id}`)).body
          .data;
        const job = await f.req("POST", `/contacts/${c.contact_id}/export`, {
          expectedRevision: contact.revision,
        });
        assert.equal(job.status, 200, JSON.stringify(job.body));
        await f.h.cleanup.query("select app_private.process_privacy($1,$2)", [
          job.body.data.id,
          f.h.namespace,
        ]);
        const r = await f.api.request(
          f.h.alice,
          f.h.orgA.id,
          "GET",
          `/api/v1/jobs/${job.body.data.id}/download`,
        );
        assert.equal(r.status, 200);
        assert.ok(r.body.conversations.length >= 1);
        assert.ok(r.body.conversations[0].messages.length >= 1);
        await f.h.cleanup.query("delete from app.contact where id=$1", [
          c.contact_id,
        ]);
        const left = await f.h.cleanup.query(
          "select count(*)::int as n from app.message where conversation_id=$1",
          [c.id],
        );
        assert.equal(left.rows[0].n, 0);
      },
    );
  } finally {
    await f.close();
  }
});
