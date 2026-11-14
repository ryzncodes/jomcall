import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";

async function openSession(h: Awaited<ReturnType<typeof createHarness>>) {
  return h.sqlAsApp(h.alice, h.orgA.id, async (tx) =>
    (
      await tx.query(
        "insert into app.setup_session(org_id,agent_id,main_pack,created_by) values($1,$2,'clinic',$3) returning id",
        [h.orgA.id, h.orgA.agentId, h.alice.userId],
      )
    ).rows[0].id as string,
  );
}
const addItem = (
  tx: { query: (q: string, v: unknown[]) => Promise<unknown> },
  orgId: string,
  sessionId: string,
  key: string,
  payload: unknown = { a: 1 },
) =>
  tx.query(
    "insert into app.setup_item(org_id,session_id,kind,key,payload,source) values($1,$2,'fact',$3,$4,'interview')",
    [orgId, sessionId, key, JSON.stringify(payload)],
  );

test("an owner creates an open setup session and items", async () => {
  const h = await createHarness();
  try {
    const id = await openSession(h);
    await h.sqlAsApp(h.alice, h.orgA.id, async (tx) => {
      await addItem(tx, h.orgA.id, id, "hours");
      const s = (
        await tx.query("select state,revision,extra_packs from app.setup_session where id=$1", [id])
      ).rows[0];
      assert.deepEqual(s, { state: "open", revision: 1, extra_packs: [] });
      const i = (await tx.query("select state,needs_check from app.setup_item where session_id=$1", [id])).rows;
      assert.deepEqual(i, [{ state: "pending", needs_check: false }]);
    });
  } finally {
    await h.close();
  }
});

test("a second open session for the same agent is refused", async () => {
  const h = await createHarness();
  try {
    await openSession(h);
    await assert.rejects(openSession(h), /duplicate key|unique/);
  } finally {
    await h.close();
  }
});

test("staff can read but not write setup rows", async () => {
  const h = await createHarness();
  try {
    const id = await openSession(h);
    await h.sqlAsApp(h.alice, h.orgA.id, (tx) => addItem(tx, h.orgA.id, id, "hours"));
    await h.sqlAsApp(h.staff, h.orgA.id, async (tx) => {
      assert.equal((await tx.query("select 1 from app.setup_session")).rowCount, 1);
      assert.equal((await tx.query("select 1 from app.setup_item")).rowCount, 1);
    });
    await assert.rejects(
      h.sqlAsApp(h.staff, h.orgA.id, (tx) => addItem(tx, h.orgA.id, id, "x")),
      /row-level security/,
    );
    await assert.rejects(
      h.sqlAsApp(h.staff, h.orgA.id, (tx) =>
        tx.query(
          "insert into app.setup_session(org_id,agent_id,main_pack,state) values($1,$2,'clinic','applied')",
          [h.orgA.id, h.orgA.agentId],
        ),
      ),
      /row-level security/,
    );
    await h.sqlAsApp(h.staff, h.orgA.id, async (tx) => {
      assert.equal((await tx.query("update app.setup_item set state='confirmed'")).rowCount, 0);
      assert.equal((await tx.query("delete from app.setup_item")).rowCount, 0);
      assert.equal((await tx.query("delete from app.setup_session")).rowCount, 0);
    });
  } finally {
    await h.close();
  }
});

test("another organization sees no setup rows", async () => {
  const h = await createHarness();
  try {
    const id = await openSession(h);
    await h.sqlAsApp(h.alice, h.orgA.id, (tx) => addItem(tx, h.orgA.id, id, "hours"));
    await h.sqlAsApp(h.bob, h.orgB.id, async (tx) => {
      assert.equal((await tx.query("select 1 from app.setup_session")).rowCount, 0);
      assert.equal((await tx.query("select 1 from app.setup_item")).rowCount, 0);
    });
    await assert.rejects(
      h.sqlAsApp(h.bob, h.orgB.id, (tx) => addItem(tx, h.orgA.id, id, "x")),
      /row-level security/,
    );
    await assert.rejects(
      h.sqlAsApp(h.bob, h.orgB.id, (tx) => addItem(tx, h.orgB.id, id, "x")),
      /foreign key|violates/,
    );
  } finally {
    await h.close();
  }
});

test("an item payload above 8000 bytes is refused", async () => {
  const h = await createHarness();
  try {
    const id = await openSession(h);
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        addItem(tx, h.orgA.id, id, "big", { t: "x".repeat(8100) }),
      ),
      /check constraint/,
    );
  } finally {
    await h.close();
  }
});

test("deleting the agent removes its setup rows", async () => {
  const h = await createHarness();
  try {
    const id = await openSession(h);
    await h.sqlAsApp(h.alice, h.orgA.id, (tx) => addItem(tx, h.orgA.id, id, "hours"));
    await h.cleanup.query("delete from app.agent where id=$1", [h.orgA.agentId]);
    for (const t of ["setup_session", "setup_item"])
      assert.equal(
        (await h.cleanup.query(`select 1 from app.${t} where org_id=$1`, [h.orgA.id])).rowCount,
        0,
      );
  } finally {
    await h.close();
  }
});
