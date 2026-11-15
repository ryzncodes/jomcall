import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";

type H = Awaited<ReturnType<typeof createHarness>>;
// An open session with one upload and one chunk, written as the owner.
async function seed(h: H) {
  return h.sqlAsApp(h.alice, h.orgA.id, async (tx) => {
    const session = (
      await tx.query(
        "insert into app.setup_session(org_id,agent_id,main_pack,created_by) values($1,$2,'clinic',$3) returning id",
        [h.orgA.id, h.orgA.agentId, h.alice.userId],
      )
    ).rows[0].id as string;
    const upload = (
      await tx.query(
        "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes) values($1,$2,'pdf','harga.pdf','application/pdf',5) returning id",
        [h.orgA.id, session],
      )
    ).rows[0].id as string;
    await tx.query(
      "insert into app.setup_upload_chunk(org_id,upload_id,seq,data) values($1,$2,0,$3)",
      [h.orgA.id, upload, Buffer.from("%PDF-")],
    );
    return { session, upload };
  });
}

test("staff read upload rows but never the bytes, and cannot write either", async () => {
  const h = await createHarness();
  try {
    const { session, upload } = await seed(h);
    await h.sqlAsApp(h.staff, h.orgA.id, async (tx) => {
      assert.equal((await tx.query("select 1 from app.setup_upload")).rowCount, 1);
      assert.equal(
        (await tx.query("select 1 from app.setup_upload_chunk")).rowCount,
        0,
      );
      assert.equal(
        (await tx.query("update app.setup_upload set state='removed'")).rowCount,
        0,
      );
      assert.equal((await tx.query("delete from app.setup_upload")).rowCount, 0);
      assert.equal(
        (await tx.query("delete from app.setup_upload_chunk")).rowCount,
        0,
      );
    });
    await assert.rejects(
      h.sqlAsApp(h.staff, h.orgA.id, (tx) =>
        tx.query(
          "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes) values($1,$2,'pdf','x.pdf','application/pdf',1)",
          [h.orgA.id, session],
        ),
      ),
      /row-level security/,
    );
    await assert.rejects(
      h.sqlAsApp(h.staff, h.orgA.id, (tx) =>
        tx.query(
          "insert into app.setup_upload_chunk(org_id,upload_id,seq,data) values($1,$2,1,'\\x00')",
          [h.orgA.id, upload],
        ),
      ),
      /row-level security/,
    );
  } finally {
    await h.close();
  }
});

test("another organization sees no uploads or bytes and cannot attach to them", async () => {
  const h = await createHarness();
  try {
    const { session, upload } = await seed(h);
    await h.sqlAsApp(h.bob, h.orgB.id, async (tx) => {
      assert.equal((await tx.query("select 1 from app.setup_upload")).rowCount, 0);
      assert.equal(
        (await tx.query("select 1 from app.setup_upload_chunk")).rowCount,
        0,
      );
    });
    await assert.rejects(
      h.sqlAsApp(h.bob, h.orgB.id, (tx) =>
        tx.query(
          "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes) values($1,$2,'pdf','x.pdf','application/pdf',1)",
          [h.orgB.id, session],
        ),
      ),
      /foreign key|violates/,
    );
    await assert.rejects(
      h.sqlAsApp(h.bob, h.orgB.id, (tx) =>
        tx.query(
          "insert into app.setup_upload_chunk(org_id,upload_id,seq,data) values($1,$2,1,'\\x00')",
          [h.orgB.id, upload],
        ),
      ),
      /foreign key|violates/,
    );
  } finally {
    await h.close();
  }
});

test("the agent and worker roles have no grant on the upload tables", async () => {
  const h = await createHarness();
  try {
    for (const role of ["jomcall_agent", "jomcall_worker"])
      for (const table of ["app.setup_upload", "app.setup_upload_chunk"])
        for (const privilege of ["select", "insert", "update", "delete"])
          assert.equal(
            (
              await h.cleanup.query(
                "select has_table_privilege($1,$2,$3) as ok",
                [role, table, privilege],
              )
            ).rows[0].ok,
            false,
            `${role} ${privilege} ${table}`,
          );
  } finally {
    await h.close();
  }
});

test("an upload over 10 MiB or a chunk over 3 MiB is refused by the table", async () => {
  const h = await createHarness();
  try {
    const { session, upload } = await seed(h);
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query(
          "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes) values($1,$2,'pdf','x.pdf','application/pdf',10485761)",
          [h.orgA.id, session],
        ),
      ),
      /check constraint/,
    );
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query(
          "insert into app.setup_upload_chunk(org_id,upload_id,seq,data) values($1,$2,1,$3)",
          [h.orgA.id, upload, Buffer.alloc(3145729)],
        ),
      ),
      /check constraint/,
    );
    // Deleting the session removes its uploads and their bytes.
    await h.cleanup.query("delete from app.setup_session where id=$1", [session]);
    for (const t of ["setup_upload", "setup_upload_chunk"])
      assert.equal(
        (await h.cleanup.query(`select 1 from app.${t} where org_id=$1`, [h.orgA.id]))
          .rowCount,
        0,
      );
  } finally {
    await h.close();
  }
});
