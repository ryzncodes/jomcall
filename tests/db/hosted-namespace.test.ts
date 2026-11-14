import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Applies the hosted-namespace migration inside a transaction on the local
// database and rolls it back, so the shared database is never left changed.
// `npm run db:verify-migrations` replays every file on a scratch database.
const MIGRATION = readFileSync(
  "supabase/migrations/20261114180000_hosted_namespaces.sql",
  "utf8",
);

async function inMigratedTransaction(
  run: (client: pg.PoolClient) => Promise<void>,
  migrate = true,
) {
  const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "54622")
    throw Error("LOCAL_ONLY");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const applied = (
      await client.query(
        "select count(*)::int as n from supabase_migrations.schema_migrations where version='20261114180000'",
      )
    ).rows[0].n;
    if (migrate && !applied) await client.query(MIGRATION);
    await run(client);
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }
}

async function codeOf(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<string> {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    return "OK";
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client.query("rollback to savepoint probe");
  }
}

const work = "select app_private.agent_work('maintain',$1)";
const voice =
  "select app_private.agent_voice('turn_start',$1,$2,repeat('a',64))";

test("staging and prod become legal namespaces; anything else is still refused", async () => {
  await inMigratedTransaction(async (client) => {
    for (const ns of ["local", "staging", "prod", `test_${randomUUID()}`]) {
      assert.equal(await codeOf(client, work, [ns]), "OK", ns);
      // A legal namespace reaches the token check, not the namespace check.
      assert.equal(
        await codeOf(client, voice, [ns, randomUUID()]),
        "VOICE_UNAUTHORIZED",
        ns,
      );
    }
    for (const ns of ["production", "Prod", "stage", "", "test_x", "local "]) {
      assert.equal(await codeOf(client, work, [ns]), "INVALID_NAMESPACE", ns);
      assert.equal(
        await codeOf(client, voice, [ns, randomUUID()]),
        "INVALID_NAMESPACE",
        ns,
      );
    }
    const privacy = (
      await client.query(
        "select pg_get_functiondef('app_private.request_privacy(uuid,uuid,integer,text,text)'::regprocedure) as body",
      )
    ).rows[0].body as string;
    assert.match(
      privacy,
      /\^\(local\|staging\|prod\|test_\[a-f0-9-\]\{36\}\)\$/,
    );
  });
});

test("the migration keeps grants and refuses to run against an unexpected body", async () => {
  await inMigratedTransaction(async (client) => {
    const grant = (
      await client.query(
        "select has_function_privilege('jomcall_agent','app_private.agent_work(text,text,uuid,uuid,uuid,jsonb)','execute') as agent, has_function_privilege('jomcall_app','app_private.request_privacy(uuid,uuid,integer,text,text)','execute') as app",
      )
    ).rows[0];
    assert.deepEqual(grant, { agent: true, app: true });
    // A second run finds no old check left and stops instead of guessing.
    assert.match(
      await codeOf(client, MIGRATION, []),
      /HOSTED_NAMESPACE_MIGRATION: .* has 0 copies/,
    );
  });
});
