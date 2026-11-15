// WhatsApp conversation metering and admission (billing design §13),
// against the local database, the webhook route and the fake provider.
import test from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { balanceSen, entitle, setBalance, usageEvents } from "../helpers/billing.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";
import { buildInboundText, signBody } from "../../packages/whatsapp/src/index.ts";
import { createFakeProvider } from "../../packages/whatsapp/src/fake.ts";
import { WhatsAppWorker } from "../../engine/src/whatsapp/worker.ts";

const secret = "test-app-secret-" + randomUUID();
const customerNumber = () => "6011" + String(randomInt(1_000_000, 9_999_999));

async function setup(entitlement: { plan?: "starter" | "growth"; creditSen?: number } | null) {
  Object.assign(process.env, {
    JOMCALL_WHATSAPP_PROVIDER: "fake",
    WHATSAPP_APP_SECRET: secret,
    WHATSAPP_VERIFY_TOKEN: "verify-token-" + randomUUID(),
  });
  const f = await createPhase2Harness();
  const { h } = f;
  if (entitlement) await entitle(h.cleanup, h.orgA.id, entitlement);
  const version = (
    await h.cleanup.query(
      "insert into app.agent_version(org_id,agent_id,sequence,snapshot,actor_id)values($1,$2,1,$3,$4)returning id",
      [
        h.orgA.id,
        h.orgA.agentId,
        JSON.stringify({
          settings: { name: "Agent", aiDisclosure: "" },
          knowledge: [{ kind: "faq", name: "Hours", content: "Kami buka 9 pagi hingga 6 petang." }],
        }),
        h.alice.userId,
      ],
    )
  ).rows[0].id;
  await h.cleanup.query("update app.agent set published_version_id=$1 where id=$2", [version, h.orgA.agentId]);
  const phone = String(randomInt(100_000_000, 999_999_999));
  const saved = await f.req("PUT", "/channels/whatsapp", { phoneNumberId: phone, wabaId: "200000001", agentEnabled: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const provider = createFakeProvider();
  const worker = new WhatsAppWorker(h.namespace, {
    provider,
    model: { generate: async () => ({ kind: "answer", text: "Baik.", citations: [] }) } as any,
  });
  await worker.tick(); // pending -> connected
  const say = async (from: string, text: string) => {
    const raw = JSON.stringify(
      buildInboundText({ phoneNumberId: phone, from, name: "Aina Contoh", id: "wamid.IN" + randomUUID(), text }),
    );
    const res = await webhookPost(
      new Request("http://127.0.0.1:4182/api/whatsapp/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": signBody(raw, secret) },
        body: raw,
      }),
    );
    assert.equal(res.status, 200);
    await worker.tick();
  };
  const conversations = async (from: string) =>
    (
      await h.cleanup.query(
        "select * from app.conversation where org_id=$1 and wa_id=$2 order by created_at,id",
        [h.orgA.id, from],
      )
    ).rows;
  const outbound = async (conversationId: string) =>
    (
      await h.cleanup.query(
        "select author,status,body from app.message where conversation_id=$1 and direction='outbound' order by created_at,id",
        [conversationId],
      )
    ).rows;
  const billed = () => usageEvents(h.cleanup, h.orgA.id, "whatsapp_conversation");
  return {
    ...f,
    worker,
    say,
    conversations,
    outbound,
    billed,
    async close() {
      await worker.close();
      await h.cleanup.query("delete from app.whatsapp_event where namespace=$1", [h.namespace]);
      await f.close();
    },
  };
}

test("a conversation is billed once per window, when the agent's first answer is sent", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const from = customerNumber();
    const before = await balanceSen(f.h.cleanup, f.h.orgA.id);
    await f.say(from, "Pukul berapa buka?");
    await f.say(from, "Hari Ahad pun buka?");
    let [c] = await f.conversations(from);
    assert.deepEqual((await f.outbound(c.id)).map((m) => [m.author, m.status]), [["agent", "sent"], ["agent", "sent"]]);
    let events = await f.billed();
    assert.equal(events.length, 1);
    assert.equal(events[0].idempotency_key, "wa:" + c.id);
    assert.equal(events[0].quantity, 1);
    assert.equal(events[0].amount_sen, 15);
    assert.equal(c.usage_state, "billed");
    assert.equal(c.usage_event_id, events[0].id);
    assert.equal(await balanceSen(f.h.cleanup, f.h.orgA.id), before - 15);
    // A day of silence starts a new conversation: a new window, a new bill.
    await f.h.cleanup.query(
      "update app.conversation set last_inbound_at=now()-interval '25 hours' where id=$1",
      [c.id],
    );
    await f.say(from, "Saya nak tanya lagi.");
    const all = await f.conversations(from);
    assert.equal(all.length, 2);
    events = await f.billed();
    assert.equal(events.length, 2);
    assert.equal(events[1].idempotency_key, "wa:" + all[1].id);
  } finally {
    await f.close();
  }
});

test("staff-only and notice-only conversations are not billed; an owed one is billed by maintenance once", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const staffOnly = customerNumber();
    await f.say(staffOnly, "staff");
    const [c] = await f.conversations(staffOnly);
    assert.deepEqual((await f.outbound(c.id)).map((m) => [m.author, m.status]), [["system", "sent"]]);
    const optOut = customerNumber();
    await f.say(optOut, "stop");
    assert.equal((await f.billed()).length, 0);
    assert.equal(c.usage_state, null);
    // An answered conversation whose bill did not land stays owed;
    // maintenance bills it, and the next pass adds nothing.
    await f.h.cleanup.query("update app.conversation set usage_state='pending' where id=$1", [c.id]);
    await f.worker.tick();
    await f.worker.tick();
    const events = await f.billed();
    assert.equal(events.length, 1);
    assert.equal(events[0].idempotency_key, "wa:" + c.id);
    assert.equal((await f.conversations(staffOnly))[0].usage_state, "billed");
  } finally {
    await f.close();
  }
});

for (const [name, entitlement] of [
  ["no plan (pay as you go)", null],
  ["a Starter plan, which has no WhatsApp agent", { plan: "starter" as const }],
] as const)
  test(`${name}: the message goes to the inbox and nothing is sent`, async () => {
    const f = await setup(entitlement);
    try {
      const from = customerNumber();
      await f.say(from, "Ada slot esok?");
      const [c] = await f.conversations(from);
      assert.deepEqual(await f.outbound(c.id), []);
      assert.equal(c.needs_attention, true);
      assert.equal(c.attention_reason, "NO_WHATSAPP_ENTITLEMENT");
      assert.equal(c.owner, "agent", "not handed to staff for good");
      const turn = (
        await f.h.cleanup.query("select state,error_code from app.conversation_turn where conversation_id=$1", [c.id])
      ).rows;
      assert.deepEqual(turn, [{ state: "skipped", error_code: "NO_WHATSAPP_ENTITLEMENT" }]);
      assert.equal((await f.billed()).length, 0);
    } finally {
      await f.close();
    }
  });

test("an exhausted wallet: new conversations go to the inbox; a billed one keeps its agent; grace is served", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const org = f.h.orgA.id;
    const ongoing = customerNumber();
    await f.say(ongoing, "Hai");
    await setBalance(f.h.cleanup, org, -600);
    // Already answered (and billed) in this window: the agent carries on.
    await f.say(ongoing, "Satu soalan lagi");
    const [a] = await f.conversations(ongoing);
    assert.deepEqual((await f.outbound(a.id)).map((m) => m.status), ["sent", "sent"]);
    // A new conversation is not answered by the agent.
    const fresh = customerNumber();
    await f.say(fresh, "Hai");
    let [b] = await f.conversations(fresh);
    assert.deepEqual(await f.outbound(b.id), []);
    assert.deepEqual([b.needs_attention, b.attention_reason], [true, "WALLET_EXHAUSTED"]);
    assert.equal((await f.billed()).length, 1);
    // Grace is still served.
    await setBalance(f.h.cleanup, org, -100);
    await f.say(fresh, "Masih ada?");
    [b] = await f.conversations(fresh);
    assert.deepEqual((await f.outbound(b.id)).map((m) => [m.author, m.status]), [["agent", "sent"]]);
    assert.equal(b.usage_state, "billed");
    assert.equal((await f.billed()).length, 2);
  } finally {
    await f.close();
  }
});
