import { test } from "node:test";
import assert from "node:assert/strict";
import { createPhase2Harness } from "../helpers/phase2.ts";

const settings = {
  name: "Kedai Contoh",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "Hai, Kedai Contoh.",
  instructions: "",
  aiDisclosure: "Saya pembantu AI.",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "",
};
const week = (start: string, end: string) =>
  Array.from({ length: 7 }, () => [{ start, end }]);

async function fixture() {
  const f = await createPhase2Harness();
  const agentPath = `/agents/${f.h.orgA.agentId}`;
  const schedulePath = `/locations/${f.h.orgA.locationId}/schedule`;
  const rev = async (): Promise<number> =>
    (await f.req("GET", agentPath + "/draft")).body.data.revision;
  const saveDraft = async (patch: Record<string, unknown> = {}) => {
    const r = await f.req("PUT", agentPath + "/draft", {
      expectedRevision: await rev(),
      settings: { ...settings, ...patch },
    });
    assert.equal(r.status, 200);
  };
  const changes = async () => {
    const r = await f.req("GET", agentPath + "/changes");
    assert.equal(r.status, 200);
    return r.body.data as {
      count: number;
      token: string;
      published: boolean;
      changes: { kind: string; op: string; label: string; count?: number }[];
    };
  };
  const publish = async (changeToken?: string) =>
    f.req("POST", agentPath + "/publish", {
      expectedRevision: await rev(),
      ...(changeToken ? { changeToken } : {}),
    });
  const saveSchedule = async (weekdays: unknown[]) => {
    const cur = (await f.req("GET", schedulePath)).body.data;
    const r = await f.req("PUT", schedulePath, {
      expectedRevision: cur.revision,
      timezone: "Asia/Kuala_Lumpur",
      weekdays,
      closures: [],
    });
    assert.equal(r.status, 200);
  };
  const addRows = (rows: { item: string; price: number }[]) =>
    f.h.cleanup.query(
      `insert into app.catalogue_row(org_id,agent_id,item,search_text,price_sen)
       select $1,$2,x.item,x.item,x.price from jsonb_to_recordset($3::jsonb) as x(item text,price int)`,
      [f.h.orgA.id, f.h.orgA.agentId, JSON.stringify(rows)],
    );
  return { f, agentPath, saveDraft, changes, publish, saveSchedule, addRows, rev };
}
const counts = async (x: Awaited<ReturnType<typeof fixture>>) =>
  (
    await x.f.h.cleanup.query(
      "select (select count(*) from app.catalogue_set)::int a,(select count(*) from app.knowledge_unit)::int b",
    )
  ).rows[0];

test("no published version: everything is new, published false", async () => {
  const x = await fixture();
  try {
    await x.saveDraft();
    const c = await x.changes();
    assert.equal(c.published, false);
    assert.ok(c.count > 0);
    assert.ok(c.changes.some((l) => l.kind === "setting" && l.op === "added" && l.label === "greeting"));
    assert.ok(c.changes.some((l) => l.kind === "hours" && l.op === "added"));
    assert.match(c.token, /^[a-f0-9]{64}$/);
  } finally {
    await x.f.close();
  }
});

test("after publish the count is 0; each kind of edit adds one line", async () => {
  const x = await fixture();
  try {
    await x.saveDraft();
    assert.equal((await x.publish()).status, 200);
    const base = await x.changes();
    assert.equal(base.count, 0);
    assert.equal(base.published, true);
    await x.saveDraft({ greeting: "Selamat datang." });
    assert.deepEqual((await x.changes()).changes, [{ kind: "setting", op: "changed", label: "greeting" }]);
    const rev = await x.rev();
    const fact = await x.f.req("POST", x.agentPath + "/facts", {
      expectedAgentRevision: rev,
      title: "Parking",
      value: "Free.",
    });
    assert.equal(fact.status, 200);
    await x.addRows([{ item: "Teh tarik", price: 350 }]);
    await x.saveSchedule(week("08:00", "12:00"));
    const c = await x.changes();
    assert.deepEqual(
      c.changes.map((l) => `${l.kind}:${l.op}:${l.label}`).sort(),
      [
        "fact:added:Parking",
        "hours:changed:" + (await x.f.h.cleanup.query("select name from app.location where id=$1", [x.f.h.orgA.locationId])).rows[0].name,
        "price:added:Teh tarik",
        "setting:changed:greeting",
      ].sort(),
    );
    assert.equal(c.count, 4);
  } finally {
    await x.f.close();
  }
});

test("price list: one edited row is one line by item; duplicates collapse to a count", async () => {
  const x = await fixture();
  try {
    await x.saveDraft();
    await x.addRows([
      { item: "Teh", price: 300 },
      { item: "Kopi", price: 400 },
    ]);
    assert.equal((await x.publish()).status, 200);
    assert.equal((await x.changes()).count, 0);
    await x.f.h.cleanup.query("update app.catalogue_row set price_sen=450 where agent_id=$1 and item='Kopi'", [x.f.h.orgA.agentId]);
    assert.deepEqual((await x.changes()).changes, [{ kind: "price", op: "changed", label: "Kopi" }]);
    await x.addRows([{ item: "Teh", price: 320 }]);
    const c = await x.changes();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].kind, "price");
    assert.equal(c.changes[0].label, "");
    assert.ok((c.changes[0].count ?? 0) >= 2);
    assert.equal(c.count, c.changes[0].count);
  } finally {
    await x.f.close();
  }
});

test("the read writes nothing", async () => {
  const x = await fixture();
  try {
    await x.saveDraft();
    await x.addRows([{ item: "Teh", price: 300 }]);
    await x.f.req("POST", x.agentPath + "/facts", { expectedAgentRevision: await x.rev(), title: "Wifi", value: "Open." });
    const before = await counts(x);
    await x.changes();
    await x.changes();
    assert.deepEqual(await counts(x), before);
  } finally {
    await x.f.close();
  }
});

test("publish with a stale token is refused; a fresh token and no token both work", async () => {
  const x = await fixture();
  try {
    await x.saveDraft();
    const stale = (await x.changes()).token;
    await x.saveSchedule(week("07:00", "11:00"));
    const versions = async () =>
      Number((await x.f.h.cleanup.query("select count(*) from app.agent_version where agent_id=$1", [x.f.h.orgA.agentId])).rows[0].count);
    const refused = await x.publish(stale);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error?.code ?? refused.body.code, "CHANGES_MOVED");
    assert.equal(await versions(), 0);
    const fresh = (await x.changes()).token;
    assert.notEqual(fresh, stale);
    assert.equal((await x.publish(fresh)).status, 200);
    assert.equal(await versions(), 1);
    await x.saveDraft({ greeting: "Hai lagi." });
    assert.equal((await x.publish()).status, 200);
  } finally {
    await x.f.close();
  }
});

test("staff are refused and other tenants see 404", async () => {
  const x = await fixture();
  try {
    const path = "/api/v1" + x.agentPath + "/changes";
    assert.equal((await x.f.api.request(x.f.h.staff, x.f.h.orgA.id, "GET", path)).status, 403);
    assert.equal((await x.f.api.request(x.f.h.bob, x.f.h.orgB.id, "GET", path)).status, 404);
  } finally {
    await x.f.close();
  }
});

test("10,000 confirmed price rows: an unchanged list answers fast", async () => {
  const x = await fixture();
  try {
    await x.saveDraft();
    await x.f.h.cleanup.query(
      `insert into app.catalogue_row(org_id,agent_id,item,search_text,price_sen)
       select $1,$2,'Item '||g,'Item '||g,g from generate_series(1,10000) g`,
      [x.f.h.orgA.id, x.f.h.orgA.agentId],
    );
    assert.equal((await x.publish()).status, 200);
    const t = Date.now();
    const c = await x.changes();
    assert.equal(c.count, 0);
    assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  } finally {
    await x.f.close();
  }
});
