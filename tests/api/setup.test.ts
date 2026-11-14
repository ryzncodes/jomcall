import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { MAX_QUESTIONS } from "../../packages/domain/src/setup/questions.ts";

async function fixture() {
  const f = await createPhase2Harness();
  const path = `/agents/${f.h.orgA.agentId}/setup`;
  const start = (body: unknown = { mainPack: "appointment", extraPacks: [] }) =>
    f.req("POST", path, body);
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
    const again = await start({ mainPack: "stock-price", extraPacks: ["order"] });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.session.id, s.session.id);
    assert.equal(again.body.data.session.mainPack, "stock-price");
    assert.equal(again.body.data.session.revision, s.session.revision + 1);
    rows = (await ledger(f)).rows;
    assert.equal(rows.length, 1);
    // Bad packs.
    assert.equal((await start({ mainPack: "nope", extraPacks: [] })).status, 422);
    assert.equal((await start({ mainPack: "order", extraPacks: ["order"] })).status, 422);
    assert.equal((await start({ mainPack: "order", extraPacks: ["appointment", "appointment"] })).status, 422);
    assert.equal(
      (await start({ mainPack: "order", extraPacks: ["appointment", "stock-price", "quote-visit", "case-intake"] })).status,
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
    const put = await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
      expectedRevision: s.session.revision,
      answer: { kind: "fact", text: "  Cuci gigi RM80  " },
    });
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
    const again = await f.req("PUT", `${path}/answers/${encodeURIComponent(q.id)}`, {
      expectedRevision: fresh.session.revision,
      answer: { kind: "fact", text: "Berubah" },
    });
    assert.equal(again.body.data.items.length, 1);
    assert.equal(again.body.data.items[0].payload.value, "Berubah");
    // Unknown question and wrong answer kind.
    assert.equal(
      (await f.req("PUT", `${path}/answers/nope`, { expectedRevision: again.body.data.session.revision, answer: { kind: "skip" } })).status,
      404,
    );
    assert.equal(
      (await f.req("PUT", `${path}/answers/hours`, {
        expectedRevision: again.body.data.session.revision,
        answer: { kind: "fact", text: "x" },
      })).status,
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
    const long = await answer(facts[0], { kind: "fact", text: "a".repeat(2001) });
    assert.equal(long.status, 422);
    assert.equal(long.body.error.code, "VALIDATION_ERROR");
    assert.equal((await answer(facts[0], { kind: "fact", text: "a".repeat(2000) })).status, 200);
    s = await get();
    const blank = await answer(facts[1], { kind: "fact", text: "   \n " });
    assert.equal(blank.status, 200);
    s = blank.body.data;
    assert.ok(s.items.some((i: any) => i.state === "removed"));
    assert.ok(!s.questions.some((x: any) => x.id === facts[1].id));
    const text = "营业时间 9am-6pm 😀 RM 8.50";
    const sp = await answer(facts[2], { kind: "fact", text });
    s = sp.body.data;
    assert.equal(s.items.find((i: any) => i.payload.value === text).payload.value, text);
    assert.equal((await get()).items.find((i: any) => i.payload.value === text).payload.value, text);
    // Over the 4,000-byte value limit even under 2,000 characters.
    assert.equal((await answer(facts[3], { kind: "fact", text: "好".repeat(1400) })).status, 422);
    // Re-answering a skipped question revives its row, no second row.
    const before = s.items.length;
    const revive = await answer(facts[1], { kind: "fact", text: "Sekarang jawab" });
    assert.equal(revive.body.data.items.length, before);
    assert.equal(revive.body.data.items.find((i: any) => i.payload.value === "Sekarang jawab").state, "pending");
  } finally {
    await f.close();
  }
});

test("hours and first words are stored as schedule and settings items", async () => {
  const { f, path, start, get } = await fixture();
  try {
    let s = (await start()).body.data;
    const weekdays = Array.from({ length: 7 }, () => [{ start: "10:00", end: "20:00" }]);
    const h = await f.req("PUT", `${path}/answers/hours`, {
      expectedRevision: s.session.revision,
      answer: { kind: "hours", timezone: "Asia/Kuala_Lumpur", weekdays },
    });
    assert.equal(h.status, 200);
    const w = await f.req("PUT", `${path}/answers/first_words`, {
      expectedRevision: h.body.data.session.revision,
      answer: { kind: "first_words", greeting: "Hai, Klinik Contoh.", aiDisclosure: "Saya pembantu AI." },
    });
    assert.equal(w.status, 200);
    s = await get();
    const sched = s.items.find((i: any) => i.kind === "schedule");
    const sett = s.items.find((i: any) => i.kind === "settings");
    assert.equal(sched.key, "schedule");
    assert.deepEqual(sched.payload.weekdays, weekdays);
    assert.equal(sett.key, "settings");
    assert.equal(sett.payload.greeting, "Hai, Klinik Contoh.");
    assert.ok(!s.questions.some((q: any) => q.kind === "hours" || q.kind === "first_words"));
    // Empty greeting is refused.
    assert.equal(
      (await f.req("PUT", `${path}/answers/first_words`, {
        expectedRevision: s.session.revision,
        answer: { kind: "first_words", greeting: "  ", aiDisclosure: "x" },
      })).status,
      422,
    );
    // saveSetupItem: confirm, edit, remove.
    const id = sett.id;
    const c = await f.req("PUT", `${path}/items/${id}`, { expectedRevision: s.session.revision, state: "confirmed" });
    assert.equal(c.body.data.items.find((i: any) => i.id === id).state, "confirmed");
    const e = await f.req("PUT", `${path}/items/${id}`, {
      expectedRevision: c.body.data.session.revision,
      payload: { greeting: "Baru", aiDisclosure: "AI" },
      state: "removed",
    });
    const item = e.body.data.items.find((i: any) => i.id === id);
    assert.equal(item.state, "removed");
    assert.equal(item.payload.greeting, "Baru");
    // A removed item keeps its question out of the list.
    assert.ok(!e.body.data.questions.some((q: any) => q.kind === "first_words"));
    assert.equal(
      (await f.req("PUT", `${path}/items/${id}`, { expectedRevision: e.body.data.session.revision })).status,
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
      await as("PUT", `${path}/answers/hours`, { expectedRevision: s.session.revision, answer: { kind: "skip" } }),
      await as("PUT", `${path}/items/${itemId}`, { expectedRevision: s.session.revision, state: "removed" }),
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
    const body = { expectedRevision: s.session.revision, answer: { kind: "skip" } };
    assert.equal((await f.req("PUT", `${path}/answers/hours`, body)).status, 200);
    const stale = await f.req("PUT", `${path}/answers/first_words`, body);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "CONFLICT");
    const item = (await get()).items[0];
    assert.equal(
      (await f.req("PUT", `${path}/items/${item.id}`, { expectedRevision: s.session.revision, state: "pending" })).status,
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
      ["first_words", { kind: "first_words", greeting: "STAGED-MARKER-123", aiDisclosure: "STAGED-MARKER-123" }],
      ["hours", { kind: "hours", timezone: "Asia/Kuala_Lumpur", weekdays: Array.from({ length: 7 }, () => []) }],
    ] as const) {
      const r = await f.req("PUT", `${path}/answers/${encodeURIComponent(id)}`, { expectedRevision: rev, answer });
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
    const stored = (await f.h.cleanup.query("select snapshot from app.test_session where id=$1", [session.id])).rows[0].snapshot;
    assert.ok(!JSON.stringify(stored).includes("STAGED-MARKER-123"));
    // The fixture's saved hours are untouched.
    assert.deepEqual(stored.context.schedule.weekdays[0], [{ start: "09:00", end: "18:00" }]);
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
    // The confirmed fact takes the question out of the list.
    const afterSave = (await f.req("GET", path)).body.data;
    assert.ok(!afterSave.questions.some((x: any) => x.id === fact.id));
    // Answering it anyway (the owner re-opens it) is allowed and flagged.
    const put = await f.req("PUT", `${path}/answers/${encodeURIComponent(fact.id)}`, {
      expectedRevision: afterSave.session.revision,
      answer: { kind: "fact", text: "New value" },
    });
    assert.equal(put.status, 200);
    const d = put.body.data;
    assert.deepEqual(d.conflicts, [{ itemId: d.items[0].id, current: "Already confirmed" }]);
    // A removed item is not a conflict.
    const removed = await f.req("PUT", `${path}/items/${d.items[0].id}`, {
      expectedRevision: d.session.revision,
      state: "removed",
    });
    assert.deepEqual(removed.body.data.conflicts, []);
    // Hours conflict with the saved schedule of the agent's location.
    const h = await f.req("PUT", `${path}/answers/hours`, {
      expectedRevision: removed.body.data.session.revision,
      answer: { kind: "hours", timezone: "Asia/Kuala_Lumpur", weekdays: Array.from({ length: 7 }, () => [{ start: "08:00", end: "12:00" }]) },
    });
    assert.equal(h.body.data.conflicts.length, 1);
    assert.equal(h.body.data.conflicts[0].current.weekdays[0][0].start, "09:00");
  } finally {
    await f.close();
  }
});

test("the openapi file lists the four commands", () => {
  const spec = JSON.parse(readFileSync(new URL("../../packages/contracts/openapi.json", import.meta.url), "utf8"));
  const text = JSON.stringify(spec);
  for (const name of ["setup", "startSetup", "answerSetup", "saveSetupItem"])
    assert.ok(text.includes(`"${name}"`), name);
  assert.ok(spec.paths["/api/v1/agents/{id}/setup"]);
  assert.ok(spec.paths["/api/v1/agents/{id}/setup/answers/{questionId}"]);
  assert.ok(spec.paths["/api/v1/agents/{id}/setup/items/{itemId}"]);
});
