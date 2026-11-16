import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createHarness } from "../helpers/local.ts";
import { chargePlanPeriod } from "../../packages/billing/src/plans.ts";
import { Engine } from "../../engine/src/engine.ts";

// Owner emails about the monthly fee (billing design §13):
// app_private.queue_plan_notices queues them, the engine sends them. The
// function reads every organization in the database (plans are per
// database), so these tests use 2027 periods and pass the time explicitly:
// organizations from other tests and the developer's own data have no
// period then.
process.env.NODE_ENV = "test";
type H = Awaited<ReturnType<typeof createHarness>>;
const kl = (day: string, time = "10:00:00") => new Date(`${day}T${time}+08:00`);
async function setup() {
  const h = await createHarness();
  const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 3 });
  const adjust = (org: string, sen: number) =>
    h.cleanup.query("select app_private.admin_adjust($1,$2,'Test credit','Test operator',$3)", [org, sen, "test-" + randomUUID()]);
  // Puts an organization on a plan as an operator would, anchored on 31 January 2027.
  const subscribe = (org: string, code = "starter", anchor = "2027-01-31") =>
    h.cleanup.query(
      `insert into app.org_plan(org_id,plan_code,anchor_date)values($1,$2,$3)
       on conflict(org_id)do update set plan_code=excluded.plan_code,pending_plan_code=null,anchor_date=excluded.anchor_date`,
      [org, code, anchor],
    );
  const queue = async (at: Date) =>
    (await worker.query("select app_private.queue_plan_notices($1,$2) n", [h.namespace, at])).rows[0].n as number;
  // This organization's plan notices, oldest first, with what the engine would send.
  const notices = async (org: string) => {
    const rows = (
      await h.cleanup.query(
        `select b.reason,o.id outbox_id,o.kind,o.namespace from app.billing_notice b
         join app.outbox o on o.resource_id=b.id where b.org_id=$1 and b.channel='plan' order by b.created_at,b.id`,
        [org],
      )
    ).rows;
    const out = [];
    for (const r of rows) {
      assert.deepEqual([r.kind, r.namespace], ["billing.refusal_notice", h.namespace]);
      const p = (await worker.query("select app_private.billing_notice_payload($1,$2) v", [r.outbox_id, h.namespace])).rows[0].v;
      out.push(p);
    }
    return out;
  };
  const close = async () => {
    await worker.end();
    await h.close();
  };
  return { h, worker, adjust, subscribe, queue, notices, close };
}
const brief = (p: Record<string, unknown>) => {
  const { id: _id, operationId: _op, day: _day, ...rest } = p;
  return rest;
};

test("fee due: queued within three days of the next fee when the wallet is short, once per period", async () => {
  const { h, worker, adjust, subscribe, queue, notices, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    await subscribe(a);
    await subscribe(b);
    await adjust(a, 6400);
    await adjust(b, 9800);
    for (const org of [a, b]) assert.equal((await chargePlanPeriod(worker, org, kl("2027-02-01"))).periodState, "charged");
    // A has RM 15.00 left, B holds the next fee. The next fee is due on 28 February.
    await queue(kl("2027-02-24"));
    assert.deepEqual(await notices(a), [], "four days ahead: too early");
    await queue(kl("2027-02-25"));
    await queue(kl("2027-02-26"));
    await queue(kl("2027-02-27", "23:59:00"));
    assert.deepEqual((await notices(a)).map(brief), [
      {
        channel: "plan",
        reason: "PLAN_FEE_DUE",
        emails: [h.alice.confirmedEmail],
        plan: "starter",
        amountSen: 4900,
        balanceSen: 1500,
        dueDate: "2027-02-28",
        payBy: null,
        whatsappAgent: false,
      },
    ]);
    assert.deepEqual(await notices(b), [], "the wallet holds the next fee");
  } finally {
    await close();
  }
});

test("fee due: none for pay as you go or a pending change to it; a pending paid change names the new plan and fee", async () => {
  const { h, worker, adjust, subscribe, queue, notices, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    await subscribe(a);
    await subscribe(b, "payg");
    await adjust(a, 4900);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "charged");
    assert.equal((await chargePlanPeriod(worker, b, kl("2027-02-01"))).periodState, "free");
    await h.cleanup.query("update app.org_plan set pending_plan_code='payg' where org_id=$1", [a]);
    await queue(kl("2027-02-26"));
    assert.deepEqual(await notices(a), [], "moving to pay as you go: no fee is due");
    assert.deepEqual(await notices(b), [], "pay as you go has no fee");
    await h.cleanup.query("update app.org_plan set pending_plan_code='growth' where org_id=$1", [a]);
    await queue(kl("2027-02-26"));
    const [n] = await notices(a);
    assert.deepEqual([n.reason, n.plan, n.amountSen, n.balanceSen, n.dueDate], ["PLAN_FEE_DUE", "growth", 12900, 0, "2027-02-28"]);
  } finally {
    await close();
  }
});

test("fee unpaid: queued once while in grace, with the last day to pay; not when the fee was charged first", async () => {
  const { h, worker, adjust, subscribe, queue, notices, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    await subscribe(a);
    await subscribe(b);
    await adjust(a, 1000);
    for (const org of [a, b]) assert.equal((await chargePlanPeriod(worker, org, kl("2027-02-01"))).periodState, "unpaid");
    // B is topped up and charged before the notices are queued, as the
    // engine's hourly run charges first and queues after.
    await adjust(b, 4900);
    assert.equal((await chargePlanPeriod(worker, b, kl("2027-02-01"))).periodState, "charged");
    assert.ok((await queue(kl("2027-02-01"))) >= 1);
    await queue(kl("2027-02-03"));
    assert.deepEqual((await notices(a)).map(brief), [
      {
        channel: "plan",
        reason: "PLAN_FEE_UNPAID",
        emails: [h.alice.confirmedEmail],
        plan: "starter",
        amountSen: 4900,
        balanceSen: 1000,
        dueDate: "2027-01-31",
        // Grace ends at 00:00 on 7 February: the 6th is the last full day.
        payBy: "2027-02-06",
        whatsappAgent: false,
      },
    ]);
    assert.deepEqual(await notices(b), []);
  } finally {
    await close();
  }
});

test("plan stopped: queued once when grace ends unpaid", async () => {
  const { h, worker, subscribe, queue, notices, close } = await setup();
  try {
    const a = h.orgA.id;
    await subscribe(a);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "unpaid");
    await queue(kl("2027-02-01"));
    assert.deepEqual((await notices(a)).map((n) => [n.reason, n.plan, n.amountSen, n.dueDate]), [["PLAN_FEE_UNPAID", "starter", 4900, "2027-01-31"]]);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-07"))).periodState, "downgraded");
    await queue(kl("2027-02-07"));
    await queue(kl("2027-02-20"));
    // Reading the payload skips a notice that is no longer true: the unpaid
    // notice is stale now that the plan has stopped.
    const sent = await notices(a);
    assert.deepEqual(
      sent.map((n) => n && [n.reason, n.plan, n.amountSen, n.dueDate]),
      [null, ["PLAN_STOPPED", "starter", 4900, "2027-01-31"]],
    );
    // The next period is pay as you go: nothing more.
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-03-01"))).periodState, "free");
    await queue(kl("2027-03-01"));
    assert.equal((await notices(a)).length, 2);
  } finally {
    await close();
  }
});

test("queue_plan_notices: the worker role only", async () => {
  const { h, worker, close } = await setup();
  const web = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
  const agent = new pg.Pool({ connectionString: process.env.AGENT_DATABASE_URL, max: 1 });
  try {
    const at = kl("2027-06-01");
    assert.equal(typeof (await worker.query("select app_private.queue_plan_notices($1,$2) n", [h.namespace, at])).rows[0].n, "number");
    for (const pool of [web, agent])
      await assert.rejects(pool.query("select app_private.queue_plan_notices($1,$2)", [h.namespace, at]), /permission denied/);
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) => tx.query("select app_private.queue_plan_notices($1,$2)", [h.namespace, at])),
      /permission denied/,
    );
    await assert.rejects(worker.query("select app_private.queue_plan_notices('elsewhere',$1)", [at]), /INVALID_NAMESPACE/);
  } finally {
    await web.end();
    await agent.end();
    await close();
  }
});

type Mail = { ID: string; To: { Address: string }[]; Subject: string };
const mailTo = async (address: string) => {
  const list = await (await fetch("http://127.0.0.1:54624/api/v1/messages?limit=500")).json();
  return (list.messages as Mail[]).filter((m) => m.To.some((t) => t.Address === address));
};
const mailText = async (m: Mail) => (await (await fetch("http://127.0.0.1:54624/api/v1/message/" + m.ID)).json()).Text as string;

test("the engine emails each plan notice to the owners only, in English and Bahasa Melayu; once per period", async () => {
  const { h, worker, adjust, subscribe, queue, close } = await setup();
  let engine: Engine | undefined;
  try {
    const a = h.orgA.id;
    // Bob owns the other organization and is an admin here; staff is staff.
    await h.cleanup.query("insert into app.member(org_id,user_id,role) values($1,$2,'admin')", [a, h.bob.userId]);
    // The run's own queueing is stubbed: it would read today's periods of
    // every organization in the shared database.
    const e = await Engine.create(h.namespace, { plans: { firstAfterMs: 0, due: async () => [], notify: async () => {} } });
    engine = e;
    const states = async () =>
      (await h.cleanup.query("select reason,delivery_state from app.billing_notice where org_id=$1 order by created_at", [a])).rows;
    // Each email goes out before the next change, as the hourly run would send it.
    const send = async () => {
      for (let i = 0; i < 6 && (await states()).some((s) => s.delivery_state !== "sent"); i++) await e.tick();
    };
    await subscribe(a);
    await adjust(a, 6400);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "charged");
    // RM 15.00 left; the next fee (28 February) is three days away.
    await queue(kl("2027-02-25"));
    await send();
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-28"))).periodState, "unpaid");
    await queue(kl("2027-02-28"));
    await send();
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-03-07"))).periodState, "downgraded");
    await queue(kl("2027-03-07"));
    await send();
    assert.deepEqual(await states(), [
      { reason: "PLAN_FEE_DUE", delivery_state: "sent" },
      { reason: "PLAN_FEE_UNPAID", delivery_state: "sent" },
      { reason: "PLAN_STOPPED", delivery_state: "sent" },
    ]);
    const mine = await mailTo(h.alice.confirmedEmail);
    const bySubject = new Map(mine.map((m) => [m.Subject, m]));
    assert.equal(mine.length, 3);
    const due = bySubject.get("Your JomCall plan fee is due on 28 Feb 2027 / Yuran pelan JomCall anda perlu dibayar pada 28 Feb 2027");
    const unpaid = bySubject.get("Your JomCall plan fee is unpaid / Yuran pelan JomCall anda belum dibayar");
    const stopped = bySubject.get("Your JomCall plan has stopped / Pelan JomCall anda telah dihentikan");
    assert.ok(due && unpaid && stopped, JSON.stringify(mine.map((m) => m.Subject)));
    const dueText = await mailText(due);
    assert.match(dueText, /Your Starter plan fee of RM 49\.00 is due on 28 Feb 2027\. Your wallet has RM 15\.00\. Top up at least RM 34\.00 before then/);
    assert.match(dueText, /Yuran pelan Starter anda sebanyak RM 49\.00 perlu dibayar pada 28 Feb 2027\. Baki dompet anda RM 15\.00\. Tambah nilai sekurang-kurangnya RM 34\.00/);
    const unpaidText = await mailText(unpaid);
    assert.match(unpaidText, /was due on 28 Feb 2027 and your wallet did not hold it\. Top up at least RM 34\.00 by 6 Mar 2027/);
    assert.match(unpaidText, /sekurang-kurangnya RM 34\.00 selewat-lewatnya 6 Mac 2027/);
    const stoppedText = await mailText(stopped);
    assert.match(stoppedText, /Your Starter plan stopped because the fee of RM 49\.00 was not paid\. The agent no longer answers phone calls\./);
    assert.match(stoppedText, /Pelan Starter anda telah dihentikan kerana yuran sebanyak RM 49\.00 tidak dibayar\. Ejen tidak lagi menjawab panggilan telefon\./);
    for (const text of [dueText, unpaidText, stoppedText]) {
      assert.match(text, /\/app\/billing/);
      assert.doesNotMatch(text, /Studio Contoh|Cawangan Contoh/, "no organization or branch name");
    }
    for (const who of [h.bob, h.staff]) assert.deepEqual(await mailTo(who.confirmedEmail), [], "owners only");
    // A later run for the same periods queues and sends nothing more.
    for (const at of ["2027-02-26", "2027-03-01", "2027-03-08"]) assert.equal(await queue(kl(at)), 0, at);
    await engine.tick();
    await engine.tick();
    assert.equal((await mailTo(h.alice.confirmedEmail)).length, 3);
  } finally {
    await engine?.close();
    await close();
  }
});

// A notice that is no longer true when its turn comes is not sent: the row
// becomes 'skipped', the job finishes without mail and without an error.
async function skipSetup() {
  const s = await setup();
  const { h, adjust, subscribe } = s;
  const a = h.orgA.id;
  const engine = await Engine.create(h.namespace, { plans: { firstAfterMs: 0, due: async () => [], notify: async () => {} } });
  const states = async () =>
    (await h.cleanup.query("select reason,delivery_state from app.billing_notice where org_id=$1 and channel='plan' order by created_at,reason", [a])).rows;
  // Runs the engine until this organization has no pending notice; a skipped
  // or sent row is final, so a few more ticks change nothing.
  const settle = async () => {
    for (let i = 0; i < 6 && (await states()).some((r) => r.delivery_state === "pending"); i++) await engine.tick();
    await engine.tick();
  };
  const close = async () => {
    await engine.close();
    await s.close();
  };
  return { ...s, a, engine, states, settle, close, subscribe, adjust, h };
}

test("a fee due notice is skipped when the wallet now covers the fee", async () => {
  const { h, worker, a, adjust, subscribe, queue, states, settle, close } = await skipSetup();
  try {
    await subscribe(a);
    await adjust(a, 6400);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "charged");
    await queue(kl("2027-02-25"));
    assert.deepEqual(await states(), [{ reason: "PLAN_FEE_DUE", delivery_state: "pending" }]);
    await adjust(a, 3400); // RM 15.00 + RM 34.00 = the fee
    await settle();
    assert.deepEqual(await states(), [{ reason: "PLAN_FEE_DUE", delivery_state: "skipped" }]);
    assert.deepEqual(await mailTo(h.alice.confirmedEmail), []);
  } finally {
    await close();
  }
});

test("a fee due notice still goes out when a top-up leaves the wallet short", async () => {
  const { h, worker, a, adjust, subscribe, queue, states, settle, close } = await skipSetup();
  try {
    await subscribe(a);
    await adjust(a, 6400);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "charged");
    await queue(kl("2027-02-25"));
    await adjust(a, 1000); // RM 25.00, still below RM 49.00
    await settle();
    assert.deepEqual(await states(), [{ reason: "PLAN_FEE_DUE", delivery_state: "sent" }]);
    assert.equal((await mailTo(h.alice.confirmedEmail)).length, 1);
  } finally {
    await close();
  }
});

test("a fee unpaid notice is skipped when the fee was charged meanwhile, and goes out while unpaid", async () => {
  const { h, worker, a, adjust, subscribe, queue, states, settle, close } = await skipSetup();
  try {
    await subscribe(a);
    await adjust(a, 1000);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "unpaid");
    await queue(kl("2027-02-01"));
    await adjust(a, 4900);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-02"))).periodState, "charged");
    await settle();
    assert.deepEqual(await states(), [{ reason: "PLAN_FEE_UNPAID", delivery_state: "skipped" }]);
    assert.deepEqual(await mailTo(h.alice.confirmedEmail), []);
    // Still unpaid when sent: the email goes out (the engine test above
    // covers the full set; this is the unpaid one alone).
    const b = h.orgB.id;
    await subscribe(b);
    await adjust(b, 1000);
    assert.equal((await chargePlanPeriod(worker, b, kl("2027-02-01"))).periodState, "unpaid");
    await queue(kl("2027-02-01"));
    for (let i = 0; i < 6; i++)
      if ((await h.cleanup.query("select 1 from app.billing_notice where org_id=$1 and delivery_state='pending'", [b])).rowCount) await settle();
    assert.equal((await h.cleanup.query("select delivery_state from app.billing_notice where org_id=$1", [b])).rows[0].delivery_state, "sent");
    assert.equal((await mailTo(h.bob.confirmedEmail)).length, 1);
  } finally {
    await close();
  }
});

test("a plan stopped notice is skipped when the owner started a plan again the same day", async () => {
  const { h, worker, a, adjust, subscribe, queue, states, settle, close } = await skipSetup();
  try {
    // A real-clock period that began today: choose_plan reuses it in place.
    const today = (await h.cleanup.query("select ((now() at time zone 'Asia/Kuala_Lumpur')::date)::text d")).rows[0].d as string;
    await subscribe(a, "starter", today);
    assert.equal((await chargePlanPeriod(worker, a)).periodState, "unpaid");
    const later = new Date(Date.now() + 8 * 86_400_000);
    assert.equal((await chargePlanPeriod(worker, a, later)).periodState, "downgraded");
    await queue(later);
    assert.ok((await states()).some((r) => r.reason === "PLAN_STOPPED" && r.delivery_state === "pending"));
    await adjust(a, 4900);
    const started = (
      await h.sqlAsApp(h.alice, a, async (tx) => (await tx.query("select app_private.choose_plan($1,'starter') v", [a])).rows[0].v)
    ) as { outcome: string };
    assert.equal(started.outcome, "started");
    await settle();
    assert.ok((await states()).every((r) => r.delivery_state === "skipped"), JSON.stringify(await states()));
    assert.deepEqual(await mailTo(h.alice.confirmedEmail), []);
  } finally {
    await close();
  }
});

// This organization's plan notice states, oldest first.
const planStates = async (h: H, org: string) =>
  (
    await h.cleanup.query("select delivery_state from app.billing_notice where org_id=$1 and channel='plan' order by created_at,reason", [org])
  ).rows.map((r) => r.delivery_state as string);
// A real-clock Kuala Lumpur date, days from today (the plans take effect
// from 14 November 2026, so a period cannot start earlier than that).
const klDate = async (h: H, days = 0) =>
  (await h.cleanup.query("select ((now() at time zone 'Asia/Kuala_Lumpur')::date+$1::int)::text d", [days])).rows[0].d as string;

test("fee unpaid: not queued when the wallet already holds the fee; a queued one is skipped once it does", async () => {
  const { h, worker, adjust, subscribe, queue, notices, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    for (const org of [a, b]) {
      await subscribe(org);
      assert.equal((await chargePlanPeriod(worker, org, kl("2027-02-01"))).periodState, "unpaid");
    }
    // A is credited but not charged: the next run takes the fee by itself.
    await adjust(a, 4900);
    await queue(kl("2027-02-01"));
    assert.deepEqual(await notices(a), []);
    // B was short when queued and is credited (not charged) before the send.
    await adjust(b, 4900);
    assert.deepEqual(await notices(b), [null]);
    assert.deepEqual(await planStates(h, b), ["skipped"]);
  } finally {
    await close();
  }
});

test("fee unpaid: not queued once grace has ended; skipped at send time when grace ended meanwhile", async () => {
  const { h, worker, subscribe, queue, notices, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    await subscribe(a);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "unpaid");
    // Grace ends at 00:00 on 7 February; the period has not been moved on yet.
    await queue(kl("2027-02-07"));
    assert.deepEqual(await notices(a), []);
    await queue(kl("2027-02-06", "23:00:00"));
    assert.deepEqual((await notices(a)).map((n) => n.reason), ["PLAN_FEE_UNPAID"]);
    // The send-time check compares grace with the real clock, so B uses a
    // real-clock period: queued while in grace, sent after it ended with the
    // period not yet moved on (grace is brought forward to stand for the days
    // in between).
    await subscribe(b, "starter", await klDate(h));
    assert.equal((await chargePlanPeriod(worker, b)).periodState, "unpaid");
    await queue(new Date());
    assert.deepEqual(await planStates(h, b), ["pending"]);
    await h.cleanup.query("update app.plan_period set grace_until=now() where org_id=$1 and state='unpaid'", [b]);
    assert.deepEqual(await notices(b), [null]);
    assert.deepEqual(await planStates(h, b), ["skipped"]);
  } finally {
    await close();
  }
});

test("plan stopped: not queued for a period whose grace ended more than two days before", async () => {
  const { h, worker, subscribe, queue, notices, close } = await setup();
  try {
    const a = h.orgA.id;
    await subscribe(a);
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-01"))).periodState, "unpaid");
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-07"))).periodState, "downgraded");
    // Grace ended at 00:00 on 7 February.
    await queue(kl("2027-02-09"));
    assert.deepEqual(await notices(a), [], "too late to announce");
    await queue(kl("2027-02-08", "23:00:00"));
    assert.deepEqual((await notices(a)).map((n) => n.reason), ["PLAN_STOPPED"]);
  } finally {
    await close();
  }
});

test("fee due: skipped at send time after a change to pay as you go; sent with the new plan and fee after a change to another paid plan", async () => {
  const { h, worker, adjust, subscribe, queue, notices, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    for (const org of [a, b]) {
      await subscribe(org);
      await adjust(org, 6400);
      assert.equal((await chargePlanPeriod(worker, org, kl("2027-02-01"))).periodState, "charged");
    }
    await queue(kl("2027-02-25"));
    const stored = await h.cleanup.query(
      "select plan_code,amount_sen::int from app.billing_notice where org_id=any($1) and channel='plan' order by org_id=$2 desc",
      [[a, b], a],
    );
    assert.deepEqual(stored.rows, [
      { plan_code: "starter", amount_sen: 4900 },
      { plan_code: "starter", amount_sen: 4900 },
    ]);
    await h.cleanup.query("update app.org_plan set pending_plan_code='payg' where org_id=$1", [a]);
    await h.cleanup.query("update app.org_plan set pending_plan_code='growth' where org_id=$1", [b]);
    assert.deepEqual(await notices(a), [null], "no fee is due on pay as you go");
    assert.deepEqual(await planStates(h, a), ["skipped"]);
    assert.deepEqual((await notices(b)).map(brief), [
      {
        channel: "plan",
        reason: "PLAN_FEE_DUE",
        emails: [h.bob.confirmedEmail],
        plan: "growth",
        amountSen: 12900,
        balanceSen: 1500,
        dueDate: "2027-02-28",
        payBy: null,
        whatsappAgent: true,
      },
    ]);
  } finally {
    await close();
  }
});

test("queue_plan_notices: one organization's failing notice does not stop another's", async () => {
  const { h, worker, subscribe, queue, notices, close } = await setup();
  try {
    const [a, b] = [h.orgA.id, h.orgB.id];
    for (const org of [a, b]) {
      await subscribe(org);
      assert.equal((await chargePlanPeriod(worker, org, kl("2027-02-01"))).periodState, "unpaid");
    }
    // A period no notice can carry (pay as you go, yet unpaid): its insert
    // breaks billing_notice_plan_shape.
    await h.cleanup.query("update app.plan_period set plan_code='payg' where org_id=$1", [a]);
    assert.ok((await queue(kl("2027-02-01"))) >= 1);
    assert.deepEqual(await notices(a), []);
    assert.deepEqual((await notices(b)).map((n) => n.reason), ["PLAN_FEE_UNPAID"]);
  } finally {
    await close();
  }
});

test("a plan stopped notice is skipped when the owner picks a plan on a later day (the stopped period is cut short, not reused)", async () => {
  const { h, worker, a, adjust, subscribe, queue, states, settle, close } = await skipSetup();
  try {
    // A real-clock period that began yesterday; its grace ends in six days.
    const start = await klDate(h, -1);
    await subscribe(a, "starter", start);
    assert.equal((await chargePlanPeriod(worker, a, kl(start))).periodState, "unpaid");
    const later = new Date(Date.now() + 7 * 86_400_000);
    assert.equal((await chargePlanPeriod(worker, a, later)).periodState, "downgraded");
    await queue(later);
    assert.deepEqual(await states(), [{ reason: "PLAN_STOPPED", delivery_state: "pending" }]);
    await adjust(a, 4900);
    const started = (
      await h.sqlAsApp(h.alice, a, async (tx) => (await tx.query("select app_private.choose_plan($1,'starter') v", [a])).rows[0].v)
    ) as { outcome: string };
    assert.equal(started.outcome, "started");
    // The stopped period stays downgraded and now ends today; a new period starts today.
    const old = (
      await h.cleanup.query(
        "select state,period_end=(now() at time zone 'Asia/Kuala_Lumpur')::date ends_today from app.plan_period where org_id=$1 and period_start=$2",
        [a, start],
      )
    ).rows[0];
    assert.deepEqual(old, { state: "downgraded", ends_today: true });
    await settle();
    assert.deepEqual(await states(), [{ reason: "PLAN_STOPPED", delivery_state: "skipped" }]);
    assert.deepEqual(await mailTo(h.alice.confirmedEmail), []);
  } finally {
    await close();
  }
});
