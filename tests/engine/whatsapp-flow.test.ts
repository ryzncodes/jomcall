// End to end against the local database: webhook route, intake, agent turn
// through the shared brain, send rules and the fake provider. No network.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";
import {
  buildInboundText,
  buildStatus,
  openCredentials,
  openSignupCode,
  signBody,
} from "../../packages/whatsapp/src/index.ts";
import { createFakeProvider } from "../../packages/whatsapp/src/fake.ts";
import { WhatsAppWorker, templateListDeadlineMs } from "../../engine/src/whatsapp/worker.ts";
import { entitle } from "../helpers/billing.ts";
import type { ModelDecision } from "../../packages/contracts/src/agent-test.ts";

const secret = "test-app-secret-" + randomUUID();
const phone = String(100000000 + Math.floor(Math.random() * 899999999));
const customer = "6011" + String(Math.floor(Math.random() * 9000000) + 1000000);

const catalogueRows = [
  { item: "Servis biasa 1.0HP", aliases: ["servis aircond"], priceSen: 8000, stockNote: "ada", attributes: {} },
];

// With `core`, a real publish with a pattern pack and a confirmed catalogue,
// so the frozen snapshot carries `packs`; without it, the minimal version.
// With `token`, the channel is saved with a stand-in access token (sealed;
// the fake provider never opens it), as template sync needs stored
// credentials.
async function setup(opts: { core?: boolean; entitled?: boolean; token?: boolean } = {}) {
  Object.assign(process.env, {
    JOMCALL_WHATSAPP_PROVIDER: "fake",
    WHATSAPP_APP_SECRET: secret,
    WHATSAPP_VERIFY_TOKEN: "verify-token-" + randomUUID(),
    ...(opts.token ? { WHATSAPP_CREDENTIALS_KEY: randomBytes(32).toString("hex") } : {}),
  });
  const f = await createPhase2Harness();
  const { h } = f;
  // A plan with the WhatsApp agent and wallet credit (billing design §13).
  if (opts.entitled !== false) await entitle(h.cleanup, h.orgA.id);
  // Publish a minimal agent version directly; publishing rules are tested elsewhere.
  if (opts.core) {
    const path = `/agents/${h.orgA.agentId}`;
    const draft = (await f.req("GET", `${path}/draft`)).body.data;
    const put = await f.req("PUT", `${path}/draft`, {
      expectedRevision: draft.revision,
      settings: {
        name: "Contoh Agent",
        languages: ["ms", "en"],
        manglish: true,
        greeting: "Hello, Contoh Room.",
        instructions: "Answer politely.",
        aiDisclosure: "Saya pembantu AI.",
        recordingEnabled: false,
        recordingDisclosure: "",
        voicePreference: "Leda",
      },
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const rev = () => f.req("GET", `${path}/draft`).then((r) => r.body.data.revision);
    const packs = await f.req("PUT", `${path}/packs`, { expectedAgentRevision: put.body.data.revision, packs: ["stock-price"] });
    assert.equal(packs.status, 200, JSON.stringify(packs.body));
    const cat = await f.req("POST", `${path}/catalogue`, { expectedAgentRevision: await rev(), status: "confirmed", rows: catalogueRows });
    assert.equal(cat.status, 200, JSON.stringify(cat.body));
    const pub = await f.req("POST", `${path}/publish`, { expectedRevision: await rev() });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
  }
  const version = opts.core ? null : (
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
  if (version)
    await h.cleanup.query(
      "update app.agent set published_version_id=$1 where id=$2",
      [version, h.orgA.agentId],
    );
  const saved = await f.req("PUT", "/channels/whatsapp", {
    phoneNumberId: phone,
    wabaId: "200000001",
    agentEnabled: true,
    ...(opts.token ? { accessToken: "stand-in-token" } : {}),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const provider = createFakeProvider();
  // The worker's clock for the template-sync throttle; tests move it.
  const clock = { now: Date.now() };
  let next: any[] = [];
  const seen: { messages: { role: string; content: string }[]; decision?: string }[] = [];
  const worker = new WhatsAppWorker(h.namespace, {
    provider,
    now: () => clock.now,
    model: {
      generate: async (input: any) => {
        seen.push({ messages: input.messages, decision: input.decision });
        return next.shift() ?? { kind: "answer", text: "Baik.", citations: [] };
      },
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
    clock,
    seen,
    worker,
    deliver,
    say,
    conversation,
    messages,
    answer: (d: any[]) => (next = d),
    close: async () => {
      await worker.close();
      // Events are keyed by namespace, not organization: remove them here.
      await h.cleanup.query(
        "delete from app.whatsapp_event where namespace=$1",
        [h.namespace],
      );
      await f.close();
    },
  };
}

// A customer's non-text message in Meta's shape. Fictional ids only.
const mediaDelivery = (id: string, message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "0",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "", phone_number_id: phone },
            contacts: [{ profile: { name: "Aina Contoh" }, wa_id: customer }],
            messages: [
              { from: customer, id, timestamp: String(Math.floor(Date.now() / 1000)), ...message },
            ],
          },
        },
      ],
    },
  ],
});

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
        // With no recorded consent the template cannot go, so the server
        // refuses the staff reply before storing it.
        const d = (await f.req("GET", `/conversations/${c.id}`)).body.data;
        const refused = await f.req("POST", `/conversations/${c.id}/messages`, {
          text: "Maaf lambat balas.",
          expectedRevision: d.revision,
        });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.error.code, "CONSENT_REQUIRED");
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
        // A document from the customer: the export says it existed.
        await f.deliver(
          mediaDelivery("wamid.DOC" + randomUUID(), {
            type: "document",
            document: {
              id: "MEDIAFAKE77",
              mime_type: "application/pdf",
              sha256: "c2hhLWZha2U=",
              filename: "sebut-harga.pdf",
            },
          }),
        );
        await f.worker.tick();
        const c = await f.conversation();
        // A file name stored before the parser cleaned them.
        await f.h.cleanup.query(
          "insert into app.message(org_id,conversation_id,direction,author,kind,body,media,status)values($1,$2,'inbound','customer','media','Fail lama',$3,'received')",
          [f.h.orgA.id, c.id, JSON.stringify({ kind: "document", id: "MEDIAFAKE78", mimeType: "application/pdf", sha256: "", filename: "\u202Eharga.pdf\u0085" })],
        );
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
        const exported = r.body.conversations.flatMap((x: any) => x.messages);
        const doc = exported.find((m: any) => m.kind === "media");
        assert.deepEqual(doc.media, { kind: "document", filename: "sebut-harga.pdf" });
        assert.deepEqual(exported.find((m: any) => m.body === "Fail lama").media, { kind: "document", filename: "harga.pdf" });
        assert.ok(exported.filter((m: any) => m.kind !== "media").every((m: any) => m.media === null));
        // Facts only: no provider media id, hash or file type.
        assert.doesNotMatch(JSON.stringify(r.body.conversations), /MEDIAFAKE77|c2hhLWZha2U=|application\/pdf/);
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

// ---- core tools on WhatsApp ------------------------------------------------
const lookupCall = (args: unknown) => ({ kind: "tool", call: { name: "lookup_catalogue", args } });
const gapAsks = (f: Awaited<ReturnType<typeof setup>>) =>
  f.h.cleanup
    .query("select channel,question from app.knowledge_gap_ask where org_id=$1", [f.h.orgA.id])
    .then((r) => r.rows);
const lastOutbound = async (f: Awaited<ReturnType<typeof setup>>) =>
  (await f.messages()).filter((m) => m.direction === "outbound").at(-1);

test("a WhatsApp turn without packs is unchanged", async () => {
  const f = await setup();
  try {
    f.answer([{ kind: "answer", text: "Baik.", citations: [] }]);
    await f.say("Pukul berapa buka?");
    await f.worker.tick();
    assert.equal(f.seen[0].decision, undefined);
    const system = f.seen[0].messages[0].content.replace(/Current date[^\n]*/, "Current date: <NOW>");
    const expected = JSON.parse(readFileSync(new URL("../fixtures/whatsapp-prompt-without-packs.json", import.meta.url), "utf8"));
    assert.equal(system, expected.system);
    assert.deepEqual(f.seen[0].messages.slice(1).map((m) => m.role), expected.rest);
  } finally {
    await f.close();
  }
});

test("a WhatsApp turn with packs can look up the catalogue", async () => {
  const f = await setup({ core: true });
  try {
    f.answer([
      lookupCall({ item: "servis biasa", code: "", fits: "" }),
      { kind: "answer", text: "Servis biasa RM 80.00.", citations: ["cat:0"] },
    ]);
    await f.say("Berapa harga servis biasa?");
    await f.worker.tick();
    assert.equal(f.seen[0].decision, "core");
    assert.match(f.seen[0].messages[0].content, /lookup_catalogue/);
    assert.match(JSON.stringify(f.seen[1].messages.at(-1)), /Servis biasa 1\.0HP/);
    assert.match(JSON.stringify(f.seen[1].messages.at(-1)), /RM 80\.00/);
    const out = await lastOutbound(f);
    assert.equal(out.status, "sent");
    assert.match(out.body, /RM 80\.00/);
    const steps = await f.h.cleanup.query("select tool from app.conversation_tool_step where org_id=$1", [f.h.orgA.id]);
    assert.ok(steps.rows.some((r) => r.tool === "lookup_catalogue"), JSON.stringify(steps.rows));
  } finally {
    await f.close();
  }
});

test("an over-long or punctuation-only lookup is refused without failing the turn", async () => {
  for (const args of [
    { item: "x".repeat(500), code: "", fits: "" },
    { item: "", code: "-", fits: "" },
  ]) {
    const f = await setup({ core: true });
    try {
      f.answer([lookupCall(args), { kind: "answer", text: "Item apa yang anda maksudkan?", citations: [] }]);
      await f.say("Berapa harga?");
      await f.worker.tick();
      assert.match(JSON.stringify(f.seen[1].messages.at(-1)), /found.{1,5}false/);
      const out = await lastOutbound(f);
      assert.equal(out.status, "sent");
      assert.match(out.body, /Item apa/);
      assert.equal((await gapAsks(f)).length, 0);
    } finally {
      await f.close();
    }
  }
});

test("an unanswered WhatsApp question records a gap on channel whatsapp and still sends the take-a-message reply", async () => {
  const f = await setup({ core: true });
  try {
    f.answer([
      lookupCall({ item: "bateri xyz", code: "", fits: "" }),
      { kind: "tool", call: { name: "take_message", args: { text: "Customer asks about a part we do not list", unanswered: true } } },
      { kind: "answer", text: "Saya telah catat untuk staf kami.", citations: [] },
    ]);
    await f.say("Ada bateri xyz?");
    await f.worker.tick();
    const out = await lastOutbound(f);
    assert.equal(out.status, "sent");
    assert.match(out.body, /catat untuk staf/);
    const asks = await gapAsks(f);
    assert.equal(asks.length, 1);
    assert.equal(asks[0].channel, "whatsapp");
    assert.match(asks[0].question, /bateri xyz/);
  } finally {
    await f.close();
  }
});

test("STOP still opts the contact out when core tools are on", async () => {
  const f = await setup({ core: true });
  try {
    f.answer([{ kind: "answer", text: "MODEL SHOULD NOT ANSWER", citations: [] }]);
    await f.say("STOP");
    await f.worker.tick();
    const c = await f.conversation();
    const consent = (
      await f.h.cleanup.query(
        "select purpose,granted from app.consent_record where contact_id=$1 and channel='whatsapp' order by purpose",
        [c.contact_id],
      )
    ).rows;
    assert.deepEqual(consent, [
      { purpose: "marketing", granted: false },
      { purpose: "service", granted: false },
    ]);
    assert.equal(c.attention_reason, "OPTED_OUT");
    assert.ok(!(await f.messages()).some((m) => m.body.includes("MODEL SHOULD NOT ANSWER")));
    assert.equal(f.seen.length, 0);
  } finally {
    await f.close();
  }
});

test("a bad lookup already parsed by the model client does not fail the turn", async () => {
  const f = await setup({ core: true });
  try {
    // The real clients return this marker, not the raw tool decision.
    f.answer([
      { kind: "bad_lookup" },
      { kind: "answer", text: "Item apa yang anda maksudkan?", citations: [] },
    ]);
    await f.say("Berapa harga?");
    await f.worker.tick();
    assert.match(JSON.stringify(f.seen[1].messages.at(-1)), /found.{1,5}false/);
    const out = await lastOutbound(f);
    assert.equal(out.status, "sent");
    assert.match(out.body, /Item apa/);
  } finally {
    await f.close();
  }
});

// ---- template status sync (design open item O8) ----------------------------
test("template statuses are copied from the provider", async (t) => {
  const f = await setup({ token: true });
  const tplName = "jomcall_reply_request";
  try {
    const db = f.h.cleanup;
    const channel = async () =>
      (
        await db.query(
          "select id,templates_synced_at,templates_sync_reason from app.whatsapp_channel where org_id=$1",
          [f.h.orgA.id],
        )
      ).rows[0];
    const templates = async () =>
      (
        await db.query(
          "select name,language,status,provider_status,synced_at,revision,disabled_by_staff from app.whatsapp_template where org_id=$1 order by name,language",
          [f.h.orgA.id],
        )
      ).rows;
    const due = () =>
      db.query("update app.whatsapp_channel set templates_synced_at=null where org_id=$1", [f.h.orgA.id]);
    const create = async (name: string, language: string) => {
      const r = await f.req("POST", "/channels/whatsapp/templates", {
        name,
        language,
        category: "utility",
        purpose: "reengage",
        body: "Kami ada balasan untuk pertanyaan anda. Sila balas mesej ini untuk menyambung perbualan.",
        variables: 0,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const p = await f.req("PATCH", `/channels/whatsapp/templates/${r.body.data.id}`, {
        status: "pending",
        expectedRevision: r.body.data.revision,
      });
      assert.equal(p.status, 200, JSON.stringify(p.body));
      return p.body.data;
    };
    // A customer conversation whose window has closed, with service consent.
    await f.say("Hai");
    await f.worker.tick();
    let c = await f.conversation();
    await f.req("POST", `/contacts/${c.contact_id}/consents`, {
      channel: "whatsapp",
      purpose: "service",
      granted: true,
      source: "in_person",
      evidence: "Borang di kaunter (contoh)",
      expectedRevision: (await f.req("GET", `/contacts/${c.contact_id}`)).body.data.revision,
    });
    const expire = () =>
      db.query("update app.conversation set last_inbound_at=now()-interval '25 hours' where id=$1", [c.id]);
    const staffReply = async (text: string) => {
      const d = (await f.req("GET", `/conversations/${c.id}`)).body.data;
      const r = await f.req("POST", `/conversations/${c.id}/messages`, { text, expectedRevision: d.revision });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      await f.worker.tick();
      return (await f.messages()).at(-1);
    };

    const ms = await create(tplName, "ms");
    const absent = await create(tplName, "en");
    const count = async () =>
      (await db.query("select count(*)::int as n from app.whatsapp_template where org_id=$1", [f.h.orgA.id])).rows[0].n;
    assert.equal(await count(), 2);

    await t.test("a pending template becomes approved, and the outside-window fallback then uses it", async () => {
      await expire();
      const d = (await f.req("GET", `/conversations/${c.id}`)).body.data;
      assert.equal(d.reply_outlook.reason, "WINDOW_CLOSED");
      f.provider.setTemplates([
        { name: tplName, language: "ms", status: "APPROVED" },
        // At the provider but not here: never created locally.
        { name: "some_other_template", language: "ms", status: "APPROVED" },
      ]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      const [en, my] = await templates();
      assert.equal(my.status, "approved");
      assert.equal(my.provider_status, "APPROVED");
      assert.ok(my.synced_at);
      assert.equal(my.revision, ms.revision + 1);
      // Never seen at the provider and absent from its list: untouched.
      assert.equal(en.status, "pending");
      assert.equal(en.provider_status, null);
      assert.equal(en.revision, absent.revision);
      const ch = await channel();
      assert.ok(ch.templates_synced_at);
      assert.equal(ch.templates_sync_reason, null);
      const sentBefore = f.provider.sent.length;
      const out = await staffReply("Maaf lambat balas.");
      assert.equal(out.status, "sent");
      assert.equal(out.kind, "template");
      const last = f.provider.sent[sentBefore];
      assert.equal(last.kind === "template" && last.template.name, tplName);
    });

    await t.test("the screen's read carries the provider status and the check time", async () => {
      const o = (await f.req("GET", "/channels/whatsapp")).body.data;
      assert.ok(o.channel.templates_synced_at);
      assert.equal(o.channel.templates_sync_reason, null);
      const my = o.templates.find((x: any) => x.language === "ms");
      assert.equal(my.provider_status, "APPROVED");
      assert.ok(my.synced_at);
      assert.equal(o.templates.find((x: any) => x.language === "en").provider_status, null);
    });

    await t.test("a channel is not claimed twice within the hour", async () => {
      assert.equal(await f.worker.syncTemplatesOne(), false);
    });

    await t.test("a manual status change is refused on a synced template, allowed on an unsynced one", async () => {
      const [en, my] = (await f.req("GET", "/channels/whatsapp")).body.data.templates;
      const refused = await f.req("PATCH", `/channels/whatsapp/templates/${my.id}`, {
        status: "rejected",
        expectedRevision: my.revision,
      });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.equal(refused.body.error.code, "CONFLICT");
      assert.equal((await templates())[1].status, "approved");
      const allowed = await f.req("PATCH", `/channels/whatsapp/templates/${en.id}`, {
        status: "rejected",
        expectedRevision: en.revision,
      });
      assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
      const back = await f.req("PATCH", `/channels/whatsapp/templates/${en.id}`, {
        status: "pending",
        expectedRevision: allowed.body.data.revision,
      });
      assert.equal(back.status, 200, JSON.stringify(back.body));
      assert.equal(back.body.data.disabled_by_staff, false);
      // An unsynced template switched off by staff and back on keeps the
      // manual behaviour: the status asked for.
      const off = await f.req("PATCH", `/channels/whatsapp/templates/${en.id}`, {
        status: "disabled",
        expectedRevision: back.body.data.revision,
      });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      assert.deepEqual([off.body.data.status, off.body.data.disabled_by_staff], ["disabled", true]);
      const on = await f.req("PATCH", `/channels/whatsapp/templates/${en.id}`, {
        status: "pending",
        expectedRevision: off.body.data.revision,
      });
      assert.equal(on.status, 200, JSON.stringify(on.body));
      assert.deepEqual([on.body.data.status, on.body.data.disabled_by_staff], ["pending", false]);
    });

    await t.test("APPROVED to PAUSED stops the fallback", async () => {
      await due();
      f.provider.setTemplates([{ name: tplName, language: "ms", status: "PAUSED" }]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      assert.equal((await templates())[1].status, "paused");
      // The customer writes again (a new conversation, as the old window had
      // closed), then the window closes once more.
      await f.say("Ok");
      await f.worker.tick();
      c = await f.conversation();
      await expire();
      const d = (await f.req("GET", `/conversations/${c.id}`)).body.data;
      assert.equal(d.reply_outlook.reason, "WINDOW_CLOSED");
      const sentBefore = f.provider.sent.length;
      const out = await staffReply("Satu lagi.");
      assert.equal(out.status, "blocked");
      assert.equal(out.error_code, "WINDOW_CLOSED");
      assert.equal(f.provider.sent.length, sentBefore);
    });

    await t.test("an unknown provider status leaves the local status and is kept as it came", async () => {
      await due();
      f.provider.setTemplates([{ name: tplName, language: "ms", status: "UNDER_SECOND_LOOK" }]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      const my = (await templates())[1];
      assert.equal(my.status, "paused");
      assert.equal(my.provider_status, "UNDER_SECOND_LOOK");
    });

    await t.test("a provider failure records the reason and changes no status", async () => {
      await due();
      const before = await templates();
      f.provider.failTemplates("META_190");
      assert.equal(await f.worker.syncTemplatesOne(), true);
      assert.equal((await channel()).templates_sync_reason, "META_190");
      assert.deepEqual(
        (await templates()).map((x) => [x.status, x.provider_status, x.revision]),
        before.map((x) => [x.status, x.provider_status, x.revision]),
      );
      assert.equal(
        (await f.req("GET", "/channels/whatsapp")).body.data.channel.templates_sync_reason,
        "META_190",
      );
      // The next good check clears the reason.
      await due();
      f.provider.setTemplates([{ name: tplName, language: "ms", status: "APPROVED" }]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      assert.equal((await channel()).templates_sync_reason, null);
      assert.equal((await templates())[1].status, "approved");
    });

    await t.test("a claimed check reads as pending until its result arrives, then clears", async () => {
      await due();
      const claim = (await db.query("select app_private.whatsapp_template_sync('claim',$1) as value", [f.h.namespace]))
        .rows[0].value;
      assert.ok(claim, "the channel is claimed");
      assert.equal((await channel()).templates_sync_reason, "TEMPLATE_SYNC_PENDING");
      assert.equal(
        (await f.req("GET", "/channels/whatsapp")).body.data.channel.templates_sync_reason,
        "TEMPLATE_SYNC_PENDING",
      );
      await db.query("select app_private.whatsapp_template_sync('result',$1,$2,$3)", [
        f.h.namespace,
        claim.id,
        JSON.stringify({
          wabaId: claim.wabaId,
          revision: claim.revision,
          ok: true,
          templates: [{ name: tplName, language: "ms", status: "APPROVED" }],
        }),
      ]);
      assert.equal((await channel()).templates_sync_reason, null);
      // A failed result replaces the pending marker with its reason.
      await due();
      const again = (await db.query("select app_private.whatsapp_template_sync('claim',$1) as value", [f.h.namespace]))
        .rows[0].value;
      await db.query("select app_private.whatsapp_template_sync('result',$1,$2,$3)", [
        f.h.namespace,
        again.id,
        JSON.stringify({ wabaId: again.wabaId, revision: again.revision, ok: false, reason: "META_190" }),
      ]);
      assert.equal((await channel()).templates_sync_reason, "META_190");
    });

    await t.test("a result is applied only to the claim it answers, once, and only for a well-formed list", async () => {
      const claimNow = async () => {
        await due();
        const v = (await db.query("select app_private.whatsapp_template_sync('claim',$1) as value", [f.h.namespace]))
          .rows[0].value;
        assert.ok(v, "the channel is claimed");
        assert.equal(typeof v.revision, "number");
        return v;
      };
      const answer = async (claim: any, data: Record<string, unknown>) =>
        (
          await db.query("select app_private.whatsapp_template_sync('result',$1,$2,$3) as value", [
            f.h.namespace,
            claim.id,
            JSON.stringify(data),
          ])
        ).rows[0].value;
      const paused = [{ name: tplName, language: "ms", status: "PAUSED" }];
      const shape = async () => (await templates()).map((x) => [x.status, x.provider_status, x.revision]);
      const before = await shape();
      assert.deepEqual(before.map((x) => x[1]), [null, "APPROVED"]);

      // Another business account, another revision, or a channel moved back
      // to pending: not applied, marked stale and due again.
      for (const [label, wrong] of [
        ["business account", (c: any) => ({ wabaId: "999999999", revision: c.revision })],
        ["revision", (c: any) => ({ wabaId: c.wabaId, revision: c.revision + 1 })],
      ] as const) {
        const c = await claimNow();
        assert.deepEqual(await answer(c, { ...wrong(c), ok: true, templates: paused }), { applied: false }, label);
        const ch = await channel();
        assert.equal(ch.templates_sync_reason, "TEMPLATE_SYNC_STALE", label);
        assert.equal(ch.templates_synced_at, null, label);
        assert.deepEqual(await shape(), before, label);
      }
      const c = await claimNow();
      await db.query("update app.whatsapp_channel set state='pending' where org_id=$1", [f.h.orgA.id]);
      try {
        assert.deepEqual(
          await answer(c, { wabaId: c.wabaId, revision: c.revision, ok: true, templates: paused }),
          { applied: false },
        );
        assert.equal((await channel()).templates_sync_reason, "TEMPLATE_SYNC_STALE");
        assert.equal((await channel()).templates_synced_at, null);
        assert.deepEqual(await shape(), before);
      } finally {
        await db.query("update app.whatsapp_channel set state='connected' where org_id=$1", [f.h.orgA.id]);
      }

      // The right answer is applied once; a second one for the same claim is
      // ignored.
      const ok = await claimNow();
      const first = await answer(ok, {
        wabaId: ok.wabaId,
        revision: ok.revision,
        ok: true,
        templates: [{ name: tplName, language: "ms", status: "APPROVED" }],
      });
      assert.equal(first.applied, true);
      const checkedAt = (await channel()).templates_synced_at;
      assert.deepEqual(
        await answer(ok, { wabaId: ok.wabaId, revision: ok.revision, ok: true, templates: paused }),
        { applied: false },
      );
      assert.deepEqual(await answer(ok, { wabaId: ok.wabaId, revision: ok.revision, ok: false, reason: "META_190" }), {
        applied: false,
      });
      assert.equal((await channel()).templates_sync_reason, null);
      assert.deepEqual((await channel()).templates_synced_at, checkedAt);
      assert.deepEqual(await shape(), before);

      // The same name and language twice: refused whole, nothing changes.
      const dup = await claimNow();
      assert.deepEqual(
        await answer(dup, {
          wabaId: dup.wabaId,
          revision: dup.revision,
          ok: true,
          templates: [...paused, { name: tplName, language: "ms", status: "APPROVED" }],
        }),
        { applied: false },
      );
      assert.equal((await channel()).templates_sync_reason, "TEMPLATE_LIST_INVALID");
      assert.deepEqual(await shape(), before);

      // A status that is not upper case counts as not listed: the template
      // seen before is flagged NOT_FOUND with its status kept, the one never
      // seen is untouched.
      const lower = await claimNow();
      const r = await answer(lower, {
        wabaId: lower.wabaId,
        revision: lower.revision,
        ok: true,
        templates: [
          { name: tplName, language: "ms", status: "paused" },
          { name: tplName, language: "en", status: "approved" },
        ],
      });
      assert.deepEqual([r.applied, r.seen, r.changed], [true, 0, 0]);
      const [en, my] = await templates();
      assert.deepEqual([my.status, my.provider_status], ["approved", "NOT_FOUND"]);
      assert.deepEqual([en.status, en.provider_status, en.revision], [before[0][0], null, before[0][2]]);
      assert.equal(my.revision, before[1][2]);
    });

    await t.test("a template seen at the provider and then gone is flagged NOT_FOUND, keeps its status, and the fallback still uses it", async () => {
      // Both templates are seen first (the English one was never seen before).
      await due();
      f.provider.setTemplates([
        { name: tplName, language: "ms", status: "APPROVED" },
        { name: tplName, language: "en", status: "APPROVED" },
      ]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      let [en, my] = await templates();
      assert.deepEqual([en.status, en.provider_status, my.status], ["approved", "APPROVED", "approved"]);
      const revisions = [en.revision, my.revision];

      // Gone from the list: flagged, status and revision unchanged.
      await due();
      f.provider.setTemplates([]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      [en, my] = await templates();
      for (const x of [en, my]) {
        assert.equal(x.status, "approved");
        assert.equal(x.provider_status, "NOT_FOUND");
        assert.ok(x.synced_at);
      }
      assert.deepEqual([en.revision, my.revision], revisions);
      assert.equal((await channel()).templates_sync_reason, null);
      // The screen's read carries the marker.
      const o = (await f.req("GET", "/channels/whatsapp")).body.data;
      assert.equal(o.templates.find((x: any) => x.language === "en").provider_status, "NOT_FOUND");
      // A second check that still finds nothing changes nothing more.
      await due();
      assert.equal(await f.worker.syncTemplatesOne(), true);
      assert.deepEqual((await templates()).map((x) => x.revision), revisions);

      // The outside-window fallback still picks a flagged template.
      await f.say("Hai lagi");
      await f.worker.tick();
      c = await f.conversation();
      await expire();
      const sentBefore = f.provider.sent.length;
      const out = await staffReply("Masih ada templat.");
      assert.equal(out.status, "sent");
      assert.equal(out.kind, "template");
      assert.equal(f.provider.sent.length, sentBefore + 1);

      // Present again: mapped normally; the English one stays flagged.
      await due();
      f.provider.setTemplates([{ name: tplName, language: "ms", status: "APPROVED" }]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      [en, my] = await templates();
      assert.deepEqual([my.status, my.provider_status], ["approved", "APPROVED"]);
      assert.deepEqual([en.status, en.provider_status], ["approved", "NOT_FOUND"]);
    });

    await t.test("staff can switch a template off, a check never switches it on, and switching on restores the provider's status", async () => {
      const read = async () => {
        const list = (await f.req("GET", "/channels/whatsapp")).body.data.templates;
        return [list.find((x: any) => x.language === "en"), list.find((x: any) => x.language === "ms")];
      };
      const patch = (x: any, status: string) =>
        f.req("PATCH", `/channels/whatsapp/templates/${x.id}`, { status, expectedRevision: x.revision });
      let [en, my] = await read();
      assert.equal(my.disabled_by_staff, false);
      // Switching off is allowed on a synced template.
      for (const x of [en, my]) {
        const r = await patch(x, "disabled");
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.data.status, r.body.data.disabled_by_staff], ["disabled", true]);
      }
      // A check that reports both approved records it and keeps them off.
      await due();
      f.provider.setTemplates([
        { name: tplName, language: "ms", status: "APPROVED" },
        { name: tplName, language: "en", status: "APPROVED" },
      ]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      for (const x of await templates())
        assert.deepEqual([x.status, x.provider_status, x.disabled_by_staff], ["disabled", "APPROVED", true]);
      // The outside-window fallback picks neither.
      await f.say("Hai sekali lagi");
      await f.worker.tick();
      c = await f.conversation();
      await expire();
      const sentBefore = f.provider.sent.length;
      const blocked = await staffReply("Templat dimatikan.");
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.error_code, "WINDOW_CLOSED");
      assert.equal(f.provider.sent.length, sentBefore);

      // The English one goes missing at the next check while switched off.
      await due();
      f.provider.setTemplates([{ name: tplName, language: "ms", status: "APPROVED" }]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      [en, my] = await read();
      assert.deepEqual([en.status, en.provider_status], ["disabled", "NOT_FOUND"]);

      // Switching on: any other status asked for. The synced Malay one takes
      // the provider's last status; the one not found gets the status it had
      // before it was switched off.
      const onMy = await patch(my, "pending");
      assert.equal(onMy.status, 200, JSON.stringify(onMy.body));
      assert.deepEqual([onMy.body.data.status, onMy.body.data.disabled_by_staff], ["approved", false]);
      const onEn = await patch(en, "approved");
      assert.equal(onEn.status, 200, JSON.stringify(onEn.body));
      assert.deepEqual([onEn.body.data.status, onEn.body.data.disabled_by_staff], ["approved", false]);
      // Switched on, other manual changes on a synced template stay refused.
      const refused = await patch(onMy.body.data, "rejected");
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      // A stale revision is refused.
      assert.equal((await patch(my, "disabled")).status, 409);
      // The next check that lists the English one maps it again.
      await due();
      f.provider.setTemplates([
        { name: tplName, language: "ms", status: "APPROVED" },
        { name: tplName, language: "en", status: "APPROVED" },
      ]);
      assert.equal(await f.worker.syncTemplatesOne(), true);
      for (const x of await templates())
        assert.deepEqual([x.status, x.provider_status, x.disabled_by_staff], ["approved", "APPROVED", false]);
      const out = await staffReply("Templat dihidupkan.");
      assert.equal(out.status, "sent");
      assert.equal(out.kind, "template");
    });

    await t.test("switching on restores the earlier status when WhatsApp's status is unknown", async () => {
      const mk = async (name: string) => {
        const r = await f.req("POST", "/channels/whatsapp/templates", {
          name,
          language: "en",
          category: "utility",
          purpose: "reengage",
          body: "Hello",
          variables: 0,
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body.data.id as string;
      };
      const row = async (id: string) =>
        (await db.query("select status,provider_status,disabled_by_staff,status_before_off,revision from app.whatsapp_template where id=$1", [id])).rows[0];
      const patch = async (id: string, status: string) => {
        const cur = await row(id);
        return f.req("PATCH", `/channels/whatsapp/templates/${id}`, { status, expectedRevision: cur.revision });
      };
      const cycle = async (id: string, status: string, provider: string | null, ask = "pending") => {
        await db.query("update app.whatsapp_template set status=$2,provider_status=$3 where id=$1", [id, status, provider]);
        const off = await patch(id, "disabled");
        assert.equal(off.status, 200, JSON.stringify(off.body));
        const mid = await row(id);
        assert.deepEqual([mid.status, mid.disabled_by_staff, mid.status_before_off], ["disabled", true, status]);
        const on = await patch(id, ask);
        assert.equal(on.status, 200, JSON.stringify(on.body));
        const end = await row(id);
        assert.equal(end.disabled_by_staff, false);
        assert.equal(end.status_before_off, null);
        assert.equal("status_before_off" in on.body.data, false);
        return end.status;
      };
      const a = await mk("restore_flagged");
      assert.equal(await cycle(a, "approved", "FLAGGED"), "approved");
      const b = await mk("restore_notfound");
      assert.equal(await cycle(b, "approved", "NOT_FOUND"), "approved");
      const c2 = await mk("restore_paused");
      assert.equal(await cycle(c2, "approved", "PAUSED"), "paused");
      const d = await mk("restore_unsynced");
      assert.equal(await cycle(d, "pending", null, "approved"), "pending");
      // A second switch-off while already off keeps the first earlier status.
      const e = await mk("restore_twice");
      await db.query("update app.whatsapp_template set status='approved' where id=$1", [e]);
      assert.equal((await patch(e, "disabled")).status, 200);
      assert.equal((await patch(e, "disabled")).status, 200);
      assert.equal((await row(e)).status_before_off, "approved");
      // A row already stuck (disabled, not by staff, status unknown at
      // WhatsApp) can be restored by hand: approved or pending only.
      const g = await mk("restore_stuck");
      await db.query("update app.whatsapp_template set status='disabled',provider_status='FLAGGED',disabled_by_staff=false,status_before_off=null where id=$1", [g]);
      assert.equal((await patch(g, "rejected")).status, 409);
      const fix = await patch(g, "pending");
      assert.equal(fix.status, 200, JSON.stringify(fix.body));
      assert.deepEqual([fix.body.data.status, fix.body.data.disabled_by_staff], ["pending", false]);
      // Not stuck when the map knows the status: still refused.
      await db.query("update app.whatsapp_template set status='disabled',provider_status='ARCHIVED' where id=$1", [g]);
      assert.equal((await patch(g, "pending")).status, 409);
      // Leave no extra templates for the count checks that follow.
      await db.query("delete from app.whatsapp_template where id=any($1)", [[a, b, c2, d, e, g]]);
    });

    await t.test("channels without a business account id, not connected, or without credentials are skipped", async () => {
      const set = (sql: string) => db.query(`update app.whatsapp_channel set ${sql} where org_id=$1`, [f.h.orgA.id]);
      const saved = (
        await db.query("select waba_id,state,credentials from app.whatsapp_channel where org_id=$1", [f.h.orgA.id])
      ).rows[0];
      await due();
      await set("waba_id=null");
      assert.equal(await f.worker.syncTemplatesOne(), false);
      await db.query("update app.whatsapp_channel set waba_id=$2 where org_id=$1", [f.h.orgA.id, saved.waba_id]);
      await set("state='disabled'");
      assert.equal(await f.worker.syncTemplatesOne(), false);
      await set("state='connected',credentials=null");
      assert.equal(await f.worker.syncTemplatesOne(), false);
      await db.query("update app.whatsapp_channel set credentials=$2 where org_id=$1", [f.h.orgA.id, saved.credentials]);
      assert.equal((await channel()).templates_synced_at, null);
    });

    await t.test("the worker asks for a claim at most once a minute", async () => {
      await due();
      f.clock.now += 59_000;
      await f.worker.tick();
      assert.equal((await channel()).templates_synced_at, null);
      f.clock.now += 1_000;
      await f.worker.tick();
      assert.ok((await channel()).templates_synced_at);
    });

    await t.test("a tick sends replies before it checks templates", async () => {
      // A staff reply inside the window, waiting to go.
      await f.say("Boleh tolong?");
      await f.worker.tick();
      c = await f.conversation();
      const d = (await f.req("GET", `/conversations/${c.id}`)).body.data;
      const r = await f.req("POST", `/conversations/${c.id}/messages`, { text: "Boleh.", expectedRevision: d.revision });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const order: string[] = [];
      const p = f.provider as any;
      const { sendText, sendTemplate, listTemplates } = p;
      p.sendText = (...a: any[]) => (order.push("send"), sendText(...a));
      p.sendTemplate = (...a: any[]) => (order.push("send"), sendTemplate(...a));
      p.listTemplates = (...a: any[]) => (order.push("list"), listTemplates(...a));
      try {
        await due();
        f.clock.now += 60_000;
        await f.worker.tick();
      } finally {
        Object.assign(p, { sendText, sendTemplate, listTemplates });
      }
      assert.ok(order.includes("send"), JSON.stringify(order));
      assert.equal(order.filter((x) => x === "list").length, 1);
      assert.equal(order.at(-1), "list");
    });

    await t.test("a template list that never arrives is answered as timed out at the 20-second deadline", async () => {
      assert.equal(templateListDeadlineMs, 20_000);
      const timers: { fire: () => void; ms: number }[] = [];
      let cleared = 0;
      const worker = new WhatsAppWorker(f.h.namespace, {
        provider: { ...f.provider, listTemplates: () => new Promise<never>(() => {}) },
        model: { generate: async () => ({ kind: "answer", text: "Baik.", citations: [] }) } as any,
        timer: {
          set: (fire, ms) => timers.push({ fire, ms }),
          clear: () => void cleared++,
        },
      });
      try {
        await due();
        const run = worker.syncTemplatesOne();
        for (let i = 0; i < 400 && !timers.length; i++) await new Promise((r) => setTimeout(r, 5));
        assert.equal(timers.length, 1, "the deadline was set");
        assert.equal(timers[0].ms, 20_000);
        assert.equal((await channel()).templates_sync_reason, "TEMPLATE_SYNC_PENDING");
        timers[0].fire();
        assert.equal(await run, true);
        assert.equal((await channel()).templates_sync_reason, "TEMPLATE_LIST_TIMEOUT");
        assert.equal(cleared, 1);
      } finally {
        await worker.close();
      }
    });

    await t.test("only the agent login role can run the sync function", async () => {
      const sig = "app_private.whatsapp_template_sync(text,text,uuid,jsonb)";
      const r = (
        await db.query(
          "select has_function_privilege('jomcall_app',$1,'execute') as web,has_function_privilege('jomcall_agent',$1,'execute') as agent",
          [sig],
        )
      ).rows[0];
      assert.deepEqual(r, { web: false, agent: true });
      const web = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
      await web.connect();
      try {
        await assert.rejects(
          web.query("select app_private.whatsapp_template_sync('claim',$1)", [f.h.namespace]),
          /permission denied/,
        );
      } finally {
        await web.end();
      }
    });

    await t.test("no template was created or deleted by any sync", async () => {
      assert.equal(await count(), 2);
    });
  } finally {
    await f.close();
  }
});

// ---- media and reactions (no download: design open item O4) ---------------
test("a captionless photo is named in the inbox, alerts staff and gets the notice once; a reaction stores nothing", async () => {
  const f = await setup();
  try {
    f.answer([{ kind: "answer", text: "MODEL SHOULD NOT ANSWER", citations: [] }]);
    const photo = await f.deliver(
      mediaDelivery("wamid.IMG" + randomUUID(), {
        type: "image",
        image: { id: "MEDIAFAKE01", mime_type: "image/jpeg", sha256: "c2hhLWZha2U=" },
      }),
    );
    assert.equal(photo.status, 200);
    await f.worker.tick();
    await f.worker.tick();
    const c = await f.conversation();
    assert.equal(c.needs_attention, true);
    assert.equal(c.attention_reason, "UNSUPPORTED_MESSAGE");
    const detail = (await f.req("GET", `/conversations/${c.id}`)).body.data;
    const inbound = detail.messages.filter((m: any) => m.direction === "inbound");
    assert.equal(inbound.length, 1);
    assert.equal(inbound[0].kind, "media");
    assert.equal(inbound[0].body, "");
    assert.deepEqual(inbound[0].media, { kind: "image" });
    assert.doesNotMatch(JSON.stringify(detail), /MEDIAFAKE01|c2hhLWZha2U=|image\/jpeg/);
    // The existing "I can only read text" notice, once, and no model answer.
    const out = detail.messages.filter((m: any) => m.direction === "outbound");
    assert.equal(out.length, 1);
    assert.equal(out[0].author, "system");
    assert.equal(out[0].notice, "notice_unsupported");
    assert.equal(out[0].media, null);
    assert.equal(f.provider.sent.length, 1);
    assert.equal(f.seen.length, 0);

    // A reaction on the notice: no event, no message, no alert, no notice.
    const before = (await f.messages()).length;
    const rid = "wamid.REACT" + randomUUID();
    assert.equal(
      (
        await f.deliver(
          mediaDelivery(rid, { type: "reaction", reaction: { message_id: out[0].id, emoji: "\u{1F44D}" } }),
        )
      ).status,
      200,
    );
    await f.worker.tick();
    const stored = await f.h.cleanup.query(
      "select count(*)::int as n from app.whatsapp_event where dedupe_key=$1",
      ["m:" + rid],
    );
    assert.equal(stored.rows[0].n, 0);
    assert.equal((await f.messages()).length, before);
    assert.equal(f.provider.sent.length, 1);

    // A row stored before the parser kept the kind falls back to the file
    // type's family.
    await f.h.cleanup.query(
      "insert into app.message(org_id,conversation_id,direction,author,kind,body,media,status)values($1,$2,'inbound','customer','media','Dengar ni',$3,'received')",
      [f.h.orgA.id, c.id, JSON.stringify({ id: "MEDIAFAKE02", mimeType: "audio/ogg", sha256: "", caption: "Dengar ni", filename: "" })],
    );
    const again = (await f.req("GET", `/conversations/${c.id}`)).body.data;
    const voice = again.messages.find((m: any) => m.body === "Dengar ni");
    assert.deepEqual(voice.media, { kind: "audio" });

    // File names stored before the parser cleaned them are cleaned on read;
    // a name with nothing else left is dropped.
    for (const [body, filename] of [
      ["Fail lama", "harga\u202Efdp.exe\u0007"],
      ["Fail kosong", "\u0001\u2066\u009f"],
    ])
      await f.h.cleanup.query(
        "insert into app.message(org_id,conversation_id,direction,author,kind,body,media,status)values($1,$2,'inbound','customer','media',$3,$4,'received')",
        [f.h.orgA.id, c.id, body, JSON.stringify({ kind: "document", id: "MEDIAFAKE03", mimeType: "application/pdf", sha256: "", filename })],
      );
    const cleaned = (await f.req("GET", `/conversations/${c.id}`)).body.data.messages;
    assert.deepEqual(cleaned.find((m: any) => m.body === "Fail lama").media, { kind: "document", filename: "hargafdp.exe" });
    assert.deepEqual(cleaned.find((m: any) => m.body === "Fail kosong").media, { kind: "document" });
  } finally {
    await f.close();
  }
});

test("checking a number subscribes the app to the business account", async (t) => {
  const f = await setup({ token: true });
  try {
    const db = f.h.cleanup;
    const channel = async () =>
      (
        await db.query(
          "select state,state_reason,revision from app.whatsapp_channel where org_id=$1",
          [f.h.orgA.id],
        )
      ).rows[0];
    const state = async () => {
      const { revision, ...rest } = await channel();
      return rest;
    };
    // A first-time connect: disconnect first, so the save starts a full check
    // (a connected number saved again is only re-checked, see the re-check test).
    const save = async () => {
      const d = await f.req("POST", "/channels/whatsapp/disconnect", {
        expectedRevision: (await channel()).revision,
      });
      assert.equal(d.status, 200, JSON.stringify(d.body));
      const r = await f.req("PUT", "/channels/whatsapp", {
        expectedRevision: (await channel()).revision,
        phoneNumberId: phone,
        wabaId: "200000001",
        agentEnabled: true,
        accessToken: "stand-in-token",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    };

    await t.test("a verified number is subscribed once, then connected", async () => {
      // setup() already ran the first check.
      assert.deepEqual(f.provider.subscribed, [{ wabaId: "200000001" }]);
      assert.deepEqual(await state(), { state: "connected", state_reason: null });
    });

    await t.test("a failing subscribe leaves the channel failed with the reason", async () => {
      f.provider.failSubscribe("META_190");
      await save();
      await f.worker.tick();
      assert.deepEqual(await state(), { state: "failed", state_reason: "META_190" });
      assert.equal(f.provider.subscribed.length, 2);
    });

    await t.test("a retry that succeeds connects and clears the reason", async () => {
      f.provider.failSubscribe(undefined);
      await save();
      await f.worker.tick();
      assert.deepEqual(await state(), { state: "connected", state_reason: null });
      assert.equal(f.provider.subscribed.length, 3);
    });

    await t.test("a Meta code other than an expired token is stored as SUBSCRIBE_FAILED", async () => {
      f.provider.failSubscribe("META_200");
      await save();
      await f.worker.tick();
      assert.deepEqual(await state(), { state: "failed", state_reason: "SUBSCRIBE_FAILED" });
      f.provider.failSubscribe("PROVIDER_UNREACHABLE");
      await save();
      await f.worker.tick();
      assert.deepEqual(await state(), { state: "failed", state_reason: "PROVIDER_UNREACHABLE" });
      f.provider.failSubscribe(undefined);
      await save();
      await f.worker.tick();
      assert.deepEqual(await state(), { state: "connected", state_reason: null });
    });

    await t.test("a token that is only spaces keeps the saved one", async () => {
      const creds = async () =>
        (await db.query("select credentials::text c from app.whatsapp_channel where org_id=$1", [f.h.orgA.id])).rows[0].c;
      const before = await creds();
      const r = await f.req("PUT", "/channels/whatsapp", {
        expectedRevision: (await channel()).revision,
        phoneNumberId: phone,
        wabaId: "200000001",
        agentEnabled: true,
        accessToken: "   ",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(await creds(), before);
      await f.worker.tick();
    });

    await t.test("a failed number check does not subscribe", async () => {
      const calls = f.provider.subscribed.length;
      f.provider.rejectNumber("META_100");
      await save();
      await f.worker.tick();
      assert.deepEqual(await state(), { state: "failed", state_reason: "META_100" });
      assert.equal(f.provider.subscribed.length, calls);
    });

    await t.test("a provider that throws on subscribe fails the check without connecting", async () => {
      f.provider.rejectNumber(undefined);
      f.provider.subscribeApp = async () => {
        throw Error("boom");
      };
      await save();
      await f.worker.tick();
      assert.deepEqual(await state(), { state: "failed", state_reason: "SUBSCRIBE_FAILED" });
    });
  } finally {
    await f.close();
  }
});

test("a connected number saved again stays connected while it is checked", async (t) => {
  const f = await setup({ token: true });
  const secretToken = "SECRET-TOKEN-" + randomUUID();
  try {
    const db = f.h.cleanup;
    const otherPhone = String(Number(phone) + 1);
    const row = async () =>
      (
        await db.query(
          "select id,state,state_reason,phone_number_id,recheck_wanted,last_check_failed_reason,last_check_failed_at,revision from app.whatsapp_channel where org_id=$1",
          [f.h.orgA.id],
        )
      ).rows[0];
    const put = async (extra: Record<string, unknown> = {}) => {
      const r = await f.req("PUT", "/channels/whatsapp", {
        expectedRevision: (await row()).revision,
        phoneNumberId: phone,
        wabaId: "200000001",
        agentEnabled: true,
        accessToken: secretToken,
        ...extra,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data;
    };
    const lastEvent = async () =>
      (
        await db.query(
          "select state from app.whatsapp_event where namespace=$1 order by received_at desc,id desc limit 1",
          [f.h.namespace],
        )
      ).rows[0]?.state;
    // An inbound text is taken in and an agent turn can be claimed.
    const acceptsMessages = async (id: string, text: string) => {
      const before = (await f.messages()).length;
      assert.equal((await f.say(text, id)).status, 200);
      await f.worker.op("ingest");
      assert.equal(await lastEvent(), "done");
      assert.equal(await f.worker.runOneTurn(), true);
      assert.ok((await f.messages()).length > before);
    };
    const quietLog = async (run: () => Promise<unknown>) => {
      const lines: string[] = [];
      const original = console.error;
      console.error = (...a: unknown[]) => void lines.push(a.join(" "));
      try {
        await run();
      } finally {
        console.error = original;
      }
      return lines;
    };

    await t.test("same number: connected, replies keep working while the check waits", async () => {
      await put();
      const r = await row();
      assert.equal(r.state, "connected");
      assert.equal(r.state_reason, null);
      assert.equal(r.recheck_wanted, true);
      await acceptsMessages("wamid.IN" + randomUUID(), "Berapa harga servis?");
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.recheck_wanted, false);
      assert.equal(after.last_check_failed_reason, null);
    });

    await t.test("a re-check that fails at the number step keeps it connected with a warning", async () => {
      f.provider.rejectNumber("META_100", "META_100_33");
      await put();
      assert.equal((await row()).state, "connected");
      const lines = await quietLog(() => f.worker.tick());
      const r = await row();
      assert.equal(r.state, "connected");
      assert.equal(r.state_reason, null);
      assert.equal(r.recheck_wanted, false);
      assert.equal(r.last_check_failed_reason, "META_100");
      assert.ok(r.last_check_failed_at);
      const log = lines.filter((l) => l.startsWith("WHATSAPP_CHECK_FAILED"));
      assert.deepEqual(log, ["WHATSAPP_CHECK_FAILED step=verify reason=META_100 provider=META_100_33"]);
      for (const l of lines) {
        assert.ok(!l.includes(secretToken) && !l.includes("fake-token") && !l.includes(phone) && !l.includes(customer), l);
      }
      await acceptsMessages("wamid.IN" + randomUUID(), "Masih buka?");
    });

    await t.test("a later passing check clears the warning", async () => {
      f.provider.rejectNumber(undefined);
      await put();
      assert.equal((await row()).last_check_failed_reason, null);
      await f.worker.tick();
      const r = await row();
      assert.equal(r.state, "connected");
      assert.equal(r.last_check_failed_reason, null);
      assert.equal(r.last_check_failed_at, null);
    });

    await t.test("a re-check that fails at subscribe keeps it connected with a warning", async () => {
      f.provider.failSubscribe("META_200", "META_200_33");
      await put();
      const lines = await quietLog(() => f.worker.tick());
      const r = await row();
      assert.equal(r.state, "connected");
      assert.equal(r.last_check_failed_reason, "SUBSCRIBE_FAILED");
      assert.ok(r.last_check_failed_at);
      assert.deepEqual(
        lines.filter((l) => l.startsWith("WHATSAPP_CHECK_FAILED")),
        ["WHATSAPP_CHECK_FAILED step=subscribe reason=SUBSCRIBE_FAILED provider=META_200_33"],
      );
      await acceptsMessages("wamid.IN" + randomUUID(), "Boleh tempah?");
      f.provider.failSubscribe(undefined);
      await put();
      await f.worker.tick();
      assert.equal((await row()).last_check_failed_reason, null);
    });

    await t.test("a new business account id with the same number stays connected and subscribes to it", async () => {
      const before = f.provider.subscribed.length;
      await put({ wabaId: "200000009" });
      assert.equal((await row()).state, "connected");
      await f.worker.tick();
      assert.equal((await row()).state, "connected");
      assert.deepEqual(f.provider.subscribed.slice(before), [{ wabaId: "200000009" }]);
      f.provider.failSubscribe("META_100");
      await put({ wabaId: "200000001" });
      await f.worker.tick();
      assert.equal((await row()).state, "connected");
      assert.equal((await row()).last_check_failed_reason, "SUBSCRIBE_FAILED");
      f.provider.failSubscribe(undefined);
      await put();
      await f.worker.tick();
    });

    await t.test("a changed phone number id goes to pending and its events are ignored until it passes", async () => {
      await put({ phoneNumberId: otherPhone });
      const r = await row();
      assert.equal(r.state, "pending");
      assert.equal(r.recheck_wanted, false);
      assert.equal(r.last_check_failed_reason, null);
      await f.deliver(
        buildInboundText({ phoneNumberId: otherPhone, from: customer, name: "Aina Contoh", id: "wamid.IN" + randomUUID(), text: "Hai" }),
      );
      await f.worker.op("ingest");
      assert.equal(await lastEvent(), "ignored");
      await f.worker.tick();
      assert.equal((await row()).state, "connected");
      assert.equal((await row()).phone_number_id, otherPhone);
      await put({ phoneNumberId: phone });
      await f.worker.tick();
    });

    await t.test("a first-time connect that fails still ends failed", async () => {
      const d = await f.req("POST", "/channels/whatsapp/disconnect", { expectedRevision: (await row()).revision });
      assert.equal(d.status, 200);
      f.provider.rejectNumber("META_190");
      await put();
      assert.equal((await row()).state, "pending");
      await f.worker.tick();
      const r = await row();
      assert.equal(r.state, "failed");
      assert.equal(r.state_reason, "META_190");
      assert.equal(r.last_check_failed_reason, null);
      f.provider.rejectNumber(undefined);
      await put();
      await f.worker.tick();
      assert.equal((await row()).state, "connected");
    });

    await t.test("a result that arrives after a disconnect does not reconnect the channel", async () => {
      await put();
      const claim = await f.worker.op("verify_claim");
      assert.equal(claim.revision, (await row()).revision);
      const d = await f.req("POST", "/channels/whatsapp/disconnect", { expectedRevision: claim.revision });
      assert.equal(d.status, 200);
      for (const ok of [true, false]) {
        const a = await f.worker.op("verify_result", claim.id, null, { revision: claim.revision, ok, reason: "META_100" });
        assert.equal(a.applied, false);
      }
      const r = await row();
      assert.equal(r.state, "not_connected");
      assert.equal(r.recheck_wanted, false);
      assert.equal(r.last_check_failed_reason, null);
      await put();
      await f.worker.tick();
    });

    await t.test("a result that arrives after the number changed, or after a newer save, is ignored", async () => {
      await put();
      const claim = await f.worker.op("verify_claim");
      await put({ phoneNumberId: otherPhone });
      const a = await f.worker.op("verify_result", claim.id, null, { revision: claim.revision, ok: false, reason: "META_100" });
      assert.equal(a.applied, false);
      const r = await row();
      assert.equal(r.state, "pending");
      assert.equal(r.phone_number_id, otherPhone);
      assert.equal(r.last_check_failed_reason, null);
      await f.worker.tick();
      await put({ phoneNumberId: phone });
      await f.worker.tick();
      // Same number saved twice: the first claim's answer is stale.
      await put();
      const first = await f.worker.op("verify_claim");
      await put();
      const stale = await f.worker.op("verify_result", first.id, null, { revision: first.revision, ok: false, reason: "META_100" });
      assert.equal(stale.applied, false);
      const s = await row();
      assert.equal(s.state, "connected");
      assert.equal(s.recheck_wanted, true);
      assert.equal(s.last_check_failed_reason, null);
      await f.worker.tick();
      assert.equal((await row()).recheck_wanted, false);
    });
  } finally {
    await f.close();
  }
});

test("a failing number check does not stop replies", async () => {
  const f = await setup();
  try {
    assert.equal((await f.say("Berapa harga servis?")).status, 200);
    await f.worker.op("ingest");
    // The check step throws (for example the new SQL function is missing).
    (f.worker as any).verifyOne = async () => {
      throw new Error("function app_private.whatsapp_verify does not exist");
    };
    const sentBefore = f.provider.sent.length;
    const lines: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      await f.worker.tick();
    } finally {
      console.error = original;
    }
    assert.equal(f.provider.sent.length, sentBefore + 1);
    const log = lines.filter((l) => l.startsWith("WHATSAPP_CHECK_STEP_FAILED"));
    assert.equal(log.length, 1, lines.join("\n"));
    assert.ok(!log[0].includes("does not exist"), log[0]);
  } finally {
    await f.close();
  }
});

test("a stray recheck flag on a channel that is not connected is inert", async () => {
  const f = await setup({ token: true });
  try {
    const db = f.h.cleanup;
    const row = async () =>
      (await db.query("select state,recheck_wanted,revision from app.whatsapp_channel where org_id=$1", [f.h.orgA.id])).rows[0];
    for (const state of ["pending", "not_connected"]) {
      if (state === "not_connected") {
        const d = await f.req("POST", "/channels/whatsapp/disconnect", { expectedRevision: (await row()).revision });
        assert.equal(d.status, 200, JSON.stringify(d.body));
      } else {
        await db.query("update app.whatsapp_channel set state='pending' where org_id=$1", [f.h.orgA.id]);
      }
      // Stray flag, set by SQL (an older web build never cleared it).
      await db.query("update app.whatsapp_channel set recheck_wanted=true where org_id=$1", [f.h.orgA.id]);
      if (state === "not_connected") {
        assert.equal(await f.worker.op("verify_claim"), null);
        assert.equal((await row()).state, "not_connected");
      }
    }
    // Disconnect is never blocked by the flag.
    await db.query("update app.whatsapp_channel set state='connected',recheck_wanted=true where org_id=$1", [f.h.orgA.id]);
    await db.query("update app.whatsapp_channel set state='failed' where org_id=$1", [f.h.orgA.id]);
    const d = await f.req("POST", "/channels/whatsapp/disconnect", { expectedRevision: (await row()).revision });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal((await row()).recheck_wanted, false);
    // A stray flag, then a first-time connect works as usual.
    await db.query("update app.whatsapp_channel set recheck_wanted=true where org_id=$1", [f.h.orgA.id]);
    const r = await f.req("PUT", "/channels/whatsapp", {
      expectedRevision: (await row()).revision,
      phoneNumberId: phone,
      wabaId: "200000001",
      agentEnabled: true,
      accessToken: "stand-in-token",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await row()).state, "pending");
    assert.equal((await row()).recheck_wanted, false);
    await f.worker.tick();
    assert.equal((await row()).state, "connected");
  } finally {
    await f.close();
  }
});

test("only the agent login role can run the number check function", async () => {
  const f = await setup();
  try {
    const sig = "app_private.whatsapp_verify(text,text,uuid,jsonb)";
    const r = (
      await f.h.cleanup.query(
        "select has_function_privilege('jomcall_app',$1,'execute') as web,has_function_privilege('jomcall_agent',$1,'execute') as agent",
        [sig],
      )
    ).rows[0];
    assert.deepEqual(r, { web: false, agent: true });
    const web = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
    await web.connect();
    try {
      await assert.rejects(
        web.query("select app_private.whatsapp_verify('claim',$1)", [f.h.namespace]),
        /permission denied/,
      );
    } finally {
      await web.end();
    }
  } finally {
    await f.close();
  }
});

test("Embedded Signup connects a number through the agent process", async (t) => {
  const f = await setup({ token: true });
  const saved = {
    WHATSAPP_SIGNUP_COEXISTENCE: process.env.WHATSAPP_SIGNUP_COEXISTENCE,
    WHATSAPP_APP_ID: process.env.WHATSAPP_APP_ID,
    WHATSAPP_SIGNUP_CONFIG_ID: process.env.WHATSAPP_SIGNUP_CONFIG_ID,
  };
  try {
    const db = f.h.cleanup;
    const row = async () =>
      (
        await db.query(
          "select id,state,state_reason,revision,signup_pending,signup_coexistence,signup_code,credentials,credentials::text as sealed,credentials_set_at,last_check_failed_reason from app.whatsapp_channel where org_id=$1",
          [f.h.orgA.id],
        )
      ).rows[0];
    const signup = async (extra: Record<string, unknown> = {}) =>
      f.req("POST", "/channels/whatsapp/signup", {
        expectedRevision: (await row()).revision,
        phoneNumberId: phone,
        wabaId: "200000001",
        code: "one-time-code",
        agentEnabled: true,
        ...extra,
      });
    const disconnect = async () => {
      const d = await f.req("POST", "/channels/whatsapp/disconnect", {
        expectedRevision: (await row()).revision,
      });
      assert.equal(d.status, 200, JSON.stringify(d.body));
    };
    // In practice mode the worker seals the fake provider's token with its
    // fixed stand-in key.
    const opened = async (key = "0".repeat(64)) =>
      openCredentials((await row()).credentials, key, f.h.orgA.id);

    await t.test("a first connect: the code is exchanged, the number registered, the token sealed", async () => {
      await disconnect();
      const r = await signup();
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.state, "pending");
      assert.equal(r.body.data.signup_pending, true);
      // Nothing about the code or a token is returned.
      assert.equal(JSON.stringify(r.body).includes("one-time-code"), false);
      assert.equal("credentials" in r.body.data, false);
      assert.equal("signup_code" in r.body.data, false);
      const subscribed = f.provider.subscribed.length;
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.state_reason, null);
      assert.equal(after.signup_pending, false);
      assert.equal(after.signup_code, null);
      assert.equal(after.last_check_failed_reason, null);
      assert.ok(after.credentials_set_at);
      assert.deepEqual(f.provider.exchanged, ["fake-code"]);
      assert.equal(f.provider.subscribed.length, subscribed + 1);
      assert.equal(f.provider.registered.length, 1);
      assert.equal(f.provider.registered[0].phoneNumberId, phone);
      assert.match(f.provider.registered[0].pin, /^[0-9]{6}$/);
      assert.deepEqual(await opened(), {
        accessToken: "fake-signup-token",
        pin: f.provider.registered[0].pin,
      });
    });

    await t.test("a stale revision is refused and nothing is exchanged", async () => {
      const r = await signup({ expectedRevision: (await row()).revision + 5 });
      assert.equal(r.status, 409, JSON.stringify(r.body));
      await f.worker.tick();
      assert.equal(f.provider.exchanged.length, 1);
      assert.equal((await row()).state, "connected");
    });

    await t.test("connecting again keeps a working number connected on its old token until the new one passes", async () => {
      const before = await row();
      const r = await signup();
      assert.equal(r.status, 200, JSON.stringify(r.body));
      // Still connected, still the old token, while the agent process works.
      assert.equal(r.body.data.state, "connected");
      assert.equal(r.body.data.signup_pending, true);
      assert.equal((await row()).sealed, before.sealed);
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.signup_pending, false);
      assert.notEqual(after.sealed, before.sealed);
      assert.equal(f.provider.exchanged.length, 2);
    });

    await t.test("a refused code on a working number changes nothing but a warning", async () => {
      const before = await row();
      f.provider.failExchange("SIGNUP_CODE_REJECTED");
      assert.equal((await signup()).status, 200);
      const registered = f.provider.registered.length,
        subscribed = f.provider.subscribed.length;
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.state_reason, null);
      assert.equal(after.last_check_failed_reason, "SIGNUP_CODE_REJECTED");
      assert.equal(after.signup_pending, false);
      assert.equal(after.signup_code, null);
      assert.equal(after.sealed, before.sealed);
      // No number check, no subscription, no registration without a token.
      assert.equal(f.provider.registered.length, registered);
      assert.equal(f.provider.subscribed.length, subscribed);
      // The spent code is not tried again on the next pass.
      const tries = f.provider.exchanged.length;
      await f.worker.tick();
      assert.equal(f.provider.exchanged.length, tries);
    });

    await t.test("a failed number check after the exchange keeps the old token", async () => {
      const before = await row();
      f.provider.failExchange(undefined);
      f.provider.rejectNumber("META_100");
      assert.equal((await signup()).status, 200);
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.last_check_failed_reason, "META_100");
      assert.equal(after.sealed, before.sealed);
      f.provider.rejectNumber(undefined);
    });

    await t.test("a refused code on a first connect ends failed with no credentials", async () => {
      await disconnect();
      f.provider.failExchange("SIGNUP_CODE_REJECTED");
      assert.equal((await signup()).status, 200);
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "failed");
      assert.equal(after.state_reason, "SIGNUP_CODE_REJECTED");
      assert.equal(after.signup_pending, false);
      assert.equal(after.credentials, null);
      f.provider.failExchange(undefined);
    });

    await t.test("a number that cannot be registered still connects, with a warning", async () => {
      f.provider.failRegister("REGISTER_FAILED", "META_133005");
      assert.equal((await signup()).status, 200);
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.last_check_failed_reason, "REGISTER_FAILED");
      // No PIN is kept for a registration Meta refused.
      assert.deepEqual(await opened(), { accessToken: "fake-signup-token" });
    });

    await t.test("an unreachable provider at registration keeps the PIN, which may have been set", async () => {
      f.provider.failRegister("PROVIDER_UNREACHABLE");
      assert.equal((await signup()).status, 200);
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.last_check_failed_reason, "PROVIDER_UNREACHABLE");
      assert.deepEqual(await opened(), {
        accessToken: "fake-signup-token",
        pin: f.provider.registered.at(-1)!.pin,
      });
      f.provider.failRegister(undefined);
    });

    await t.test("coexistence is refused unless switched on, and is never registered", async () => {
      delete process.env.WHATSAPP_SIGNUP_COEXISTENCE;
      const refused = await signup({ coexistence: true });
      assert.equal(refused.status, 422, JSON.stringify(refused.body));
      assert.equal(refused.body.error.code, "COEXISTENCE_OFF");
      process.env.WHATSAPP_SIGNUP_COEXISTENCE = "1";
      const r = await signup({ coexistence: true });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const registered = f.provider.registered.length;
      await f.worker.tick();
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.signup_coexistence, true);
      assert.equal(f.provider.registered.length, registered);
      assert.deepEqual(await opened(), { accessToken: "fake-signup-token" });
      delete process.env.WHATSAPP_SIGNUP_COEXISTENCE;
    });

    await t.test("a pasted token before the agent process gets to it replaces the signup", async () => {
      await disconnect();
      assert.equal((await signup()).status, 200);
      const r = await f.req("PUT", "/channels/whatsapp", {
        expectedRevision: (await row()).revision,
        phoneNumberId: phone,
        wabaId: "200000001",
        agentEnabled: true,
        accessToken: "stand-in-token",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal((await row()).signup_pending, false);
      const tries = f.provider.exchanged.length;
      await f.worker.tick();
      assert.equal(f.provider.exchanged.length, tries);
      assert.equal((await row()).state, "connected");
    });

    await t.test("a disconnect while Meta is being asked drops the new token", async () => {
      assert.equal((await signup()).status, 200);
      const exchange = f.provider.exchangeSignupCode;
      f.provider.exchangeSignupCode = async (input) => {
        await disconnect();
        return exchange(input);
      };
      await f.worker.tick();
      f.provider.exchangeSignupCode = exchange;
      const after = await row();
      assert.equal(after.state, "not_connected");
      assert.equal(after.credentials, null);
      assert.equal(after.signup_pending, false);
      assert.equal(after.signup_code, null);
    });

    await t.test("a result's credentials are ignored for a channel that is not a signup", async () => {
      const r = await f.req("PUT", "/channels/whatsapp", {
        expectedRevision: (await row()).revision,
        phoneNumberId: phone,
        wabaId: "200000001",
        agentEnabled: true,
        accessToken: "stand-in-token",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const before = await row();
      assert.equal(before.state, "pending");
      const applied = await f.worker.op("verify_result", before.id, null, {
        revision: before.revision,
        ok: true,
        credentials: { version: 1, iv: "a".repeat(24), tag: "b".repeat(32), data: "cc" },
      });
      assert.deepEqual(applied, { applied: true });
      const after = await row();
      assert.equal(after.state, "connected");
      assert.equal(after.sealed, before.sealed);
    });

    await t.test("a passing signup result without a sealed token is refused", async () => {
      await disconnect();
      assert.equal((await signup()).status, 200);
      const before = await row();
      for (const credentials of [
        undefined,
        "text",
        { version: 2, iv: "a".repeat(24), tag: "b".repeat(32), data: "cc" },
        { version: 1, iv: "zz", tag: "b".repeat(32), data: "cc" },
        { version: 1, iv: "a".repeat(24), tag: "b".repeat(32), data: "c".repeat(7902) },
      ]) {
        await db.query(
          "update app.whatsapp_channel set state='pending',signup_pending=true where id=$1",
          [before.id],
        );
        const now = await row();
        await f.worker.op("verify_result", now.id, null, {
          revision: now.revision,
          ok: true,
          credentials,
        });
        const after = await row();
        assert.equal(after.state, "failed", JSON.stringify(credentials)?.slice(0, 40));
        assert.equal(after.state_reason, "SIGNUP_TOKEN_MISSING");
        assert.equal(after.credentials, null);
      }
    });

    await t.test("with the real provider setting, the code is sealed by web and opened by the agent process", async () => {
      const key = process.env.WHATSAPP_CREDENTIALS_KEY!;
      process.env.JOMCALL_WHATSAPP_PROVIDER = "cloud";
      try {
        delete process.env.WHATSAPP_APP_ID;
        delete process.env.WHATSAPP_SIGNUP_CONFIG_ID;
        // Without the signup settings the code would be spent for nothing.
        const refused = await signup();
        assert.equal(refused.status, 503, JSON.stringify(refused.body));
        assert.equal(refused.body.error.code, "SIGNUP_NOT_AVAILABLE");
        process.env.WHATSAPP_APP_ID = "500000001";
        process.env.WHATSAPP_SIGNUP_CONFIG_ID = "400000001";
        const r = await signup({ code: "real-shaped-code" });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const pending = await row();
        assert.equal(pending.credentials, null);
        assert.equal(
          openSignupCode(pending.signup_code, key, f.h.orgA.id),
          "real-shaped-code",
        );
        assert.equal(JSON.stringify(pending.signup_code).includes("real-shaped-code"), false);
        await f.worker.tick();
        const after = await row();
        assert.equal(after.state, "connected");
        assert.equal(after.signup_code, null);
        assert.equal(f.provider.exchanged.at(-1), "real-shaped-code");
        assert.deepEqual(await opened(key), {
          accessToken: "fake-signup-token",
          pin: f.provider.registered.at(-1)!.pin,
        });
      } finally {
        process.env.JOMCALL_WHATSAPP_PROVIDER = "fake";
      }
    });

    // The web role can write the sealed code and never read it back.
    const web = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
    await web.connect();
    try {
      await assert.rejects(
        web.query("select signup_code from app.whatsapp_channel limit 1"),
        /permission denied/,
      );
    } finally {
      await web.end();
    }
  } finally {
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    process.env.JOMCALL_WHATSAPP_PROVIDER = "fake";
    await f.close();
  }
});

test("Submit to WhatsApp sends a template for review through the agent process", async (t) => {
  const f = await setup({ token: true });
  try {
    const db = f.h.cleanup;
    const channelRevision = async () =>
      (await db.query("select revision from app.whatsapp_channel where org_id=$1", [f.h.orgA.id])).rows[0].revision;
    const add = async (name: string, extra: Record<string, unknown> = {}) => {
      const r = await f.req("POST", "/channels/whatsapp/templates", {
        name,
        language: "en",
        category: "utility",
        purpose: "other",
        body: "We have a reply to your enquiry. Please reply to continue.",
        variables: 0,
        ...extra,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.id as string;
    };
    const row = async (id: string) =>
      (
        await db.query(
          "select status,provider_status,submit_state,submit_reason,submitted_at,submit_claimed_at,synced_at,revision,disabled_by_staff from app.whatsapp_template where id=$1",
          [id],
        )
      ).rows[0];
    const submit = async (id: string, revision?: number) =>
      f.req("POST", `/channels/whatsapp/templates/${id}/submit`, {
        expectedRevision: revision ?? (await row(id)).revision,
      });
    const agentDb = (f.worker as unknown as { pool: pg.Pool }).pool;

    await t.test("a template staff submit is created at the provider and recorded as seen there", async () => {
      const id = await add("submit_one");
      const r = await submit(id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.submit_state, "wanted");
      await f.worker.tick();
      assert.deepEqual(f.provider.created, [
        {
          wabaId: "200000001",
          name: "submit_one",
          language: "en",
          category: "utility",
          body: "We have a reply to your enquiry. Please reply to continue.",
          variables: 0,
        },
      ]);
      const after = await row(id);
      assert.equal(after.status, "pending");
      assert.equal(after.provider_status, "PENDING");
      assert.equal(after.submit_state, null);
      assert.equal(after.submit_reason, null);
      assert.ok(after.submitted_at);
      assert.ok(after.synced_at);
      // Not sent twice.
      await f.worker.tick();
      assert.equal(f.provider.created.length, 1);
      // Seen at the provider: it cannot be submitted again.
      assert.equal((await submit(id)).status, 409);
    });

    await t.test("the provider's own status is kept; an unsaid one reads as pending", async () => {
      f.provider.createStatus("APPROVED");
      const approved = await add("submit_approved");
      assert.equal((await submit(approved)).status, 200);
      await f.worker.tick();
      assert.deepEqual(
        [(await row(approved)).status, (await row(approved)).provider_status],
        ["approved", "APPROVED"],
      );
      f.provider.createStatus(null);
      const unsaid = await add("submit_unsaid");
      assert.equal((await submit(unsaid)).status, 200);
      await f.worker.tick();
      assert.deepEqual(
        [(await row(unsaid)).status, (await row(unsaid)).provider_status],
        ["pending", "PENDING"],
      );
      f.provider.createStatus("PENDING");
    });

    await t.test("a refusal is kept with its reason, not retried, and staff can try again", async () => {
      const id = await add("submit_refused");
      f.provider.failCreate("TEMPLATE_SUBMIT_FAILED", "META_100_2388024");
      assert.equal((await submit(id)).status, 200);
      const before = f.provider.created.length;
      await f.worker.tick();
      let after = await row(id);
      assert.equal(after.submit_state, "failed");
      assert.equal(after.submit_reason, "TEMPLATE_SUBMIT_FAILED");
      assert.equal(after.provider_status, null);
      assert.equal(after.status, "draft");
      assert.equal(f.provider.created.length, before + 1);
      await f.worker.tick();
      assert.equal(f.provider.created.length, before + 1);
      f.provider.failCreate(undefined);
      assert.equal((await submit(id)).status, 200);
      await f.worker.tick();
      after = await row(id);
      assert.equal(after.submit_state, null);
      assert.equal(after.provider_status, "PENDING");
    });

    await t.test("a provider that throws ends as a failure, never a loop", async () => {
      const id = await add("submit_throws");
      const real = f.provider.createTemplate;
      let calls = 0;
      f.provider.createTemplate = async () => {
        calls++;
        throw Error("boom");
      };
      assert.equal((await submit(id)).status, 200);
      await f.worker.tick();
      await f.worker.tick();
      f.provider.createTemplate = real;
      assert.equal(calls, 1);
      assert.deepEqual(
        [(await row(id)).submit_state, (await row(id)).submit_reason],
        ["failed", "TEMPLATE_SUBMIT_FAILED"],
      );
    });

    await t.test("a stale revision and a second request while one is waiting are refused", async () => {
      const id = await add("submit_twice");
      assert.equal((await submit(id, 99)).status, 409);
      assert.equal((await submit(id)).status, 200);
      assert.equal((await submit(id)).status, 409);
      assert.equal((await f.req("POST", `/channels/whatsapp/templates/${randomUUID()}/submit`, { expectedRevision: 1 })).status, 404);
      await f.worker.tick();
      assert.equal((await row(id)).provider_status, "PENDING");
    });

    await t.test("a template switched off before the agent process gets to it is not sent", async () => {
      const id = await add("submit_then_off");
      assert.equal((await submit(id)).status, 200);
      const off = await f.req("PATCH", `/channels/whatsapp/templates/${id}`, {
        status: "disabled",
        expectedRevision: (await row(id)).revision,
      });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      const before = f.provider.created.length;
      await f.worker.tick();
      assert.equal(f.provider.created.length, before);
      assert.equal((await row(id)).provider_status, null);
    });

    await t.test("a claim left unanswered is taken again only after five minutes", async () => {
      const id = await add("submit_stuck");
      assert.equal((await submit(id)).status, 200);
      const claim = (await agentDb.query("select app_private.whatsapp_template_submit('claim',$1)as value", [f.h.namespace])).rows[0].value;
      assert.equal(claim.id, id);
      assert.equal(claim.name, "submit_stuck");
      assert.equal((await row(id)).submit_state, "sending");
      const before = f.provider.created.length;
      await f.worker.tick();
      assert.equal(f.provider.created.length, before);
      // An answer for another claim of the same template is ignored.
      const stale = (
        await agentDb.query("select app_private.whatsapp_template_submit('result',$1,$2,$3)as value", [
          f.h.namespace,
          id,
          JSON.stringify({ claimedAt: "2026-01-01T00:00:00.000Z", ok: true, status: "APPROVED" }),
        ])
      ).rows[0].value;
      assert.deepEqual(stale, { applied: false });
      assert.equal((await row(id)).submit_state, "sending");
      await db.query("update app.whatsapp_template set submit_claimed_at=now()-interval '6 minutes' where id=$1", [id]);
      await f.worker.tick();
      assert.equal(f.provider.created.length, before + 1);
      assert.equal((await row(id)).provider_status, "PENDING");
      // The first claim's late answer no longer applies.
      const late = (
        await agentDb.query("select app_private.whatsapp_template_submit('result',$1,$2,$3)as value", [
          f.h.namespace,
          id,
          JSON.stringify({ claimedAt: claim.claimedAt, ok: false, reason: "TEMPLATE_SUBMIT_FAILED" }),
        ])
      ).rows[0].value;
      assert.deepEqual(late, { applied: false });
      assert.equal((await row(id)).submit_state, null);
    });

    await t.test("a template switched off while it is on its way stays off, whatever the provider says", async () => {
      const id = await add("submit_off_midway");
      assert.equal((await submit(id)).status, 200);
      f.provider.createStatus("APPROVED");
      const real = f.provider.createTemplate;
      f.provider.createTemplate = async (draft) => {
        // Staff press Switch off while the provider is being asked.
        const off = await f.req("PATCH", `/channels/whatsapp/templates/${id}`, {
          status: "disabled",
          expectedRevision: (await row(id)).revision,
        });
        assert.equal(off.status, 200, JSON.stringify(off.body));
        return real(draft);
      };
      await f.worker.tick();
      f.provider.createTemplate = real;
      f.provider.createStatus("PENDING");
      const after = await row(id);
      assert.equal(after.disabled_by_staff, true);
      assert.equal(after.status, "disabled");
      assert.equal(after.provider_status, "APPROVED");
      assert.equal(after.submit_state, null);
    });

    await t.test("staff cannot record a status by hand while a submit is waiting or was refused", async () => {
      const id = await add("submit_no_manual");
      f.provider.failCreate("TEMPLATE_SUBMIT_FAILED");
      assert.equal((await submit(id)).status, 200);
      const waiting = await f.req("PATCH", `/channels/whatsapp/templates/${id}`, {
        status: "approved",
        expectedRevision: (await row(id)).revision,
      });
      assert.equal(waiting.status, 409, JSON.stringify(waiting.body));
      await f.worker.tick();
      assert.equal((await row(id)).submit_state, "failed");
      const refused = await f.req("PATCH", `/channels/whatsapp/templates/${id}`, {
        status: "approved",
        expectedRevision: (await row(id)).revision,
      });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.equal((await row(id)).status, "draft");
      f.provider.failCreate(undefined);
      // Switching off forgets the refusal.
      const off = await f.req("PATCH", `/channels/whatsapp/templates/${id}`, {
        status: "disabled",
        expectedRevision: (await row(id)).revision,
      });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      assert.equal((await row(id)).submit_state, null);
    });

    await t.test("a request for a template the status check has meanwhile seen is dropped, not sent", async () => {
      const id = await add("submit_seen_meanwhile");
      assert.equal((await submit(id)).status, 200);
      await db.query("update app.whatsapp_template set provider_status='APPROVED',status='approved' where id=$1", [id]);
      const before = f.provider.created.length;
      await f.worker.tick();
      assert.equal(f.provider.created.length, before);
      const after = await row(id);
      assert.equal(after.submit_state, null);
      assert.equal(after.status, "approved");
    });

    await t.test("a template that was at the provider and is gone can be submitted again", async () => {
      const id = await add("submit_gone");
      await db.query("update app.whatsapp_template set provider_status='NOT_FOUND',status='approved' where id=$1", [id]);
      const r = await submit(id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const before = f.provider.created.length;
      await f.worker.tick();
      assert.equal(f.provider.created.length, before + 1);
      const after = await row(id);
      assert.equal(after.provider_status, "PENDING");
      assert.equal(after.status, "pending");
    });

    await t.test("a business account changed while the provider was asked ends the request as stale", async () => {
      const id = await add("submit_stale_account");
      assert.equal((await submit(id)).status, 200);
      const real = f.provider.createTemplate;
      f.provider.createTemplate = async (draft) => {
        await db.query("update app.whatsapp_channel set waba_id='200000009' where org_id=$1", [f.h.orgA.id]);
        return real(draft);
      };
      await f.worker.tick();
      f.provider.createTemplate = real;
      await db.query("update app.whatsapp_channel set waba_id='200000001' where org_id=$1", [f.h.orgA.id]);
      const after = await row(id);
      assert.equal(after.submit_state, "failed");
      assert.equal(after.submit_reason, "TEMPLATE_SUBMIT_STALE");
      assert.equal(after.provider_status, null);
    });

    await t.test("without stored access the request is refused, and none is ever claimed", async () => {
      const id = await add("submit_no_access");
      const kept = (await db.query("select credentials,credentials_set_at from app.whatsapp_channel where org_id=$1", [f.h.orgA.id])).rows[0];
      await db.query("update app.whatsapp_channel set credentials=null,credentials_set_at=null where org_id=$1", [f.h.orgA.id]);
      const refused = await submit(id);
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.equal(refused.body.error.code, "WHATSAPP_NOT_CONNECTED");
      await db.query("update app.whatsapp_template set submit_state='wanted' where id=$1", [id]);
      const before = f.provider.created.length;
      await f.worker.tick();
      assert.equal(f.provider.created.length, before);
      await db.query("update app.whatsapp_template set submit_state=null where id=$1", [id]);
      await db.query("update app.whatsapp_channel set credentials=$2,credentials_set_at=$3 where org_id=$1", [f.h.orgA.id, kept.credentials, kept.credentials_set_at]);
    });

    await t.test("neither staff nor another workspace can submit this workspace's template", async () => {
      const id = await add("submit_not_yours");
      const body = { expectedRevision: (await row(id)).revision };
      const path = `/api/v1/channels/whatsapp/templates/${id}/submit`;
      const asStaff = await f.api.request(f.h.staff, f.h.orgA.id, "POST", path, body);
      assert.equal(asStaff.status, 403, JSON.stringify(asStaff.body));
      const asOther = await f.api.request(f.h.bob, f.h.orgB.id, "POST", path, body);
      assert.ok([404, 409].includes(asOther.status), JSON.stringify(asOther.body));
      assert.equal((await row(id)).submit_state, null);
      const before = f.provider.created.length;
      await f.worker.tick();
      assert.equal(f.provider.created.length, before);
    });

    await t.test("only the agent process may claim, and nothing is sent for a number that is not connected", async () => {
      const web = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
      await web.connect();
      try {
        await assert.rejects(
          web.query("select app_private.whatsapp_template_submit('claim',$1)", [f.h.namespace]),
          /permission denied/,
        );
      } finally {
        await web.end();
      }
      const id = await add("submit_offline");
      assert.equal((await submit(id)).status, 200);
      const d = await f.req("POST", "/channels/whatsapp/disconnect", {
        expectedRevision: await channelRevision(),
      });
      assert.equal(d.status, 200, JSON.stringify(d.body));
      const before = f.provider.created.length;
      await f.worker.tick();
      assert.equal(f.provider.created.length, before);
      assert.equal((await row(id)).submit_state, "wanted");
      const other = await add("submit_offline_two");
      const refused = await submit(other);
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.equal(refused.body.error.code, "WHATSAPP_NOT_CONNECTED");
    });
  } finally {
    await f.close();
  }
});
