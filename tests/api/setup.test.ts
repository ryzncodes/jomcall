import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPhase2Harness } from "../helpers/phase2.ts";
import {
  MAX_QUESTIONS,
  questionById,
  setupQuestions,
} from "../../packages/domain/src/setup/questions.ts";

// Saved hours drop the hours question (see "saved hours and first words are
// not asked again"). The harness saves hours for every workspace, so `start`
// hides them while the list is frozen and puts back what was there.
async function withoutSavedHours<T>(
  f: Awaited<ReturnType<typeof createPhase2Harness>>,
  run: () => Promise<T>,
) {
  const where = [f.h.orgA.id, f.h.orgA.locationId];
  const prior = (
    await f.h.cleanup.query(
      "select weekdays from app.location_schedule where org_id=$1 and location_id=$2",
      where,
    )
  ).rows[0];
  await f.h.cleanup.query(
    "update app.location_schedule set weekdays='[[],[],[],[],[],[],[]]' where org_id=$1 and location_id=$2",
    where,
  );
  try {
    return await run();
  } finally {
    if (prior)
      await f.h.cleanup.query(
        "update app.location_schedule set weekdays=$3 where org_id=$1 and location_id=$2",
        [...where, JSON.stringify(prior.weekdays)],
      );
  }
}

async function fixture() {
  const f = await createPhase2Harness();
  const path = `/agents/${f.h.orgA.agentId}/setup`;
  const start = (body: unknown = { mainPack: "appointment", extraPacks: [] }) =>
    withoutSavedHours(f, () => f.req("POST", path, body));
  const get = async () => (await f.req("GET", path)).body.data;
  return { f, path, start, get };
}
const ledger = (f: Awaited<ReturnType<typeof fixture>>["f"]) =>
  f.h.cleanup.query(
    "select amount_sen from app.wallet_ledger where org_id=$1 and kind='trial_credit'",
    [f.h.orgA.id],
  );

test("startSetup opens a session, returns at most 8 questions and claims the trial credit once", async () => {
  const { f, start, get } = await fixture();
  try {
    assert.equal((await get()).session, null);
    const r = await start();
    assert.equal(r.status, 200);
    const s = r.body.data;
    assert.equal(s.session.mainPack, "appointment");
    assert.equal(s.session.state, "open");
    assert.ok(s.questions.length > 0 && s.questions.length <= MAX_QUESTIONS);
    assert.equal(s.questions[0].kind, "hours");
    assert.deepEqual(s.items, []);
    let rows = (await ledger(f)).rows;
    assert.deepEqual(rows, [{ amount_sen: 2000 }]);
    const again = await start({
      mainPack: "stock-price",
      extraPacks: ["order"],
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.session.id, s.session.id);
    assert.equal(again.body.data.session.mainPack, "stock-price");
    assert.equal(again.body.data.session.revision, s.session.revision + 1);
    rows = (await ledger(f)).rows;
    assert.equal(rows.length, 1);
    // Bad packs.
    assert.equal(
      (await start({ mainPack: "nope", extraPacks: [] })).status,
      422,
    );
    assert.equal(
      (await start({ mainPack: "order", extraPacks: ["order"] })).status,
      422,
    );
    assert.equal(
      (
        await start({
          mainPack: "order",
          extraPacks: ["appointment", "appointment"],
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await start({
          mainPack: "order",
          extraPacks: [
            "appointment",
            "stock-price",
            "quote-visit",
            "case-intake",
          ],
        })
      ).status,
      422,
    );
  } finally {
    await f.close();
  }
});

test("an answer is kept and its question leaves the list", async () => {
  const { f, path, start, get } = await fixture();
  try {
    const s = (await start()).body.data;
    const q = s.questions.find((x: any) => x.kind === "fact");
    const put = await f.req(
      "PUT",
      `${path}/answers/${encodeURIComponent(q.id)}`,
      {
        expectedRevision: s.session.revision,
        answer: { kind: "fact", text: "  Cuci gigi RM80  " },
      },
    );
    assert.equal(put.status, 200);
    const fresh = await get();
    assert.equal(fresh.items.length, 1);
    assert.equal(fresh.items[0].kind, "fact");
    assert.equal(fresh.items[0].state, "pending");
    assert.equal(fresh.items[0].source, "interview");
    assert.equal(fresh.items[0].payload.value, "Cuci gigi RM80");
    assert.equal(fresh.session.revision, s.session.revision + 1);
    assert.ok(!fresh.questions.some((x: any) => x.id === q.id));
    assert.ok(fresh.questions.length >= 1);
    // Re-answering updates the same row.
    const again = await f.req(
      "PUT",
      `${path}/answers/${encodeURIComponent(q.id)}`,
      {
        expectedRevision: fresh.session.revision,
        answer: { kind: "fact", text: "Berubah" },
      },
    );
    assert.equal(again.body.data.items.length, 1);
    assert.equal(again.body.data.items[0].payload.value, "Berubah");
    // Unknown question and wrong answer kind.
    assert.equal(
      (
        await f.req("PUT", `${path}/answers/nope`, {
          expectedRevision: again.body.data.session.revision,
          answer: { kind: "skip" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.req("PUT", `${path}/answers/hours`, {
          expectedRevision: again.body.data.session.revision,
          answer: { kind: "fact", text: "x" },
        })
      ).status,
      422,
    );
  } finally {
    await f.close();
  }
});

test("a 2001-character answer is refused with a validation error; a spaces-only answer is a skip; emoji and Chinese text come back unchanged", async () => {
  const { f, path, start, get } = await fixture();
  try {
    let s = (await start()).body.data;
    const facts = s.questions.filter((x: any) => x.kind === "fact");
    const answer = (q: any, a: unknown) =>
      f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
        expectedRevision: s.session.revision,
        answer: a,
      });
    const long = await answer(facts[0], {
      kind: "fact",
      text: "a".repeat(2001),
    });
    assert.equal(long.status, 422);
    assert.equal(long.body.error.code, "VALIDATION_ERROR");
    assert.equal(
      (await answer(facts[0], { kind: "fact", text: "a".repeat(2000) })).status,
      200,
    );
    s = await get();
    const blank = await answer(facts[1], { kind: "fact", text: "   \n " });
    assert.equal(blank.status, 200);
    s = blank.body.data;
    assert.ok(s.items.some((i: any) => i.state === "removed"));
    assert.ok(!s.questions.some((x: any) => x.id === facts[1].id));
    const text = "营业时间 9am-6pm 😀 RM 8.50";
    const sp = await answer(facts[2], { kind: "fact", text });
    s = sp.body.data;
    assert.equal(
      s.items.find((i: any) => i.payload.value === text).payload.value,
      text,
    );
    assert.equal(
      (await get()).items.find((i: any) => i.payload.value === text).payload
        .value,
      text,
    );
    // Over the 4,000-byte value limit even under 2,000 characters.
    assert.equal(
      (await answer(facts[3], { kind: "fact", text: "好".repeat(1400) }))
        .status,
      422,
    );
    // Re-answering a skipped question revives its row, no second row.
    const before = s.items.length;
    const revive = await answer(facts[1], {
      kind: "fact",
      text: "Sekarang jawab",
    });
    assert.equal(revive.body.data.items.length, before);
    assert.equal(
      revive.body.data.items.find(
        (i: any) => i.payload.value === "Sekarang jawab",
      ).state,
      "pending",
    );
  } finally {
    await f.close();
  }
});

test("hours and first words are stored as schedule and settings items", async () => {
  const { f, path, start, get } = await fixture();
  try {
    let s = (await start()).body.data;
    const weekdays = Array.from({ length: 7 }, () => [
      { start: "10:00", end: "20:00" },
    ]);
    const h = await f.req("PUT", `${path}/answers/hours`, {
      expectedRevision: s.session.revision,
      answer: { kind: "hours", timezone: "Asia/Kuala_Lumpur", weekdays },
    });
    assert.equal(h.status, 200);
    const w = await f.req("PUT", `${path}/answers/first_words`, {
      expectedRevision: h.body.data.session.revision,
      answer: {
        kind: "first_words",
        greeting: "Hai, Klinik Contoh.",
        aiDisclosure: "Saya pembantu AI.",
      },
    });
    assert.equal(w.status, 200);
    s = await get();
    const sched = s.items.find((i: any) => i.kind === "schedule");
    const sett = s.items.find((i: any) => i.kind === "settings");
    assert.equal(sched.key, "schedule");
    assert.deepEqual(sched.payload.weekdays, weekdays);
    assert.equal(sett.key, "settings");
    assert.equal(sett.payload.greeting, "Hai, Klinik Contoh.");
    assert.ok(
      !s.questions.some(
        (q: any) => q.kind === "hours" || q.kind === "first_words",
      ),
    );
    // Empty greeting is refused.
    assert.equal(
      (
        await f.req("PUT", `${path}/answers/first_words`, {
          expectedRevision: s.session.revision,
          answer: { kind: "first_words", greeting: "  ", aiDisclosure: "x" },
        })
      ).status,
      422,
    );
    // saveSetupItem: confirm, edit, remove.
    const id = sett.id;
    const c = await f.req("PUT", `${path}/items/${id}`, {
      expectedRevision: s.session.revision,
      state: "confirmed",
    });
    assert.equal(
      c.body.data.items.find((i: any) => i.id === id).state,
      "confirmed",
    );
    const e = await f.req("PUT", `${path}/items/${id}`, {
      expectedRevision: c.body.data.session.revision,
      payload: { greeting: "Baru", aiDisclosure: "AI" },
      state: "removed",
    });
    const item = e.body.data.items.find((i: any) => i.id === id);
    assert.equal(item.state, "removed");
    assert.equal(item.payload.greeting, "Baru");
    // A removed item keeps its question out of the list.
    assert.ok(
      !e.body.data.questions.some((q: any) => q.kind === "first_words"),
    );
    assert.equal(
      (
        await f.req("PUT", `${path}/items/${id}`, {
          expectedRevision: e.body.data.session.revision,
        })
      ).status,
      422,
    );
  } finally {
    await f.close();
  }
});

test("staff are refused on every setup command", async () => {
  const { f, path, start } = await fixture();
  try {
    const s = (await start()).body.data;
    const as = (method: string, p: string, body?: unknown) =>
      f.api.request(f.h.staff, f.h.orgA.id, method, "/api/v1" + p, body);
    const itemId = "00000000-0000-4000-8000-000000000001";
    for (const r of [
      await as("GET", path),
      await as("POST", path, { mainPack: "appointment", extraPacks: [] }),
      await as("PUT", `${path}/answers/hours`, {
        expectedRevision: s.session.revision,
        answer: { kind: "skip" },
      }),
      await as("PUT", `${path}/items/${itemId}`, {
        expectedRevision: s.session.revision,
        state: "removed",
      }),
    ])
      assert.equal(r.status, 403);
  } finally {
    await f.close();
  }
});

test("a stale revision is refused with CONFLICT", async () => {
  const { f, path, start, get } = await fixture();
  try {
    const s = (await start()).body.data;
    const body = {
      expectedRevision: s.session.revision,
      answer: { kind: "skip" },
    };
    assert.equal(
      (await f.req("PUT", `${path}/answers/hours`, body)).status,
      200,
    );
    const stale = await f.req("PUT", `${path}/answers/first_words`, body);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "CONFLICT");
    const item = (await get()).items[0];
    assert.equal(
      (
        await f.req("PUT", `${path}/items/${item.id}`, {
          expectedRevision: s.session.revision,
          state: "pending",
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});

test("nothing staged appears in knowledgeCore or in a draft test session's snapshot", async () => {
  const { f, path, start } = await fixture();
  try {
    const s = (await start()).body.data;
    const fact = s.questions.find((x: any) => x.kind === "fact");
    let rev = s.session.revision;
    for (const [id, answer] of [
      [fact.id, { kind: "fact", text: "STAGED-MARKER-123" }],
      [
        "first_words",
        {
          kind: "first_words",
          greeting: "STAGED-MARKER-123",
          aiDisclosure: "STAGED-MARKER-123",
        },
      ],
      [
        "hours",
        {
          kind: "hours",
          timezone: "Asia/Kuala_Lumpur",
          weekdays: Array.from({ length: 7 }, () => []),
        },
      ],
    ] as const) {
      const r = await f.req(
        "PUT",
        `${path}/answers/${encodeURIComponent(id)}`,
        { expectedRevision: rev, answer },
      );
      assert.equal(r.status, 200);
      rev = r.body.data.session.revision;
    }
    const agentPath = `/agents/${f.h.orgA.agentId}`;
    const core = await f.req("GET", `${agentPath}/core`);
    assert.ok(!JSON.stringify(core.body.data).includes("STAGED-MARKER-123"));
    assert.equal(core.body.data.facts.length, 0);
    const draft = (await f.req("GET", `${agentPath}/draft`)).body.data;
    assert.ok(!JSON.stringify(draft).includes("STAGED-MARKER-123"));
    const session = (
      await f.req("POST", "/agent-tests", {
        agentId: f.h.orgA.agentId,
        locationId: f.h.orgA.locationId,
        source: { kind: "draft", expectedRevision: draft.revision },
      })
    ).body.data;
    const stored = (
      await f.h.cleanup.query(
        "select snapshot from app.test_session where id=$1",
        [session.id],
      )
    ).rows[0].snapshot;
    assert.ok(!JSON.stringify(stored).includes("STAGED-MARKER-123"));
    // The fixture's saved hours are untouched.
    assert.deepEqual(stored.context.schedule.weekdays[0], [
      { start: "09:00", end: "18:00" },
    ]);
  } finally {
    await f.close();
  }
});

test("an existing confirmed fact shows up as a conflict when the same key is answered", async () => {
  const { f, path, start } = await fixture();
  try {
    const s = (await start()).body.data;
    const fact = s.questions.find((x: any) => x.kind === "fact");
    const [packId] = fact.id.split(":");
    const key = fact.fills.find((x: string) => x.startsWith("facts.")).slice(6);
    // Staged before anything exists: no conflict, and the question is open.
    const agentPath = `/agents/${f.h.orgA.agentId}`;
    const rev = (await f.req("GET", `${agentPath}/draft`)).body.data.revision;
    const saved = await f.req("POST", `${agentPath}/facts`, {
      expectedAgentRevision: rev,
      packId,
      fieldKey: key,
      title: "Existing",
      value: "Already confirmed",
    });
    assert.equal(saved.status, 200);
    // The interview list is frozen: a fact confirmed later leaves it alone.
    const afterSave = (await f.req("GET", path)).body.data;
    assert.ok(afterSave.questions.some((x: any) => x.id === fact.id));
    // Answering it anyway (the owner re-opens it) is allowed and flagged.
    const put = await f.req(
      "PUT",
      `${path}/answers/${encodeURIComponent(fact.id)}`,
      {
        expectedRevision: afterSave.session.revision,
        answer: { kind: "fact", text: "New value" },
      },
    );
    assert.equal(put.status, 200);
    const d = put.body.data;
    assert.deepEqual(d.conflicts, [
      { itemId: d.items[0].id, current: "Already confirmed" },
    ]);
    // A removed item is not a conflict.
    const removed = await f.req("PUT", `${path}/items/${d.items[0].id}`, {
      expectedRevision: d.session.revision,
      state: "removed",
    });
    assert.deepEqual(removed.body.data.conflicts, []);
    // Hours conflict with the saved schedule of the agent's location.
    const h = await f.req("PUT", `${path}/answers/hours`, {
      expectedRevision: removed.body.data.session.revision,
      answer: {
        kind: "hours",
        timezone: "Asia/Kuala_Lumpur",
        weekdays: Array.from({ length: 7 }, () => [
          { start: "08:00", end: "12:00" },
        ]),
      },
    });
    assert.equal(h.body.data.conflicts.length, 1);
    assert.equal(
      h.body.data.conflicts[0].current.weekdays[0][0].start,
      "09:00",
    );
  } finally {
    await f.close();
  }
});

test("the openapi file lists the four commands", () => {
  const spec = JSON.parse(
    readFileSync(
      new URL("../../packages/contracts/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  const text = JSON.stringify(spec);
  for (const name of ["setup", "startSetup", "answerSetup", "saveSetupItem"])
    assert.ok(text.includes(`"${name}"`), name);
  assert.ok(spec.paths["/api/v1/agents/{id}/setup"]);
  assert.ok(spec.paths["/api/v1/agents/{id}/setup/answers/{questionId}"]);
  assert.ok(spec.paths["/api/v1/agents/{id}/setup/items/{itemId}"]);
});

// ---- freeze and validation (review fixes) ----
const weekdaysOf = (s: string, e: string) =>
  Array.from({ length: 7 }, () => [{ start: s, end: e }]);
function answerFor(q: any, text = "Jawapan") {
  if (q.kind === "hours")
    return {
      kind: "hours",
      timezone: "Asia/Kuala_Lumpur",
      weekdays: weekdaysOf("09:00", "17:00"),
    };
  if (q.kind === "first_words")
    return { kind: "first_words", greeting: "Hai", aiDisclosure: "AI" };
  return { kind: "fact", text };
}
const idsOf = (f: any, agentId: string) =>
  f.h.cleanup
    .query(
      "select question_ids from app.setup_session where agent_id=$1 and state='open'",
      [agentId],
    )
    .then((r: any) => r.rows[0].question_ids as string[]);

test("the interview never asks more than 8 questions", async () => {
  const { f, path, start, get } = await fixture();
  try {
    let s = (await start()).body.data;
    const seen = new Set<string>();
    for (let n = 0; n < 40 && s.questions.length; n++) {
      const q = s.questions[0];
      seen.add(q.id);
      const r = await f.req(
        "PUT",
        `${path}/answers/${encodeURIComponent(q.id)}`,
        {
          expectedRevision: s.session.revision,
          answer: answerFor(q),
        },
      );
      assert.equal(r.status, 200);
      s = r.body.data;
    }
    assert.ok(seen.size <= MAX_QUESTIONS, `asked ${seen.size}`);
    assert.equal(s.questions.length, 0);
    assert.equal((await get()).questions.length, 0);
    assert.ok((await idsOf(f, f.h.orgA.agentId)).length <= MAX_QUESTIONS);
  } finally {
    await f.close();
  }
});

test("an answered question can be answered again", async () => {
  const { f, path, start } = await fixture();
  try {
    let s = (await start()).body.data;
    const all = s.questions.map((q: any) => q);
    for (const q of all) {
      const r = await f.req(
        "PUT",
        `${path}/answers/${encodeURIComponent(q.id)}`,
        {
          expectedRevision: s.session.revision,
          answer: answerFor(q, "Satu"),
        },
      );
      assert.equal(r.status, 200);
      s = r.body.data;
    }
    assert.equal(s.questions.length, 0);
    for (const q of [all[1], all[all.length - 1]]) {
      const r = await f.req(
        "PUT",
        `${path}/answers/${encodeURIComponent(q.id)}`,
        {
          expectedRevision: s.session.revision,
          answer: answerFor(q, "Dua"),
        },
      );
      assert.equal(r.status, 200, q.id);
      s = r.body.data;
    }
    assert.ok(s.items.some((i: any) => i.payload?.value === "Dua"));
    assert.equal(s.questions.length, 0);
  } finally {
    await f.close();
  }
});

test("changing packs keeps answered questions and drops answers of a pack that is no longer active", async () => {
  const { f, path, start } = await fixture();
  try {
    let s = (await start()).body.data;
    const own = s.questions.find((q: any) => q.id.startsWith("appointment:"));
    const base = s.questions.find((q: any) =>
      q.id.startsWith("every-business:"),
    );
    assert.ok(own && base);
    for (const q of [own, base]) {
      const r = await f.req(
        "PUT",
        `${path}/answers/${encodeURIComponent(q.id)}`,
        {
          expectedRevision: s.session.revision,
          answer: answerFor(q),
        },
      );
      s = r.body.data;
    }
    const same = await start();
    assert.equal(same.body.data.session.revision, s.session.revision);
    const r = await start({ mainPack: "stock-price", extraPacks: [] });
    assert.equal(r.status, 200);
    s = r.body.data;
    const state = (pack: string) =>
      s.items
        .filter((i: any) => i.kind === "fact" && i.payload.packId === pack)
        .map((i: any) => i.state);
    assert.deepEqual(state("appointment"), ["removed"]);
    assert.deepEqual(state("every-business"), ["pending"]);
    const ids = await idsOf(f, f.h.orgA.agentId);
    assert.ok(ids.length <= MAX_QUESTIONS);
    // The dropped pack's question leaves the frozen list; the base one stays.
    assert.ok(ids.includes(base.id) && !ids.includes(own.id));
    assert.equal(new Set(ids).size, ids.length);
    // Not asked again, and nothing from the dropped pack is newly asked.
    assert.ok(
      !s.questions.some((q: any) => q.id === base.id || q.id === own.id),
    );
    assert.ok(
      !s.questions.some(
        (q: any) => q.id.startsWith("appointment:") && q.id !== own.id,
      ),
    );
  } finally {
    await f.close();
  }
});

test("a missing required fact can be added from the review and is not counted as a question", async () => {
  const { f, path, start } = await fixture();
  try {
    const s = (await start()).body.data;
    const before = await idsOf(f, f.h.orgA.agentId);
    assert.ok(s.missing.length > 0);
    const m = s.missing[0];
    const id = `missing:${m.pack}:${m.key}`;
    const r = await f.req("PUT", `${path}/answers/${encodeURIComponent(id)}`, {
      expectedRevision: s.session.revision,
      answer: { kind: "fact", text: "Ditambah" },
    });
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.ok(!d.missing.some((x: any) => x.key === m.key));
    const item = d.items.find((i: any) => i.key === m.key);
    assert.equal(item.payload.value, "Ditambah");
    assert.equal(item.payload.packId, m.pack);
    assert.deepEqual(await idsOf(f, f.h.orgA.agentId), before);
    // Again, and unknown / not-required fields are 404.
    assert.equal(
      (
        await f.req("PUT", `${path}/answers/${encodeURIComponent(id)}`, {
          expectedRevision: d.session.revision,
          answer: { kind: "fact", text: "Lagi" },
        })
      ).status,
      200,
    );
    for (const bad of [
      `missing:${m.pack}:no_such_key`,
      "missing:nope:x",
      "missing:appointment",
    ])
      assert.equal(
        (
          await f.req("PUT", `${path}/answers/${encodeURIComponent(bad)}`, {
            expectedRevision: d.session.revision + 1,
            answer: { kind: "skip" },
          })
        ).status,
        404,
        bad,
      );
  } finally {
    await f.close();
  }
});

test("a skipped required fact still appears in missing", async () => {
  const { f, path, start } = await fixture();
  try {
    const s = (await start()).body.data;
    const keyOf = (q: any) =>
      q.fills.find((x: string) => x.startsWith("facts."))?.slice(6);
    const q = s.questions.find(
      (x: any) =>
        x.kind === "fact" && s.missing.some((m: any) => m.key === keyOf(x)),
    );
    assert.ok(q, "a question for a required fact");
    const r = await f.req(
      "PUT",
      `${path}/answers/${encodeURIComponent(q.id)}`,
      {
        expectedRevision: s.session.revision,
        answer: { kind: "skip" },
      },
    );
    assert.equal(r.status, 200);
    assert.ok(!r.body.data.questions.some((x: any) => x.id === q.id));
    assert.ok(r.body.data.missing.some((m: any) => m.key === keyOf(q)));
  } finally {
    await f.close();
  }
});

test("saveSetupItem validates the payload per kind and keeps pack and field", async () => {
  const { f, path, start } = await fixture();
  try {
    let s = (await start()).body.data;
    const fq = s.questions.find((q: any) => q.kind === "fact");
    for (const q of [
      fq,
      s.questions.find((q: any) => q.kind === "hours"),
      s.questions.find((q: any) => q.kind === "first_words"),
    ]) {
      s = (
        await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
          expectedRevision: s.session.revision,
          answer: answerFor(q, "Asal"),
        })
      ).body.data;
    }
    const item = (k: string) => s.items.find((i: any) => i.kind === k);
    const put = (id: string, payload: unknown) =>
      f.req("PUT", `${path}/items/${id}`, {
        expectedRevision: s.session.revision,
        payload,
      });
    const bad: [string, unknown][] = [
      ["fact", { value: "" }],
      ["fact", { value: 5 }],
      ["fact", { value: "x".repeat(2001) }],
      ["fact", { value: "好".repeat(1400) }],
      ["fact", { fieldKey: "evil" }],
      ["fact", { packId: "order" }],
      [
        "schedule",
        { timezone: "Not/AZone", weekdays: weekdaysOf("09:00", "17:00") },
      ],
      ["schedule", { timezone: "Asia/Kuala_Lumpur", weekdays: [] }],
      ["settings", { greeting: "", aiDisclosure: "AI" }],
      ["settings", { greeting: "Hai", aiDisclosure: "a".repeat(2001) }],
    ];
    for (const [kind, p] of bad) {
      const r = await put(item(kind).id, p);
      assert.equal(r.status, 422, JSON.stringify(p).slice(0, 60));
      assert.equal(r.body.error.code, "VALIDATION_ERROR");
    }
    const ok = await put(item("fact").id, { value: "  Baru  " });
    assert.equal(ok.status, 200);
    const after = ok.body.data.items.find((i: any) => i.id === item("fact").id);
    assert.equal(after.payload.value, "Baru");
    assert.equal(after.payload.packId, item("fact").payload.packId);
    assert.equal(after.payload.fieldKey, item("fact").payload.fieldKey);
    assert.equal(after.payload.title, item("fact").payload.title);
  } finally {
    await f.close();
  }
});

// ---- fix round 2 ----
const keyOfQ = (q: any) =>
  q.fills.find((x: string) => x.startsWith("facts."))?.slice(6);

test("after a pack change a new pack's question on a key answered under the dropped pack is asked again", async () => {
  const { f, path, start } = await fixture();
  try {
    // No two real packs ask the same fact key within their first questions
    // (checked on the shipped packs), so the closest real case: a staged
    // answer under "appointment" for the key "what_is_reserved", which
    // "reservation-rental" asks first. Inserted as the database holds it.
    const from = "appointment",
      to = "reservation-rental",
      key = "what_is_reserved";
    let s: any = (await start({ mainPack: from, extraPacks: [] })).body.data;
    await f.h.cleanup.query(
      "insert into app.setup_item(org_id,session_id,kind,key,payload,source) values($1,$2,'fact',$3,$4,'interview')",
      [
        f.h.orgA.id,
        s.session.id,
        key,
        JSON.stringify({
          packId: from,
          fieldKey: key,
          title: "x",
          value: "Lama",
          language: "mixed",
        }),
      ],
    );
    s = await (async () => (await f.req("GET", path)).body.data)();
    assert.equal(s.items.find((i: any) => i.key === key).payload.packId, from);
    s = (await start({ mainPack: to, extraPacks: [] })).body.data;
    assert.equal(s.items.find((i: any) => i.key === key).state, "removed");
    const nq = s.questions.find((x: any) => keyOfQ(x) === key);
    assert.ok(nq, "the new pack's question is visible");
    assert.ok(nq.id.startsWith(to + ":"));
    s = (
      await f.req("PUT", `${path}/answers/${encodeURIComponent(nq.id)}`, {
        expectedRevision: s.session.revision,
        answer: { kind: "fact", text: "Baru" },
      })
    ).body.data;
    const rows = s.items.filter((i: any) => i.key === key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.packId, to);
    assert.equal(rows[0].payload.value, "Baru");
    assert.equal(rows[0].state, "pending");
    assert.ok((await idsOf(f, f.h.orgA.agentId)).length <= MAX_QUESTIONS);
    // Every kept id without an item of its own (same pack and key) is visible.
    for (const id of await idsOf(f, f.h.orgA.agentId)) {
      const q = questionById(id)!;
      const own = s.items.some((i: any) =>
        q.kind === "hours"
          ? i.kind === "schedule"
          : q.kind === "first_words"
            ? i.kind === "settings"
            : i.kind === "fact" &&
              i.key === keyOfQ(q) &&
              i.payload.packId === id.split(":")[0],
      );
      assert.ok(own || s.questions.some((x: any) => x.id === id), id);
    }
  } finally {
    await f.close();
  }
});

test("a pack change leaves applied items alone", async () => {
  const { f, path, start } = await fixture();
  try {
    let s = (await start()).body.data;
    const q = s.questions.find(
      (x: any) => x.kind === "fact" && x.id.startsWith("appointment:"),
    );
    s = (
      await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
        expectedRevision: s.session.revision,
        answer: { kind: "fact", text: "x" },
      })
    ).body.data;
    await f.h.cleanup.query(
      "update app.setup_item set state='applied' where id=$1",
      [s.items[0].id],
    );
    s = (await start({ mainPack: "stock-price", extraPacks: [] })).body.data;
    assert.equal(s.items[0].state, "applied");
  } finally {
    await f.close();
  }
});

test("an open session with no stored questions gets its list on startSetup", async () => {
  const { f, start } = await fixture();
  try {
    await start();
    await f.h.cleanup.query(
      "update app.setup_session set question_ids='{}' where agent_id=$1",
      [f.h.orgA.agentId],
    );
    const s = (await start()).body.data;
    assert.ok(s.questions.length > 0 && s.questions.length <= MAX_QUESTIONS);
  } finally {
    await f.close();
  }
});

// ---- review page and finish state (browser check fixes) ----
test("a fact covered by an answered question's fills is not listed as missing", async () => {
  const { f, path, start, get } = await fixture();
  try {
    const s = (await start()).body.data;
    const q = s.questions.find((x: any) => x.id === "every-business:1");
    assert.ok(q, "base question 1 is asked");
    assert.deepEqual(q.fills, ["facts.business_name", "facts.what_we_do"]);
    assert.ok(s.missing.some((m: any) => m.key === "what_we_do"));
    const r = await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
      expectedRevision: s.session.revision,
      answer: { kind: "fact", text: "Klinik Contoh, rawatan gigi keluarga" },
    });
    assert.equal(r.status, 200);
    const d = await get();
    assert.ok(!d.missing.some((m: any) => m.key === "business_name"));
    assert.ok(!d.missing.some((m: any) => m.key === "what_we_do"));
    // Nothing extra is stored: one item, for the first fact.
    assert.deepEqual(
      d.items.map((i: any) => i.key),
      ["business_name"],
    );
    // A skip does not cover the other facts.
    const skip = await f.req(
      "PUT",
      `${path}/answers/${encodeURIComponent(q.id)}`,
      { expectedRevision: d.session.revision, answer: { kind: "skip" } },
    );
    assert.equal(skip.status, 200);
    assert.ok(skip.body.data.missing.some((m: any) => m.key === "what_we_do"));
  } finally {
    await f.close();
  }
});

test("opening hours are not missing once the schedule is answered", async () => {
  const { f, path, start } = await fixture();
  try {
    // Start from a location with no saved hours.
    await f.h.cleanup.query(
      "update app.location_schedule set weekdays='[[],[],[],[],[],[],[]]' where org_id=$1",
      [f.h.orgA.id],
    );
    const s = (await start()).body.data;
    assert.ok(s.missing.some((m: any) => m.key === "opening_hours"));
    const r = await f.req("PUT", `${path}/answers/hours`, {
      expectedRevision: s.session.revision,
      answer: answerFor({ kind: "hours" }),
    });
    assert.equal(r.status, 200);
    assert.ok(!r.body.data.missing.some((m: any) => m.key === "opening_hours"));
    // Skipped hours are missing again.
    const skip = await f.req("PUT", `${path}/answers/hours`, {
      expectedRevision: r.body.data.session.revision,
      answer: { kind: "skip" },
    });
    assert.ok(skip.body.data.missing.some((m: any) => m.key === "opening_hours"));
    // A schedule already saved on the location counts too.
    await f.h.cleanup.query(
      `insert into app.location_schedule(org_id,location_id,timezone,weekdays) values($1,$2,'Asia/Kuala_Lumpur',$3)
       on conflict (org_id,location_id) do update set weekdays=excluded.weekdays`,
      [f.h.orgA.id, f.h.orgA.locationId, JSON.stringify(weekdaysOf("09:00", "17:00"))],
    );
    const fresh = (await f.req("GET", path)).body.data;
    assert.ok(!fresh.missing.some((m: any) => m.key === "opening_hours"));
  } finally {
    await f.close();
  }
});

async function answerAll(f: any, path: string) {
  for (;;) {
    const st = (await f.req("GET", path)).body.data;
    const q = st.questions[0];
    if (!q) return st;
    const r = await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
      expectedRevision: st.session.revision,
      answer: answerFor(q),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
}
async function applyAll(f: any, path: string) {
  const st = await answerAll(f, path);
  const r = await f.req("POST", `${path}/apply`, {
    expectedRevision: st.session.revision,
    replace: st.conflicts.map((c: any) => c.itemId),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}
async function publishDraft(f: any) {
  const agent = `/agents/${f.h.orgA.agentId}`;
  const d = (await f.req("GET", `${agent}/draft`)).body.data;
  const r = await f.req("POST", `${agent}/publish`, {
    expectedRevision: d.revision,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

test("finish is true after apply and false after publish", async () => {
  const { f, path, start, get } = await fixture();
  try {
    assert.equal((await get()).finish, false);
    await start();
    assert.equal((await get()).finish, false);
    await applyAll(f, path);
    const done = await get();
    assert.equal(done.session, null);
    assert.equal(done.finish, true);
    await publishDraft(f);
    assert.equal((await get()).finish, false);
  } finally {
    await f.close();
  }
});

test("finish is true again when setup is re-run and applied on a published agent", async () => {
  const { f, path, start, get } = await fixture();
  try {
    await start();
    await applyAll(f, path);
    await publishDraft(f);
    assert.equal((await get()).finish, false);
    const again = (await start({ mainPack: "order", extraPacks: [] })).body.data;
    assert.equal(again.session.state, "open");
    assert.equal(again.finish, false);
    await applyAll(f, path);
    assert.equal((await get()).finish, true);
  } finally {
    await f.close();
  }
});

test("channels reports false for all three on a fresh workspace", async () => {
  const { f } = await fixture();
  try {
    const r = await f.req("GET", "/channels");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, {
      phone: false,
      whatsapp: false,
      integrations: false,
      live: { phone: false, whatsapp: false },
    });
  } finally {
    await f.close();
  }
});

// ---- final fix wave ----
test("saved hours and first words are not asked again; a fresh workspace gets both", async () => {
  const { f, path, start } = await fixture();
  try {
    const agentId = f.h.orgA.agentId;
    const kinds = (s: any) => s.questions.map((q: any) => q.kind);
    // The harness saved hours. Only a greeting: first words are still asked.
    await f.h.cleanup.query(
      "update app.agent set draft=draft||'{\"greeting\":\"Hai.\",\"aiDisclosure\":\"  \"}'::jsonb where id=$1",
      [agentId],
    );
    let s = (
      await f.req("POST", path, { mainPack: "appointment", extraPacks: [] })
    ).body.data;
    assert.ok(!kinds(s).includes("hours"));
    assert.ok(kinds(s).includes("first_words"));
    await f.h.cleanup.query(
      "delete from app.setup_session where agent_id=$1",
      [agentId],
    );
    // Hours and both first words saved: neither question.
    await f.h.cleanup.query(
      "update app.agent set draft=draft||'{\"greeting\":\"Hai.\",\"aiDisclosure\":\"Saya pembantu AI.\"}'::jsonb where id=$1",
      [agentId],
    );
    s = (await f.req("POST", path, { mainPack: "appointment", extraPacks: [] }))
      .body.data;
    assert.ok(!kinds(s).includes("hours"));
    assert.ok(!kinds(s).includes("first_words"));
    assert.ok(!(await idsOf(f, agentId)).some((id: string) => id === "hours" || id === "first_words"));
    // A pack change follows the same rule.
    s = (await f.req("POST", path, { mainPack: "order", extraPacks: [] })).body
      .data;
    assert.equal(s.session.mainPack, "order");
    assert.ok(!(await idsOf(f, agentId)).some((id: string) => id === "hours" || id === "first_words"));
    await f.h.cleanup.query(
      "delete from app.setup_session where agent_id=$1",
      [agentId],
    );
    // Fresh: no saved hours, empty first words.
    await f.h.cleanup.query(
      "update app.agent set draft=draft||'{\"greeting\":\"\",\"aiDisclosure\":\"\"}'::jsonb where id=$1",
      [agentId],
    );
    s = (await start()).body.data;
    assert.equal(kinds(s)[0], "hours");
    assert.equal(kinds(s).at(-1), "first_words");
  } finally {
    await f.close();
  }
});

test("a fact key shared by two packs: a skipped frozen question answered through Add now stays answered", async () => {
  const { f, path, start, get } = await fixture();
  try {
    const key = "deposit_and_payment";
    const put = async (id: string, answer: unknown) => {
      const r = await f.req("PUT", `${path}/answers/${encodeURIComponent(id)}`, {
        expectedRevision: (await get()).session.revision,
        answer,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data;
    };
    await start({ mainPack: "order", extraPacks: ["reservation-rental"] });
    // Neither pack's deposit question makes the first 8, so it is frozen
    // here as the database holds it, under the extra pack, in place of an
    // unanswered base question (the list holds at most 8).
    await f.h.cleanup.query(
      "update app.setup_session set question_ids[2]='reservation-rental:11' where agent_id=$1 and state='open'",
      [f.h.orgA.agentId],
    );
    let s = await get();
    assert.ok(s.questions.some((q: any) => q.id === "reservation-rental:11"));
    s = await put("reservation-rental:11", { kind: "skip" });
    assert.ok(!s.questions.some((q: any) => q.id === "reservation-rental:11"));
    // Listed once, under the pack of the skipped answer.
    const listed = s.missing.filter((m: any) => m.key === key);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].pack, "reservation-rental");
    s = await put(`missing:${listed[0].pack}:${key}`, {
      kind: "fact",
      text: "Deposit 50%",
    });
    // The interview does not come back, the answer is kept, not missing.
    assert.deepEqual(
      s.questions.filter((q: any) => q.id === "reservation-rental:11"),
      [],
    );
    let rows = s.items.filter((i: any) => i.key === key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.value, "Deposit 50%");
    assert.equal(rows[0].state, "pending");
    assert.ok(!s.missing.some((m: any) => m.key === key));
    // A request naming the other pack keeps the row's pack.
    s = await put(`missing:order:${key}`, { kind: "fact", text: "Deposit 30%" });
    rows = s.items.filter((i: any) => i.key === key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.packId, "reservation-rental");
    assert.equal(rows[0].payload.value, "Deposit 30%");
    assert.ok(!s.questions.some((q: any) => q.id === "reservation-rental:11"));
    // Skipping the other pack's question on the same key keeps the answer.
    await f.h.cleanup.query(
      "update app.setup_session set question_ids[3]='order:8' where agent_id=$1 and state='open'",
      [f.h.orgA.agentId],
    );
    s = await put("order:8", { kind: "skip" });
    rows = s.items.filter((i: any) => i.key === key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.value, "Deposit 30%");
    assert.equal(rows[0].payload.packId, "reservation-rental");
    assert.equal(rows[0].state, "pending");
    // So does a skip sent through the other pack's "missing:" id.
    s = await put(`missing:order:${key}`, { kind: "skip" });
    rows = s.items.filter((i: any) => i.key === key);
    assert.equal(rows[0].payload.value, "Deposit 30%");
    assert.equal(rows[0].payload.packId, "reservation-rental");
    assert.equal(rows[0].state, "pending");
  } finally {
    await f.close();
  }
});

test("saveSetupItem refuses to make an incomplete item pending or confirmed", async () => {
  const { f, path, start } = await fixture();
  try {
    let s = (await start()).body.data;
    const q = s.questions.find((x: any) => x.kind === "fact");
    s = (
      await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
        expectedRevision: s.session.revision,
        answer: { kind: "skip" },
      })
    ).body.data;
    const item = s.items.find((i: any) => i.kind === "fact");
    assert.equal(item.state, "removed");
    assert.equal(item.payload.value, undefined);
    for (const state of ["pending", "confirmed"]) {
      const r = await f.req("PUT", `${path}/items/${item.id}`, {
        expectedRevision: s.session.revision,
        state,
      });
      assert.equal(r.status, 422, state);
      assert.equal(r.body.error.code, "ITEM_INCOMPLETE");
    }
    // With a value it comes back.
    const ok = await f.req("PUT", `${path}/items/${item.id}`, {
      expectedRevision: s.session.revision,
      payload: { value: "Ada sekarang" },
      state: "pending",
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(
      ok.body.data.items.find((i: any) => i.id === item.id).state,
      "pending",
    );
  } finally {
    await f.close();
  }
});

test("a dropped pack's question never comes back after a pack change", async () => {
  const { f, path, start } = await fixture();
  try {
    let s: any = (await start({ mainPack: "order", extraPacks: [] })).body.data;
    const put = async (id: string) => {
      const q = questionById(id)!;
      const r = await f.req(
        "PUT",
        `${path}/answers/${encodeURIComponent(id)}`,
        {
          expectedRevision: s.session.revision,
          answer: answerFor(q),
        },
      );
      assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.body)}`);
      s = r.body.data;
    };
    await put("order:4");
    s = (await start({ mainPack: "quote-visit", extraPacks: [] })).body.data;
    // quote-visit:11 (lead_time) falls outside the 8 frozen slots; the first
    // quote-visit question stands in for "answer under the new pack".
    await put(s.questions.find((q: any) => q.id.startsWith("quote-visit:")).id);
    const active = ["every-business", "quote-visit"];
    const inactive = (id: string) =>
      id.includes(":") && !active.includes(id.split(":")[0]!);
    for (const q of s.questions) assert.ok(!inactive(q.id), q.id);
    for (const id of await idsOf(f, f.h.orgA.agentId))
      assert.ok(!inactive(id), id);
    // The stage can still reach review: every remaining question is answerable.
    for (let n = 0; n < 12 && s.questions.length; n++)
      await put(s.questions[0].id);
    assert.equal(s.questions.length, 0);
  } finally {
    await f.close();
  }
});

test("opening hours text question is not asked when the schedule is saved", async () => {
  const { f, path } = await fixture();
  try {
    // The harness already saves hours for the workspace; start without hiding them.
    const s = (
      await f.req("POST", path, { mainPack: "appointment", extraPacks: [] })
    ).body.data;
    assert.ok(!s.questions.some((q: any) => q.kind === "hours"));
    const frozen = await idsOf(f, f.h.orgA.agentId);
    for (const id of frozen) {
      const q = questionById(id)!;
      assert.ok(
        !(q.fills.length === 1 && q.fills[0] === "facts.opening_hours"),
        id,
      );
    }
    for (const q of s.questions)
      assert.ok(
        !(q.fills.length === 1 && q.fills[0] === "facts.opening_hours"),
        q.id,
      );
  } finally {
    await f.close();
  }
});

test("setupQuestions skips a question that fills only opening_hours once the schedule is filled", () => {
  // Base questions 1-5 answered, so the opening_hours question is next in line.
  const keys = ["business_name", "what_we_do", "address", "state", "landmarks",
    "map_link", "parking", "access_notes"];
  const ask = (filled: string[]) =>
    setupQuestions({
      mainPack: "appointment",
      extraPacks: [],
      filled: new Set([...keys, ...filled]),
    });
  const hoursText = (qs: { fills: string[] }[]) =>
    qs.some((q) => q.fills.length === 1 && q.fills[0] === "facts.opening_hours");
  assert.ok(hoursText(ask([])), "asked while no schedule is saved");
  assert.ok(!hoursText(ask(["schedule"])), "not asked once schedule is filled");
});

// ---- import facts (final review) ----
// A fact the reader drafted, written as setup_read writes it.
async function importFact(
  f: any,
  sessionId: string,
  q: any,
  flagged: boolean,
) {
  const key = keyOfQ(q);
  await f.h.cleanup.query(
    `insert into app.setup_item(org_id,session_id,kind,key,payload,source,needs_check,check_reason,state)
     values($1,$2,'fact',$3,$4,'import',$5,$6,'pending')`,
    [
      f.h.orgA.id,
      sessionId,
      key,
      JSON.stringify({
        packId: q.id.split(":")[0],
        fieldKey: key,
        title: key,
        value: "Dibaca daripada fail",
        language: "mixed",
        uploadId: crypto.randomUUID(),
      }),
      flagged,
      flagged ? "JomCall was not sure about this value." : null,
    ],
  );
}

test("a flagged import fact leaves its question asked and its fact missing; answering replaces it", async () => {
  const { f, path, start, get } = await fixture();
  try {
    const s = (await start()).body.data;
    const q = s.questions.find(
      (x: any) =>
        x.kind === "fact" && s.missing.some((m: any) => m.key === keyOfQ(x)),
    );
    assert.ok(q, "a question for a required fact");
    await importFact(f, s.session.id, q, true);
    const v = await get();
    assert.ok(v.items.some((i: any) => i.key === keyOfQ(q) && i.needsCheck));
    assert.ok(v.questions.some((x: any) => x.id === q.id));
    assert.ok(v.missing.some((m: any) => m.key === keyOfQ(q)));
    const r = await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
      expectedRevision: v.session.revision,
      answer: { kind: "fact", text: "Jawapan pemilik" },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.data;
    const items = d.items.filter((i: any) => i.key === keyOfQ(q));
    assert.equal(items.length, 1);
    assert.equal(items[0].source, "interview");
    assert.equal(items[0].needsCheck, false);
    assert.equal(items[0].checkReason, null);
    assert.equal(items[0].payload.value, "Jawapan pemilik");
    assert.equal(items[0].payload.uploadId, undefined);
    assert.ok(!d.questions.some((x: any) => x.id === q.id));
    assert.ok(!d.missing.some((m: any) => m.key === keyOfQ(q)));
  } finally {
    await f.close();
  }
});

test("an unflagged import fact hides its question and fills its fact", async () => {
  const { f, start, get } = await fixture();
  try {
    const s = (await start()).body.data;
    const q = s.questions.find(
      (x: any) =>
        x.kind === "fact" && s.missing.some((m: any) => m.key === keyOfQ(x)),
    );
    assert.ok(q, "a question for a required fact");
    await importFact(f, s.session.id, q, false);
    const v = await get();
    assert.ok(!v.questions.some((x: any) => x.id === q.id));
    assert.ok(!v.missing.some((m: any) => m.key === keyOfQ(q)));
  } finally {
    await f.close();
  }
});

test("a fact edit cannot set uploadId; the stored one is kept", async () => {
  const { f, path, start, get } = await fixture();
  try {
    const s = (await start()).body.data;
    const q = s.questions.find((x: any) => x.kind === "fact");
    await importFact(f, s.session.id, q, false);
    let v = await get();
    const item = v.items.find((i: any) => i.key === keyOfQ(q));
    const stored = item.payload.uploadId;
    const bad = await f.req("PUT", `${path}/items/${item.id}`, {
      expectedRevision: v.session.revision,
      payload: { value: "Baru", uploadId: crypto.randomUUID() },
    });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.code, "VALIDATION_ERROR");
    const ok = await f.req("PUT", `${path}/items/${item.id}`, {
      expectedRevision: v.session.revision,
      payload: { value: "Baru" },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    v = ok.body.data;
    const after = v.items.find((i: any) => i.id === item.id);
    assert.equal(after.payload.value, "Baru");
    assert.equal(after.payload.uploadId, stored);
  } finally {
    await f.close();
  }
});
