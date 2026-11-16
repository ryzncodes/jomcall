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
    assert.equal((await chargePlanPeriod(worker, a, kl("2027-02-07"))).periodState, "downgraded");
    await queue(kl("2027-02-07"));
    await queue(kl("2027-02-20"));
    const sent = await notices(a);
    assert.deepEqual(
      sent.map((n) => [n.reason, n.plan, n.amountSen, n.dueDate]),
      [
        ["PLAN_FEE_UNPAID", "starter", 4900, "2027-01-31"],
        ["PLAN_STOPPED", "starter", 4900, "2027-01-31"],
      ],
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
    const stopped = bySubject.get("Your JomCall plan has stopped / Pelan JomCall anda telah berhenti");
    assert.ok(due && unpaid && stopped, JSON.stringify(mine.map((m) => m.Subject)));
    const dueText = await mailText(due);
    assert.match(dueText, /Your Starter plan fee of RM 49\.00 is due on 28 Feb 2027\. Your wallet has RM 15\.00\. Top up at least RM 34\.00 before then/);
    assert.match(dueText, /Yuran pelan Starter anda sebanyak RM 49\.00 perlu dibayar pada 28 Feb 2027\. Dompet anda ada RM 15\.00\. Tambah nilai sekurang-kurangnya RM 34\.00/);
    const unpaidText = await mailText(unpaid);
    assert.match(unpaidText, /was due on 28 Feb 2027 and your wallet did not hold it\. Top up at least RM 34\.00 by 6 Mar 2027/);
    assert.match(unpaidText, /sekurang-kurangnya RM 34\.00 selewat-lewatnya 6 Mac 2027/);
    const stoppedText = await mailText(stopped);
    assert.match(stoppedText, /Your Starter plan stopped because the fee of RM 49\.00 was not paid\./);
    assert.match(stoppedText, /Pelan Starter anda telah berhenti kerana yuran sebanyak RM 49\.00 tidak dibayar\./);
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
