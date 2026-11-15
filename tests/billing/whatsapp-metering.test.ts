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
  // WhatsApp billing windows for one customer (contact and channel), oldest first.
  const windows = async (from: string) =>
    (
      await h.cleanup.query(
        `select w.* from app.whatsapp_usage_window w join app.conversation c on(c.org_id=w.org_id and c.id=w.conversation_id)
         where w.org_id=$1 and c.wa_id=$2 order by w.starts_at,w.id`,
        [h.orgA.id, from],
      )
    ).rows;
  return {
    ...f,
    worker,
    provider,
    post,
    say,
    conversations,
    outbound,
    billed,
    windows,
    async close() {
      await worker.close();
      await h.cleanup.query("delete from app.whatsapp_event where namespace=$1", [h.namespace]);
      await f.close();
    },
  };
}

test("a customer is billed once per 24-hour window, which opens at the agent's first accepted answer", async () => {
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
    const [w] = await f.windows(from);
    const first = (
      await f.h.cleanup.query(
        "select status_at from app.message where conversation_id=$1 and author='agent' order by created_at,id limit 1",
        [c.id],
      )
    ).rows[0];
    assert.ok(Math.abs(w.starts_at - first.status_at) < 1000, "the window starts at the first accepted agent message");
    assert.equal(
      events[0].idempotency_key,
      `wa:${c.channel_id}:${c.contact_id}:${Math.floor(w.starts_at.getTime() / 1000)}`,
      "the key names the customer and the window, not the conversation",
    );
    assert.equal(events[0].quantity, 1);
    assert.equal(events[0].amount_sen, 15);
    assert.deepEqual([w.usage_state, w.usage_event_id, w.conversation_id], ["billed", events[0].id, c.id]);
    assert.equal(await balanceSen(f.h.cleanup, f.h.orgA.id), before - 15);
    // A day later (a new conversation, and the window has ended): a new bill.
    await f.h.cleanup.query("update app.conversation set last_inbound_at=now()-interval '25 hours' where id=$1", [c.id]);
    await f.h.cleanup.query("update app.whatsapp_usage_window set starts_at=starts_at-interval '25 hours' where id=$1", [w.id]);
    // The first bill's key holds the window's original start second; moving
    // the window back does not change it, so wait a second to get a new key.
    await new Promise((r) => setTimeout(r, 1100));
    await f.say(from, "Saya nak tanya lagi.");
    const all = await f.conversations(from);
    assert.equal(all.length, 2);
    events = await f.billed();
    assert.equal(events.length, 2);
    assert.equal((await f.windows(from))[1].conversation_id, all[1].id);
  } finally {
    await f.close();
  }
});

test("a staff request and an opt-out send only notices and are not billed; an owed window is billed by maintenance once, priced at its start", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const staffOnly = customerNumber();
    await f.say(staffOnly, "staff");
    const [c] = await f.conversations(staffOnly);
    assert.deepEqual((await f.outbound(c.id)).map((m) => [m.author, m.status]), [["system", "sent"]]);
    const optOut = customerNumber();
    await f.say(optOut, "stop");
    assert.equal((await f.billed()).length, 0);
    assert.deepEqual(await f.windows(staffOnly), []);
    // A window whose bill did not land stays owed; maintenance bills it,
    // priced at the window's start, and the next pass adds nothing.
    const billableAt = "2026-11-14T03:00:00.000Z";
    await f.h.cleanup.query(
      "insert into app.whatsapp_usage_window(org_id,channel_id,contact_id,conversation_id,starts_at)values($1,$2,$3,$4,$5)",
      [c.org_id, c.channel_id, c.contact_id, c.id, billableAt],
    );
    await f.worker.tick();
    await f.worker.tick();
    const events = await f.billed();
    assert.equal(events.length, 1);
    assert.equal(events[0].idempotency_key, `wa:${c.channel_id}:${c.contact_id}:${Date.parse(billableAt) / 1000}`);
    assert.equal(new Date(events[0].occurred_at).toISOString(), billableAt, "priced at the window's start, not the retry");
    assert.equal((await f.windows(staffOnly))[0].usage_state, "billed");
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
    assert.equal((await f.windows(fresh))[0].usage_state, "billed");
    assert.equal((await f.billed()).length, 2);
  } finally {
    await f.close();
  }
});

type F = Awaited<ReturnType<typeof setup>>;
// A test-only trigger that makes inserts into `table` fail for orgA only.
async function failFor(f: F, table: string, name: string) {
  await f.h.cleanup.query(
    `create function public.${name}()returns trigger language plpgsql as $$begin
      if new.org_id='${f.h.orgA.id}'::uuid then raise exception 'INJECTED_FAULT';end if;return new;end$$`,
  );
  await f.h.cleanup.query(`create trigger ${name} before insert on ${table} for each row execute function public.${name}()`);
}
async function dropFail(f: F, table: string, name: string) {
  await f.h.cleanup.query(`drop trigger if exists ${name} on ${table}`);
  await f.h.cleanup.query(`drop function if exists public.${name}()`);
}
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

test("a failed bill never undoes the send: the message stays sent and the window stays owed", async () => {
  const f = await setup({ plan: "growth" });
  const trigger = "test_fail_usage_" + randomUUID().replaceAll("-", "");
  try {
    const from = customerNumber();
    const c = await answerWithoutSending(f, from, "Ada slot esok?");
    // Recording usage fails for this organization (as a database fault would).
    await failFor(f, "app.usage_event", trigger);
    assert.equal(await f.worker.runOneTurn(), true);
    assert.equal(await f.worker.sendOne(), true);
    assert.equal((await message(f, c.id)).status, "sent");
    let [w] = await f.windows(from);
    assert.deepEqual([w.usage_state, w.usage_attempts, w.conversation_id], ["pending", 1, c.id]);
    await f.worker.op("maintain");
    [w] = await f.windows(from);
    assert.deepEqual([w.usage_state, w.usage_attempts], ["pending", 2]);
    assert.equal((await f.billed()).length, 0);
    // Once the fault clears, maintenance bills it at the window's start.
    await f.h.cleanup.query(`drop trigger ${trigger} on app.usage_event`);
    await f.worker.op("maintain");
    const [event] = await f.billed();
    assert.equal(new Date(event.occurred_at).getTime(), w.starts_at.getTime());
  } finally {
    await dropFail(f, "app.usage_event", trigger);
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
    assert.equal(events[0].idempotency_key.startsWith(`wa:${c.channel_id}:${c.contact_id}:`), true);
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
    assert.equal(events[0].idempotency_key.startsWith(`wa:${c.channel_id}:${c.contact_id}:`), true);
  } finally {
    await f.close();
  }
});

test("a billing fault: the agent answers anyway and the turn is marked BILLING_CHECK_FAILED (owner decision A)", async () => {
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
    await failFor(f, "app.plan_period", trigger);
    const from = customerNumber();
    await f.say(from, "Hai"); // tick() does not throw
    const [a] = await f.conversations(from);
    assert.deepEqual((await f.outbound(a.id)).map((m) => [m.author, m.status]), [["agent", "sent"]]);
    assert.equal(a.needs_attention, false);
    const turn = (
      await f.h.cleanup.query("select state,billing_check from app.conversation_turn where conversation_id=$1", [a.id])
    ).rows;
    assert.deepEqual(turn, [{ state: "completed", billing_check: "BILLING_CHECK_FAILED" }]);
    // Still metered: the window is billed.
    assert.equal((await f.windows(from))[0].usage_state, "billed");
    assert.equal(
      (await f.h.cleanup.query("select count(*)::int n from app.billing_notice where org_id=$1", [org])).rows[0].n,
      0,
      "no owner email for a failed check",
    );
  } finally {
    await dropFail(f, "app.plan_period", trigger);
    await f.close();
  }
});


test("resolving and reopening a chat inside the 24-hour window bills once; a message after the window bills again (owner decision D)", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const from = customerNumber();
    await f.say(from, "Hai, ada slot?");
    const [first] = await f.conversations(from);
    const resolve = async (id: string) => {
      const d = (await f.req("GET", `/conversations/${id}`)).body.data;
      const r = await f.req("POST", `/conversations/${id}/resolve`, { expectedRevision: d.revision });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    };
    // Resolved and reopened twice within the window: still one bill.
    await resolve(first.id);
    await f.say(from, "Satu lagi soalan");
    let all = await f.conversations(from);
    assert.equal(all.length, 2, "a new conversation after the resolve");
    assert.deepEqual((await f.outbound(all[1].id)).map((m) => [m.author, m.status]), [["agent", "sent"]]);
    await resolve(all[1].id);
    await f.say(from, "Terima kasih");
    all = await f.conversations(from);
    assert.equal(all.length, 3);
    assert.equal((await f.billed()).length, 1);
    assert.equal((await f.windows(from)).length, 1);
    // The window ends 24 hours after it started: the next answer bills again,
    // even in the same open conversation.
    await f.h.cleanup.query(
      "update app.whatsapp_usage_window set starts_at=starts_at-interval '24 hours 1 second' where org_id=$1",
      [f.h.orgA.id],
    );
    // The first bill's key holds the window's original start second; moving
    // the window back does not change it, so wait a second to get a new key.
    await new Promise((r) => setTimeout(r, 1100));
    await f.say(from, "Esok pula?");
    assert.equal((await f.conversations(from)).length, 3, "same conversation");
    assert.equal((await f.billed()).length, 2);
    assert.equal((await f.windows(from)).length, 2);
  } finally {
    await f.close();
  }
});

test("a customer whose window is open is answered even when the wallet is exhausted", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const from = customerNumber();
    await f.say(from, "Hai");
    const [first] = await f.conversations(from);
    const d = (await f.req("GET", `/conversations/${first.id}`)).body.data;
    assert.equal((await f.req("POST", `/conversations/${first.id}/resolve`, { expectedRevision: d.revision })).status, 200);
    await setBalance(f.h.cleanup, f.h.orgA.id, -600);
    await f.say(from, "Saya lupa tanya");
    const all = await f.conversations(from);
    assert.deepEqual((await f.outbound(all[1].id)).map((m) => m.author), ["agent"], "already paid for this window");
    assert.equal((await f.billed()).length, 1);
  } finally {
    await f.close();
  }
});

test("after the window ends, a long-running conversation needs a wallet that allows service again", async () => {
  const f = await setup({ plan: "growth" });
  try {
    const from = customerNumber();
    await f.say(from, "Hai");
    const [c] = await f.conversations(from);
    await f.h.cleanup.query(
      "update app.whatsapp_usage_window set starts_at=starts_at-interval '25 hours' where org_id=$1",
      [f.h.orgA.id],
    );
    await setBalance(f.h.cleanup, f.h.orgA.id, -600);
    await f.say(from, "Satu lagi");
    const [same] = await f.conversations(from);
    assert.equal(same.id, c.id, "the same conversation");
    assert.deepEqual([same.needs_attention, same.attention_reason], [true, "WALLET_EXHAUSTED"]);
    assert.equal((await f.outbound(c.id)).length, 1, "only the first answer was sent");
    assert.equal((await f.billed()).length, 1);
  } finally {
    await f.close();
  }
});
