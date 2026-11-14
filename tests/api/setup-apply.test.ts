import { test } from "node:test";
import assert from "node:assert/strict";
import { createPhase2Harness } from "../helpers/phase2.ts";

const hours = (start: string, end: string) => ({
  timezone: "Asia/Kuala_Lumpur",
  weekdays: Array.from({ length: 7 }, () => [{ start, end }]),
});
const words = {
  greeting: "Selamat datang ke Klinik Contoh.",
  aiDisclosure: "Saya pembantu AI untuk klinik ini.",
};

async function fixture() {
  const f = await createPhase2Harness();
  const agentId = f.h.orgA.agentId;
  const path = `/agents/${agentId}/setup`;
  const q = (sql: string, args: unknown[] = []) =>
    f.h.cleanup.query(sql, args);
  const state = async () => (await f.req("GET", path)).body.data;
  // Start, then answer hours, first words and the first fact question.
  const stage = async (
    o: { hours?: boolean; words?: boolean; fact?: string | null } = {},
  ) => {
    // Saved hours drop the hours question, so they are hidden while the list
    // is frozen and put back after; the staged hours then still conflict.
    const where = [f.h.orgA.id, f.h.orgA.locationId];
    const prior = (
      await q(
        "select weekdays from app.location_schedule where org_id=$1 and location_id=$2",
        where,
      )
    ).rows[0];
    await q(
      "update app.location_schedule set weekdays='[[],[],[],[],[],[],[]]' where org_id=$1 and location_id=$2",
      where,
    );
    const s = (
      await f.req("POST", path, { mainPack: "appointment", extraPacks: [] })
    ).body.data;
    if (prior)
      await q(
        "update app.location_schedule set weekdays=$3 where org_id=$1 and location_id=$2",
        [...where, JSON.stringify(prior.weekdays)],
      );
    const put = async (id: string, answer: unknown) => {
      const rev = (await state()).session.revision;
      const r = await f.req("PUT", `${path}/answers/${encodeURIComponent(id)}`, {
        expectedRevision: rev,
        answer,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    };
    const byKind = (k: string) => s.questions.find((x: any) => x.kind === k);
    if (o.hours !== false)
      await put(byKind("hours").id, { kind: "hours", ...hours("10:00", "17:00") });
    if (o.words !== false)
      await put(byKind("first_words").id, { kind: "first_words", ...words });
    const fq = byKind("fact");
    if (o.fact !== null)
      await put(fq.id, { kind: "fact", text: o.fact ?? "Cuci gigi RM80" });
    return { s, fq };
  };
  const apply = async (replace: string[] = [], rev?: number, as = f.req) =>
    as("POST", `${path}/apply`, {
      expectedRevision: rev ?? (await state()).session.revision,
      replace,
    });
  const facts = async () =>
    (
      await q(
        "select pack_id,field_key,title,value,status,source from app.knowledge_fact where org_id=$1 and agent_id=$2 order by created_at,id",
        [f.h.orgA.id, agentId],
      )
    ).rows;
  const agentRow = async () =>
    (
      await q(
        "select revision,packs,draft,published_version_id from app.agent where id=$1",
        [agentId],
      )
    ).rows[0];
  const schedule = async () =>
    (
      await q(
        "select timezone,weekdays,revision from app.location_schedule where org_id=$1 and location_id=$2",
        [f.h.orgA.id, f.h.orgA.locationId],
      )
    ).rows[0];
  const itemId = (st: any, kind: string) =>
    st.items.find((i: any) => i.kind === kind).id as string;
  return { f, agentId, path, q, state, stage, apply, facts, agentRow, schedule, itemId };
}
type Fx = Awaited<ReturnType<typeof fixture>>;

// A published version exists, so "the published agent is untouched" is testable.
async function publish(x: Fx, disclose = false) {
  let d = (await x.f.req("GET", `/agents/${x.agentId}/draft`)).body.data;
  if (disclose) {
    const put = await x.f.req("PUT", `/agents/${x.agentId}/draft`, {
      expectedRevision: d.revision,
      settings: {
        name: "Klinik Contoh",
        languages: ["ms", "en"],
        manglish: true,
        greeting: "Hai.",
        instructions: "",
        aiDisclosure: "Saya pembantu AI.",
        recordingEnabled: false,
        recordingDisclosure: "",
        voicePreference: "",
      },
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    d = put.body.data;
  }
  const r = await x.f.req("POST", `/agents/${x.agentId}/publish`, {
    expectedRevision: d.revision,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
const versionText = async (x: Fx) =>
  (
    await x.q(
      "select snapshot::text as s from app.agent_version where agent_id=$1 order by sequence",
      [x.agentId],
    )
  ).rows.map((r) => r.s);

test("apply writes facts, schedule, packs and first words, and a draft test session then answers from them", async () => {
  const x = await fixture();
  try {
    await x.stage();
    const st = await x.state();
    // Nothing is visible to the agent before apply.
    assert.deepEqual(await x.facts(), []);
    assert.deepEqual((await x.agentRow()).packs, []);
    // The fixture already has hours: the owner names the schedule item.
    assert.deepEqual(
      st.conflicts.map((c: any) => c.itemId),
      [x.itemId(st, "schedule")],
    );
    const before = await x.agentRow();
    const r = await x.apply([x.itemId(st, "schedule")]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const out = r.body.data;
    assert.equal(out.applied, 3);
    assert.deepEqual(out.skipped, []);
    const a = await x.agentRow();
    assert.equal(out.agentRevision, a.revision);
    assert.ok(a.revision > before.revision);
    assert.deepEqual(a.packs, ["appointment"]);
    assert.equal(a.draft.greeting, words.greeting);
    assert.equal(a.draft.aiDisclosure, words.aiDisclosure);
    // Other settings are left as they were.
    for (const k of Object.keys(before.draft))
      if (k !== "greeting" && k !== "aiDisclosure")
        assert.deepEqual(a.draft[k], before.draft[k]);
    const fs = await x.facts();
    assert.equal(fs.length, 1);
    assert.equal(fs[0].status, "confirmed");
    assert.equal(fs[0].source, "interview");
    assert.equal(fs[0].value, "Cuci gigi RM80");
    assert.deepEqual((await x.schedule()).weekdays[0], [
      { start: "10:00", end: "17:00" },
    ]);
    const done = (
      await x.q("select state from app.setup_session where agent_id=$1", [
        x.agentId,
      ])
    ).rows;
    assert.deepEqual(done, [{ state: "applied" }]);
    assert.equal(
      (
        await x.q(
          "select count(*)::int as n from app.setup_item where state='applied' and session_id in (select id from app.setup_session where agent_id=$1)",
          [x.agentId],
        )
      ).rows[0].n,
      3,
    );

    // A draft test session freezes the new knowledge and hours.
    const t = await x.f.req("POST", "/agent-tests", {
      agentId: x.agentId,
      locationId: x.f.h.orgA.locationId,
      source: { kind: "draft", expectedRevision: out.agentRevision },
    });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    const snap = (
      await x.q("select snapshot from app.test_session where id=$1", [
        t.body.data.id,
      ])
    ).rows[0].snapshot;
    assert.ok(snap.packs.includes("appointment"));
    assert.ok(snap.facts.some((f: any) => f.value === "Cuci gigi RM80"));
    assert.deepEqual(snap.context.schedule.weekdays[0], [
      { start: "10:00", end: "17:00" },
    ]);
  } finally {
    await x.f.close();
  }
});

test("apply twice writes once", async () => {
  const x = await fixture();
  try {
    await x.stage();
    const st = await x.state();
    const rev = st.session.revision;
    const replace = [x.itemId(st, "schedule")];
    const one = await x.apply(replace, rev);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.data.applied, 3);
    const n = (await x.facts()).length;
    const rows = (await x.agentRow()).revision;
    // Same body again (a second tab).
    const two = await x.apply(replace, rev);
    assert.equal(two.status, 200, JSON.stringify(two.body));
    assert.equal(two.body.data.applied, 0);
    assert.deepEqual(two.body.data.skipped, []);
    assert.equal(two.body.data.agentRevision, rows);
    assert.equal((await x.facts()).length, n);
    assert.equal((await x.agentRow()).revision, rows);
  } finally {
    await x.f.close();
  }
});

test("two applies at the same time write once", async () => {
  const x = await fixture();
  try {
    await x.stage();
    const st = await x.state();
    const rev = st.session.revision;
    const replace = [x.itemId(st, "schedule")];
    const rs = await Promise.all([
      x.apply(replace, rev),
      x.apply(replace, rev),
    ]);
    assert.deepEqual(rs.map((r) => r.status), [200, 200]);
    assert.deepEqual(
      rs.map((r) => r.body.data.applied).sort(),
      [0, 3],
    );
    assert.equal((await x.facts()).length, 1);
  } finally {
    await x.f.close();
  }
});

// An agent that already has a confirmed value for the staged fact, with a
// published version in place.
async function conflicted() {
  const x = await fixture();
  await x.stage({ hours: false, words: false });
  const st = await x.state();
  const fact = st.items.find((i: any) => i.kind === "fact");
  await x.q(
    "insert into app.knowledge_fact(org_id,agent_id,pack_id,field_key,title,value,source) values($1,$2,$3,$4,'Old',$5,'owner')",
    [
      x.f.h.orgA.id,
      x.agentId,
      fact.payload.packId,
      fact.payload.fieldKey,
      JSON.stringify("Nilai lama"),
    ],
  );
  const v1 = await publish(x, true);
  const publishedBefore = await versionText(x);
  const now = await x.state();
  assert.deepEqual(
    now.conflicts.map((c: any) => c.itemId),
    [fact.id],
  );
  return { x, fact, v1, publishedBefore };
}

test("an existing confirmed fact is kept unless named in replace", async () => {
  const { x, fact, v1, publishedBefore } = await conflicted();
  try {
    const r = await x.apply([]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.applied, 0);
    assert.deepEqual(r.body.data.skipped, [
      { itemId: fact.id, reason: "conflict" },
    ]);
    assert.equal((await x.facts())[0].value, "Nilai lama");
    // Not named in replace means "keep current": the item is removed and the
    // session is closed.
    const rows = (
      await x.q("select state from app.setup_session where agent_id=$1", [
        x.agentId,
      ])
    ).rows;
    assert.deepEqual(rows, [{ state: "applied" }]);
    assert.equal(
      (await x.q("select state from app.setup_item where id=$1", [fact.id]))
        .rows[0].state,
      "removed",
    );
    const again = await x.apply([fact.id], 1);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.data.applied, 0);
    assert.equal((await x.facts())[0].value, "Nilai lama");
    assert.deepEqual(await versionText(x), publishedBefore);
    assert.equal((await x.agentRow()).published_version_id, v1.id);
  } finally {
    await x.f.close();
  }
});

test("a conflict named in replace is written and the published version is untouched", async () => {
  const { x, fact, v1, publishedBefore } = await conflicted();
  try {
    const r = await x.apply([fact.id]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.applied, 1);
    assert.deepEqual(r.body.data.skipped, []);
    const fs = await x.facts();
    assert.equal(fs.length, 1);
    assert.equal(fs[0].value, "Cuci gigi RM80");
    assert.equal(fs[0].source, "interview");
    assert.deepEqual(await versionText(x), publishedBefore);
    assert.equal((await x.agentRow()).published_version_id, v1.id);
  } finally {
    await x.f.close();
  }
});

test("a flagged pending item is not written", async () => {
  const x = await fixture();
  try {
    await x.stage({ hours: false, words: false });
    const st = await x.state();
    const fact = st.items.find((i: any) => i.kind === "fact");
    await x.q(
      "update app.setup_item set needs_check=true,check_reason='from a pasted page' where id=$1",
      [fact.id],
    );
    const r = await x.apply([fact.id]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.applied, 0);
    assert.deepEqual(r.body.data.skipped, [
      { itemId: fact.id, reason: "unconfirmed" },
    ]);
    assert.deepEqual(await x.facts(), []);
    // Left as it is; the session still closes.
    assert.equal(
      (await x.q("select state from app.setup_item where id=$1", [fact.id]))
        .rows[0].state,
      "pending",
    );
    assert.equal((await x.state()).session, null);
  } finally {
    await x.f.close();
  }
});

test("packs merge with the ones the agent already has", async () => {
  const x = await fixture();
  try {
    await x.q("update app.agent set packs=$2 where id=$1", [x.agentId, ["order"]]);
    await x.stage();
    const st = await x.state();
    const r = await x.apply([x.itemId(st, "schedule")]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual((await x.agentRow()).packs, ["order", "appointment"]);
  } finally {
    await x.f.close();
  }
});

test("packs over the limit of 9 fail and write nothing", async () => {
  const x = await fixture();
  try {
    await x.q("update app.agent set packs=$2 where id=$1", [
      x.agentId,
      ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"],
    ]);
    await x.stage();
    const before = await x.agentRow();
    const st = await x.state();
    const r = await x.apply([x.itemId(st, "schedule")]);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.error.code, "KNOWLEDGE_LIMIT");
    assert.deepEqual(await x.agentRow(), before);
    assert.deepEqual(await x.facts(), []);
  } finally {
    await x.f.close();
  }
});

test("a future booking outside the new hours refuses apply with BOOKINGS_AFFECTED and writes nothing", async () => {
  const x = await fixture();
  try {
    await x.stage();
    const org = x.f.h.orgA.id;
    const contact = await x.f.req("POST", "/contacts", {
      name: "Pelanggan Contoh",
      phone: "+60123456789",
      preferredLanguage: "ms",
    });
    assert.equal(contact.status, 200, JSON.stringify(contact.body));
    const res = (
      await x.q(
        "insert into app.booking_resource(org_id,location_id,name,duration_minutes) values($1,$2,'Kerusi 1',30) returning id",
        [org, x.f.h.orgA.locationId],
      )
    ).rows[0];
    // 20:00 tomorrow in Kuala Lumpur: outside the staged 10:00-17:00.
    await x.q(
      "insert into app.booking(org_id,contact_id,resource_id,location_id,title,start_at,end_at,timezone,status,source,creator_id) values($1,$2,$3,$4,'Janji temu',$5,$6,'Asia/Kuala_Lumpur','confirmed','staff',$7)",
      [
        org,
        contact.body.data.id,
        res.id,
        x.f.h.orgA.locationId,
        x.f.day + "T20:00:00+08:00",
        x.f.day + "T20:30:00+08:00",
        x.f.h.alice.userId,
      ],
    );
    const before = {
      agent: await x.agentRow(),
      schedule: await x.schedule(),
      facts: await x.facts(),
    };
    const st = await x.state();
    const r = await x.apply([x.itemId(st, "schedule")]);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.code, "BOOKINGS_AFFECTED");
    assert.deepEqual(await x.agentRow(), before.agent);
    assert.deepEqual(await x.schedule(), before.schedule);
    assert.deepEqual(await x.facts(), before.facts);
    assert.equal((await x.state()).session.state, "open");
  } finally {
    await x.f.close();
  }
});

test("a removed item is reported and not written", async () => {
  const x = await fixture();
  try {
    await x.stage({ hours: false, words: false });
    const st = await x.state();
    const fact = st.items.find((i: any) => i.kind === "fact");
    const rev = st.session.revision;
    await x.f.req("PUT", `${x.path}/items/${fact.id}`, {
      expectedRevision: rev,
      state: "removed",
    });
    const r = await x.apply([]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.applied, 0);
    assert.deepEqual(r.body.data.skipped, [
      { itemId: fact.id, reason: "removed" },
    ]);
    assert.deepEqual(await x.facts(), []);
  } finally {
    await x.f.close();
  }
});

test("apply does not publish", async () => {
  const x = await fixture();
  try {
    await x.stage();
    const before = await x.agentRow();
    const st = await x.state();
    const versions = async () =>
      (
        await x.q("select count(*)::int as n from app.agent_version where agent_id=$1", [
          x.agentId,
        ])
      ).rows[0].n;
    const n = await versions();
    const r = await x.apply([x.itemId(st, "schedule")]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(
      (await x.agentRow()).published_version_id,
      before.published_version_id,
    );
    assert.equal(await versions(), n);
    // Same with a published version in place.
    const v = await publish(x);
    const snaps = await versionText(x);
    await x.f.req("POST", x.path, { mainPack: "appointment", extraPacks: [] });
    assert.equal((await x.agentRow()).published_version_id, v.id);
    assert.deepEqual(await versionText(x), snaps);
  } finally {
    await x.f.close();
  }
});

test("a failure in one write rolls back all of them", async () => {
  const x = await fixture();
  try {
    await x.stage({ fact: "Pertama" });
    // A second fact field, then force its value over 4,000 bytes. The
    // staged-item command refuses that size (checked below), so the only way
    // to make the write fail is to change the staged row directly.
    const st0 = await x.state();
    const second = st0.questions.find((q: any) => q.kind === "fact");
    assert.ok(second, "needs a second fact question");
    let rev = st0.session.revision;
    const put = await x.f.req(
      "PUT",
      `${x.path}/answers/${encodeURIComponent(second.id)}`,
      { expectedRevision: rev, answer: { kind: "fact", text: "Kedua" } },
    );
    assert.equal(put.status, 200);
    const st = await x.state();
    const big = st.items.filter((i: any) => i.kind === "fact")[1];
    rev = st.session.revision;
    const refused = await x.f.req("PUT", `${x.path}/items/${big.id}`, {
      expectedRevision: rev,
      payload: { value: "x".repeat(4001) },
    });
    assert.equal(refused.status, 422);
    await x.q(
      "update app.setup_item set payload=jsonb_set(payload,'{value}',to_jsonb($2::text)) where id=$1",
      [big.id, "x".repeat(4100)],
    );
    const before = {
      agent: await x.agentRow(),
      schedule: await x.schedule(),
      facts: await x.facts(),
    };
    const r = await x.apply([x.itemId(st, "schedule")]);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.deepEqual(await x.agentRow(), before.agent);
    assert.deepEqual(await x.schedule(), before.schedule);
    assert.deepEqual(await x.facts(), before.facts);
    const s = (await x.state()).session;
    assert.equal(s.state, "open");
    assert.equal(
      (
        await x.q(
          "select count(*)::int as n from app.setup_item where state='applied' and org_id=$1",
          [x.f.h.orgA.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await x.f.close();
  }
});

test("staff cannot apply", async () => {
  const x = await fixture();
  try {
    await x.stage();
    const st = await x.state();
    const as = (method: string, p: string, body?: unknown) =>
      x.f.api.request(x.f.h.staff, x.f.h.orgA.id, method, "/api/v1" + p, body);
    const r = await as("POST", `${x.path}/apply`, {
      expectedRevision: st.session.revision,
      replace: [],
    });
    assert.equal(r.status, 403);
    assert.deepEqual(await x.facts(), []);
  } finally {
    await x.f.close();
  }
});

test("a stale revision is refused and a missing session is not found", async () => {
  const x = await fixture();
  try {
    const none = await x.f.req("POST", `${x.path}/apply`, {
      expectedRevision: 1,
      replace: [],
    });
    assert.equal(none.status, 404);
    await x.stage();
    const st = await x.state();
    const stale = await x.apply([], st.session.revision - 1);
    assert.equal(stale.status, 409);
    assert.deepEqual(await x.facts(), []);
  } finally {
    await x.f.close();
  }
});

// ---- final fix wave ----
test("apply waits for a schedule save in progress and keeps those hours", async () => {
  const x = await fixture();
  try {
    const org = x.f.h.orgA.id,
      loc = x.f.h.orgA.locationId;
    await x.q(
      "update app.location_schedule set weekdays='[[],[],[],[],[],[],[]]' where org_id=$1 and location_id=$2",
      [org, loc],
    );
    await x.stage({ words: false, fact: null });
    const st = await x.state();
    assert.deepEqual(st.conflicts, []);
    const scheduleItem = x.itemId(st, "schedule");
    const other = await x.f.h.cleanup.connect();
    try {
      // Another save holds the location, as writeSchedule does.
      await other.query("begin");
      await other.query(
        "select id from app.location where org_id=$1 and id=$2 for update",
        [org, loc],
      );
      await other.query(
        "update app.location_schedule set weekdays=$3 where org_id=$1 and location_id=$2",
        [org, loc, JSON.stringify(hours("08:00", "12:00").weekdays)],
      );
      const pending = x.apply([], st.session.revision);
      await new Promise((r) => setTimeout(r, 300));
      await other.query("commit");
      const r = await pending;
      assert.equal(r.status, 200, JSON.stringify(r.body));
      // Apply decided after the other save: its hours are current, so the
      // staged hours are a conflict the owner did not name.
      assert.equal(r.body.data.applied, 0);
      assert.deepEqual(r.body.data.skipped, [
        { itemId: scheduleItem, reason: "conflict" },
      ]);
      assert.deepEqual((await x.schedule()).weekdays[0], [
        { start: "08:00", end: "12:00" },
      ]);
    } finally {
      other.release();
    }
  } finally {
    await x.f.close();
  }
});

test("after apply in one tab, another tab's answer or item save is a conflict", async () => {
  const x = await fixture();
  try {
    // No session ever: not found.
    const none = await x.f.req("PUT", `${x.path}/answers/hours`, {
      expectedRevision: 1,
      answer: { kind: "skip" },
    });
    assert.equal(none.status, 404);
    const { fq } = await x.stage();
    const st = await x.state();
    const rev = st.session.revision;
    const item = st.items.find((i: any) => i.kind === "fact");
    const done = await x.apply([x.itemId(st, "schedule")], rev);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const answer = await x.f.req(
      "PUT",
      `${x.path}/answers/${encodeURIComponent(fq.id)}`,
      { expectedRevision: rev, answer: { kind: "fact", text: "Lewat" } },
    );
    assert.equal(answer.status, 409, JSON.stringify(answer.body));
    assert.equal(answer.body.error.code, "CONFLICT");
    const save = await x.f.req("PUT", `${x.path}/items/${item.id}`, {
      expectedRevision: rev,
      payload: { value: "Lewat" },
    });
    assert.equal(save.status, 409, JSON.stringify(save.body));
    assert.equal(save.body.error.code, "CONFLICT");
  } finally {
    await x.f.close();
  }
});

test("Something else does not add the base pack to the agent's packs", async () => {
  const x = await fixture();
  try {
    const s = await x.f.req("POST", x.path, {
      mainPack: "every-business",
      extraPacks: [],
    });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const r = await x.apply([]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual((await x.agentRow()).packs, []);
  } finally {
    await x.f.close();
  }
});
