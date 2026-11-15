// WhatsApp conversation metering and admission (billing design §13),
// against the local database, the webhook route and the fake provider.
import test from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { adjustWallet, balanceSen, entitle, setBalance, usageEvents } from "../helpers/billing.ts";
import { webhookPost } from "../../web/lib/server/whatsapp-webhook.ts";
import { buildInboundText, signBody } from "../../packages/whatsapp/src/index.ts";
import { createFakeProvider } from "../../packages/whatsapp/src/fake.ts";
import { WhatsAppWorker } from "../../engine/src/whatsapp/worker.ts";
import { recordUsage } from "../../packages/billing/src/usage.ts";
import pg from "pg";

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
  // The webhook alone; the worker has not run yet.
  const post = async (from: string, text: string) => {
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
  };
  const say = async (from: string, text: string) => {
    await post(from, text);
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
    provider,
    post,
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

test("a staff request and an opt-out send only notices and are not billed; an owed conversation is billed by maintenance once, priced when it became billable", async () => {
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
    const billableAt = "2026-11-14T03:00:00.000Z";
    await f.h.cleanup.query("update app.conversation set usage_state='pending',usage_at=$2 where id=$1", [c.id, billableAt]);
    await f.worker.tick();
    await f.worker.tick();
    const events = await f.billed();
    assert.equal(events.length, 1);
    assert.equal(events[0].idempotency_key, "wa:" + c.id);
    assert.equal(new Date(events[0].occurred_at).toISOString(), billableAt, "priced at the first accepted message, not the retry");
    assert.equal((await f.conversations(staffOnly))[0].usage_state, "billed");
  } finally {
    await f.close();
  }
});

for (const [name, entitlement] of [
  ["no plan (pay as you go)", null],
  ["a Starter plan, which has no WhatsApp agent", { plan: "starter" as const }],
] as const)
  test(`${name}: the conversation is flagged for staff and nothing is sent`, async () => {
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

test("an exhausted wallet: new conversations are flagged and not answered; a billed one keeps its agent; grace is served", async () => {
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
    // A new conversation is flagged for staff; the agent sends nothing.
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

type F = Awaited<ReturnType<typeof setup>>;
// The worker's steps one by one, so a test can act between the agent's
// answer and its send.
async function answerWithoutSending(f: F, from: string, text: string) {
  await f.post(from, text);
  await f.worker.op("ingest");
  const [c] = await f.conversations(from);
  return c;
}
const message = async (f: F, conversationId: string) =>
  (
    await f.h.cleanup.query(
      "select id,status,kind,lease_token from app.message where conversation_id=$1 and author='agent' order by created_at desc,id desc limit 1",
      [conversationId],
    )
  ).rows[0];

test("a failed bill never undoes the send: the message stays sent and the conversation stays owed", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const from = customerNumber();
    const c = await answerWithoutSending(f, from, "Ada slot esok?");
    // The key is already taken with another quantity, so the bill fails.
    const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 1 });
    try {
      await recordUsage(worker, { orgId: f.h.orgA.id, kind: "whatsapp_conversation", quantity: 2, idempotencyKey: "wa:" + c.id });
    } finally {
      await worker.end();
    }
    assert.equal(await f.worker.runOneTurn(), true);
    assert.equal(await f.worker.sendOne(), true);
    assert.equal((await message(f, c.id)).status, "sent");
    let [row] = await f.conversations(from);
    assert.deepEqual([row.usage_state, row.usage_attempts], ["pending", 1]);
    assert.ok(row.usage_at, "the moment it became billable is kept");
    await f.worker.op("maintain");
    [row] = await f.conversations(from);
    assert.deepEqual([row.usage_state, row.usage_attempts], ["pending", 2]);
    assert.equal((await f.billed()).filter((e) => e.quantity === 1).length, 0);
  } finally {
    await f.close();
  }
});

test("an agent answer sent as the reply-request template is billed", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const from = customerNumber();
    const c = await answerWithoutSending(f, from, "Boleh tempah?");
    const created = await f.req("POST", "/channels/whatsapp/templates", {
      name: "jomcall_reply_request",
      language: "ms",
      category: "utility",
      purpose: "reengage",
      body: "Kami ada balasan untuk pertanyaan anda. Sila balas mesej ini untuk menyambung perbualan.",
      variables: 0,
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    await f.req("PATCH", `/channels/whatsapp/templates/${created.body.data.id}`, {
      status: "approved",
      expectedRevision: created.body.data.revision,
    });
    await f.req("POST", `/contacts/${c.contact_id}/consents`, {
      channel: "whatsapp",
      purpose: "service",
      granted: true,
      source: "in_person",
      evidence: "Borang di kaunter (contoh)",
      expectedRevision: (await f.req("GET", `/contacts/${c.contact_id}`)).body.data.revision,
    });
    assert.equal(await f.worker.runOneTurn(), true);
    // The answer goes out after the 24-hour window has closed.
    await f.h.cleanup.query("update app.conversation set last_inbound_at=now()-interval '25 hours' where id=$1", [c.id]);
    assert.equal(await f.worker.sendOne(), true);
    const m = await message(f, c.id);
    assert.deepEqual([m.status, m.kind], ["sent", "template"]);
    assert.equal(f.provider.sent.at(-1)?.kind, "template");
    const events = await f.billed();
    assert.equal(events.length, 1);
    assert.equal(events[0].idempotency_key, "wa:" + c.id);
  } finally {
    await f.close();
  }
});

test("a send whose result was lost is billed when the late result says it was sent", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const from = customerNumber();
    const c = await answerWithoutSending(f, from, "Hai");
    assert.equal(await f.worker.runOneTurn(), true);
    f.provider.failNext({ outcome: "unknown" });
    assert.equal(await f.worker.sendOne(), true);
    const m = await message(f, c.id);
    assert.equal(m.status, "unknown");
    assert.equal((await f.billed()).length, 0, "not billed while unknown");
    await f.worker.op("send_result", m.id, m.lease_token, { outcome: "sent", providerMessageId: "wamid.LATE" + randomUUID() });
    assert.equal((await message(f, c.id)).status, "sent");
    const events = await f.billed();
    assert.equal(events.length, 1);
    assert.equal(events[0].idempotency_key, "wa:" + c.id);
  } finally {
    await f.close();
  }
});

test("a billing fault skips only that turn, flagged with its own code; the worker moves on", async () => {
  const f = await setup(null);
  const trigger = "test_fail_period_" + randomUUID().replaceAll("-", "");
  try {
    const org = f.h.orgA.id;
    await f.h.cleanup.query(
      "insert into app.org_plan(org_id,plan_code,anchor_date)values($1,'growth',(now() at time zone 'Asia/Kuala_Lumpur')::date)",
      [org],
    );
    await adjustWallet(f.h.cleanup, org, 100_000);
    // Starting this organization's plan period fails (as a database fault would).
    await f.h.cleanup.query(
      `create function public.${trigger}()returns trigger language plpgsql as $$begin
        if new.org_id='${org}'::uuid then raise exception 'INJECTED_FAULT';end if;return new;end$$`,
    );
    await f.h.cleanup.query(`create trigger ${trigger} before insert on app.plan_period for each row execute function public.${trigger}()`);
    const first = customerNumber();
    await f.say(first, "Hai"); // tick() does not throw
    const [a] = await f.conversations(first);
    assert.deepEqual(await f.outbound(a.id), []);
    assert.deepEqual([a.needs_attention, a.attention_reason], [true, "BILLING_CHECK_FAILED"]);
    const turn = (await f.h.cleanup.query("select state,error_code from app.conversation_turn where conversation_id=$1", [a.id])).rows;
    assert.deepEqual(turn, [{ state: "skipped", error_code: "BILLING_CHECK_FAILED" }]);
    // The queue is not stuck behind it: once the fault clears, the next
    // conversation is answered.
    await f.h.cleanup.query(`drop trigger ${trigger} on app.plan_period`);
    const second = customerNumber();
    await f.say(second, "Hai");
    const [b] = await f.conversations(second);
    assert.deepEqual((await f.outbound(b.id)).map((m) => [m.author, m.status]), [["agent", "sent"]]);
  } finally {
    await f.h.cleanup.query(`drop trigger if exists ${trigger} on app.plan_period`);
    await f.h.cleanup.query(`drop function if exists public.${trigger}()`);
    await f.close();
  }
});
