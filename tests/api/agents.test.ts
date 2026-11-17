import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { createPhase2Harness } from "../helpers/phase2.ts";
test("agent saves conflict, publishing deduplicates and history stays immutable", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const path = "/api/v1/agents/" + h.orgA.agentId;
    const initial = await api.request(
      h.alice,
      h.orgA.id,
      "GET",
      path + "/draft",
    );
    assert.equal(initial.status, 200);
    const settings = {
      ...initial.body.data.draft,
      aiDisclosure: "Saya pembantu AI.",
      greeting: "Hello from our sample studio",
    };
    const saved = await api.request(
      h.alice,
      h.orgA.id,
      "PUT",
      path + "/draft",
      { expectedRevision: 1, settings },
    );
    assert.equal(saved.status, 200);
    assert.equal(
      (
        await api.request(h.alice, h.orgA.id, "PUT", path + "/draft", {
          expectedRevision: 1,
          settings,
        })
      ).status,
      409,
    );
    const key = randomUUID();
    const publish = () =>
      api.request(
        h.alice,
        h.orgA.id,
        "POST",
        path + "/publish",
        { expectedRevision: 2 },
        { "idempotency-key": key },
      );
    const [a, b] = await Promise.all([publish(), publish()]);
    assert.equal(a.status, 200);
    assert.equal(b.body.data.id, a.body.data.id);
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query("update app.agent_version set snapshot=$1 where id=$2", [
          {},
          a.body.data.id,
        ]),
      ),
      /permission denied|immutable/i,
    );
    assert.equal(
      (await api.request(h.staff, h.orgA.id, "GET", path + "/draft")).status,
      403,
    );
    assert.equal(
      (await api.request(h.bob, h.orgB.id, "GET", path + "/draft")).status,
      404,
    );
    const restored = await api.request(
      h.alice,
      h.orgA.id,
      "POST",
      path + "/restore",
      { versionId: a.body.data.id, expectedRevision: 3 },
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.body.data.revision, 4);
    assert.equal(
      (await api.request(h.alice, h.orgA.id, "GET", path + "/versions")).body
        .data.items.length,
      1,
    );
  } finally {
    await api.close();
    await h.close();
  }
});

const publishSettings = {
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
async function agentFixture() {
  const f = await createPhase2Harness();
  const agentPath = `/agents/${f.h.orgA.agentId}`;
  const draft = await f.req("GET", agentPath + "/draft");
  const saved = await f.req("PUT", agentPath + "/draft", {
    expectedRevision: draft.body.data.revision,
    settings: publishSettings,
  });
  assert.equal(saved.status, 200);
  let revision: number = saved.body.data.revision;
  const publish = async () => {
    const r = await f.req("POST", agentPath + "/publish", { expectedRevision: revision });
    assert.equal(r.status, 200);
    return r.body.data;
  };
  const schedulePath = `/locations/${f.h.orgA.locationId}/schedule`;
  const saveSchedule = async (weekdays: unknown[], closures: unknown[]) => {
    const cur = (await f.req("GET", schedulePath)).body.data;
    const r = await f.req("PUT", schedulePath, {
      expectedRevision: cur.revision,
      timezone: "Asia/Kuala_Lumpur",
      weekdays,
      closures,
    });
    assert.equal(r.status, 200);
  };
  return { f, agentPath, publish, schedulePath, saveSchedule, rev: () => revision, setRev: (n: number) => (revision = n) };
}
const week = (start: string, end: string) =>
  Array.from({ length: 7 }, () => [{ start, end }]);

test("publish freezes every active branch's hours", async () => {
  const x = await agentFixture();
  const { f } = x;
  try {
    const second = await f.req("POST", "/locations", {
      name: "Cawangan Dua",
      address: "",
      state: "",
      timezone: "Asia/Kuala_Lumpur",
    });
    assert.equal(second.status, 200);
    const nextYear = `${new Date().getUTCFullYear() + 1}-06-15`;
    await x.saveSchedule(week("10:00", "17:00"), [
      { date: "2020-01-01", reason: "past" },
      { date: nextYear, reason: "Raya" },
    ]);
    const v1 = await x.publish();
    const hours = v1.snapshot.hours;
    assert.equal(hours.length, 2);
    assert.equal(hours[0].main, true);
    assert.equal(hours[0].locationId, f.h.orgA.locationId);
    assert.deepEqual(hours[0].weekdays[0], [{ start: "10:00", end: "17:00" }]);
    assert.deepEqual(hours[0].closures, [{ date: nextYear, reason: "Raya" }]);
    assert.equal(hours[1].main, false);
    assert.equal(hours[1].name, "Cawangan Dua");
    assert.equal(hours[1].weekdays, null);
    assert.deepEqual(hours[1].closures, []);
    // Archive the second branch: the next publish drops it.
    const archived = await f.req("POST", `/locations/${second.body.data.id}/archive`, {
      expectedRevision: second.body.data.revision,
    });
    assert.equal(archived.status, 200);
    const d = await f.req("GET", x.agentPath + "/draft");
    x.setRev(d.body.data.revision);
    const v2 = await x.publish();
    assert.equal(v2.snapshot.hours.length, 1);
  } finally {
    await f.close();
  }
});

test("restore does not change hours", async () => {
  const x = await agentFixture();
  const { f } = x;
  try {
    const v1 = await x.publish();
    await x.saveSchedule(week("08:00", "12:00"), []);
    const before = (await f.req("GET", x.schedulePath)).body.data;
    const d = await f.req("GET", x.agentPath + "/draft");
    const r = await f.req("POST", x.agentPath + "/restore", {
      versionId: v1.id,
      expectedRevision: d.body.data.revision,
    });
    assert.equal(r.status, 200);
    const after = (await f.req("GET", x.schedulePath)).body.data;
    assert.deepEqual(after.weekdays, before.weekdays);
    assert.deepEqual(after.closures, before.closures);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.weekdays[0], [{ start: "08:00", end: "12:00" }]);
  } finally {
    await f.close();
  }
});
