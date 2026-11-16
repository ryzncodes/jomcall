import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
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

// --- Reading limits (20261116140000_setup_read_limits.sql) -------------------

// A queued upload of `org` with its setup.read row in this test's namespace,
// written directly so the queue order is fixed by `ageSeconds`.
async function queuedUpload(h: H, org: { id: string; agentId: string }, userId: string, ageSeconds: number) {
  let session = (
    await h.cleanup.query("select id from app.setup_session where org_id=$1 and state='open'", [org.id])
  ).rows[0]?.id as string | undefined;
  session ??= (
    await h.cleanup.query(
      "insert into app.setup_session(org_id,agent_id,main_pack,created_by) values($1,$2,'clinic',$3) returning id",
      [org.id, org.agentId, userId],
    )
  ).rows[0].id as string;
  const upload = (
    await h.cleanup.query(
      "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes,state) values($1,$2,'text','harga.txt','text/plain',5,'queued') returning id",
      [org.id, session],
    )
  ).rows[0].id as string;
  await h.cleanup.query(
    "insert into app.outbox(org_id,namespace,kind,resource_id,created_at) values($1,$2,'setup.read',$3,now()-make_interval(secs=>$4))",
    [org.id, h.namespace, upload, ageSeconds],
  );
  return upload;
}
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> };
// A login role's own connection, as the processes use it.
async function asLogin<T>(url: "AGENT_DATABASE_URL" | "WORKER_DATABASE_URL" | "APP_DATABASE_URL", run: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: process.env[url] });
  await c.connect();
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}
// setup_read('claim'): as the agent login (committed), or on `c` inside the
// test's admin transaction (the function is security definer, so it behaves
// the same).
async function claimAs(h: H, c?: Q) {
  const run = async (q: Q) =>
    (await q.query("select app_private.setup_read('claim',$1) as value", [h.namespace])).rows[0].value as {
      upload: string;
      lease: string;
      attempt: number;
    } | null;
  return c ? run(c) : asLogin("AGENT_DATABASE_URL", run);
}
// One transaction on the shared app.setup_read_limit row, always rolled
// back, so other tests never see the changed ceiling.
async function rolledBack(h: H, run: (c: Q) => Promise<void>) {
  const c = await h.cleanup.connect();
  try {
    await c.query("begin isolation level repeatable read");
    await run(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}
const startedNow = async (c: Q) =>
  Number(
    (await c.query("select count(*)::int as n from app.setup_upload where first_claimed_at>now()-interval '24 hours'"))
      .rows[0].n,
  );

test("fair turn: the organization with fewer reads started in the last hour goes first", async () => {
  const h = await createHarness();
  try {
    // Fresh organizations: no reads started in the last hour for either.
    const a1 = await queuedUpload(h, h.orgA, h.alice.userId, 40);
    const a2 = await queuedUpload(h, h.orgA, h.alice.userId, 30);
    const a3 = await queuedUpload(h, h.orgA, h.alice.userId, 20);
    const b1 = await queuedUpload(h, h.orgB, h.bob.userId, 10);
    const order: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) order.push((await claimAs(h))?.upload);
    // A's oldest first (a tie at zero goes by age), then B's newer file
    // ahead of A's older ones, then A's in order; then nothing is left.
    assert.deepEqual(order, [a1, b1, a2, a3, undefined]);
    const rows = (
      await h.cleanup.query("select id,first_claimed_at,attempts from app.setup_upload where id=any($1)", [[a1, a2, a3, b1]])
    ).rows;
    for (const r of rows) {
      assert.ok(r.first_claimed_at instanceof Date, "first_claimed_at set on the first claim");
      assert.equal(r.attempts, 1);
    }
  } finally {
    await h.close();
  }
});

test("daily ceiling: at the ceiling nothing is claimed and the file stays queued; one more lets it through", async () => {
  const h = await createHarness();
  try {
    const id = await queuedUpload(h, h.orgA, h.alice.userId, 5);
    const ceiling = async () => (await h.cleanup.query("select daily_reads from app.setup_read_limit")).rows[0].daily_reads;
    const before = await ceiling();
    await rolledBack(h, async (c) => {
      const started = await startedNow(c);
      await c.query("update app.setup_read_limit set daily_reads=$1", [started]);
      assert.equal(await claimAs(h, c), null);
      const held = (await c.query("select state,attempts,lease_token,first_claimed_at from app.setup_upload where id=$1", [id])).rows[0];
      assert.deepEqual(held, { state: "queued", attempts: 0, lease_token: null, first_claimed_at: null });
      assert.equal(
        (await c.query("select delivered_at from app.outbox where resource_id=$1", [id])).rows[0].delivered_at,
        null,
      );
      await c.query("update app.setup_read_limit set daily_reads=$1", [started + 1]);
      assert.equal((await claimAs(h, c))?.upload, id);
      // Now at the ceiling again.
      assert.equal(await startedNow(c), started + 1);
    });
    assert.equal(await ceiling(), before, "rolled back");
    assert.equal((await h.cleanup.query("select state from app.setup_upload where id=$1", [id])).rows[0].state, "queued");
  } finally {
    await h.close();
  }
});

test("ceiling notice: once a Kuala Lumpur day while reached, null under it; the worker role only", async () => {
  const h = await createHarness();
  try {
    await queuedUpload(h, h.orgA, h.alice.userId, 5);
    await rolledBack(h, async (c) => {
      const notice = async () => (await c.query("select app_private.setup_read_ceiling_notice() as value")).rows[0].value;
      const day = (await c.query("select ((now() at time zone 'Asia/Kuala_Lumpur')::date)::text as d")).rows[0].d;
      const started = await startedNow(c);
      const waiting = Number((await c.query("select count(*)::int as n from app.setup_upload where state='queued'")).rows[0].n);
      await c.query("update app.setup_read_limit set daily_reads=$1, noticed_day=null", [started]);
      assert.deepEqual(await notice(), { day, started, ceiling: started, waiting });
      assert.ok(waiting >= 1);
      assert.equal(await notice(), null, "once a day");
      assert.equal((await c.query("select noticed_day::text as d from app.setup_read_limit")).rows[0].d, day);
      // Under the ceiling, with the day not yet noticed: still null.
      await c.query("update app.setup_read_limit set daily_reads=$1, noticed_day=null", [started + 1]);
      assert.equal(await notice(), null, "under the ceiling");
    });
    // Callable by the engine's worker login (rolled back: nothing marked),
    // refused to the web and agent logins.
    await asLogin("WORKER_DATABASE_URL", async (w) => {
      await w.query("begin");
      try {
        await w.query("select app_private.setup_read_ceiling_notice()");
      } finally {
        await w.query("rollback");
      }
    });
    for (const url of ["APP_DATABASE_URL", "AGENT_DATABASE_URL"] as const)
      await assert.rejects(
        asLogin(url, (x) => x.query("select app_private.setup_read_ceiling_notice()")),
        /permission denied/,
        url,
      );
  } finally {
    await h.close();
  }
});

test("stored-bytes notice: once a Kuala Lumpur day from 80 percent of the ceiling, null under it; the worker role only", async () => {
  const h = await createHarness();
  try {
    await queuedUpload(h, h.orgA, h.alice.userId, 5);
    await rolledBack(h, async (c) => {
      const notice = async () => (await c.query("select app_private.setup_bytes_notice() as value")).rows[0].value;
      const day = (await c.query("select ((now() at time zone 'Asia/Kuala_Lumpur')::date)::text as d")).rows[0].d;
      const stored = Number(
        (
          await c.query(
            "select coalesce(sum(bytes),0)::bigint as n from app.setup_upload where bytes_deleted_at is null and state<>'removed'",
          )
        ).rows[0].n,
      );
      assert.ok(stored >= 5);
      // Exactly 80 percent: noticed.
      const at80 = Math.floor((stored * 5) / 4);
      await c.query("update app.setup_read_limit set stored_bytes_max=$1, bytes_noticed_day=null", [at80]);
      assert.deepEqual(await notice(), { day, storedBytes: stored, maxBytes: at80 });
      assert.equal(await notice(), null, "once a day");
      assert.equal((await c.query("select bytes_noticed_day::text as d from app.setup_read_limit")).rows[0].d, day);
      // Just under 80 percent, with the day not yet noticed: null.
      await c.query("update app.setup_read_limit set stored_bytes_max=$1, bytes_noticed_day=null", [at80 + 1]);
      assert.equal(await notice(), null, "under 80 percent");
    });
    await asLogin("WORKER_DATABASE_URL", async (w) => {
      await w.query("begin");
      try {
        await w.query("select app_private.setup_bytes_notice()");
      } finally {
        await w.query("rollback");
      }
    });
    for (const url of ["APP_DATABASE_URL", "AGENT_DATABASE_URL"] as const)
      await assert.rejects(
        asLogin(url, (x) => x.query("select app_private.setup_bytes_notice()")),
        /permission denied/,
        url,
      );
  } finally {
    await h.close();
  }
});

test("the web, agent and worker roles cannot read or change app.setup_read_limit", async () => {
  const h = await createHarness();
  try {
    for (const role of ["jomcall_app", "jomcall_agent", "jomcall_worker"])
      for (const privilege of ["select", "insert", "update", "delete"])
        assert.equal(
          (
            await h.cleanup.query("select has_table_privilege($1,'app.setup_read_limit',$2) as ok", [role, privilege])
          ).rows[0].ok,
          false,
          `${role} ${privilege}`,
        );
    await asLogin("APP_DATABASE_URL", async (c) => {
      for (const sql of ["select * from app.setup_read_limit", "update app.setup_read_limit set daily_reads=100000"])
        await assert.rejects(c.query(sql), /permission denied/, sql);
    });
  } finally {
    await h.close();
  }
});
