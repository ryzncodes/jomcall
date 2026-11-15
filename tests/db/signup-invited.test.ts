import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Applies the sign-up invitation migration inside a transaction on the local
// database (if it is not applied yet) and rolls everything back.
const MIGRATION = readFileSync(
  "supabase/migrations/20261115120000_signup_invited.sql",
  "utf8",
);

async function inTransaction(run: (client: pg.PoolClient) => Promise<void>) {
  const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "54622")
    throw Error("LOCAL_ONLY");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const applied = (
      await client.query(
        "select count(*)::int as n from supabase_migrations.schema_migrations where version='20261115120000'",
      )
    ).rows[0].n;
    if (!applied) await client.query(MIGRATION);
    await run(client);
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }
}

test("only a pending, unexpired invitation lets an address sign up", async () => {
  await inTransaction(async (client) => {
    const org = (
      await client.query(
        "insert into app.organization(name,business_type) values('Fake Kedai','other') returning id",
      )
    ).rows[0].id;
    const invite = (email: string, state: string, expires: string) =>
      client.query(
        "insert into app.invitation(org_id,email,role,invited_by,token_hash,state,expires_at) values($1,$2,'staff',$3,$4,$5,now()+$6::interval)",
        [org, email, randomUUID(), randomUUID(), state, expires],
      );
    await invite("pending@example.test", "pending", "1 day");
    await invite("expired@example.test", "pending", "-1 day");
    await invite("revoked@example.test", "revoked", "1 day");
    await invite("accepted@example.test", "accepted", "1 day");
    const invited = async (email: string | null) =>
      (await client.query("select app_private.signup_invited($1) as v", [email]))
        .rows[0].v;
    assert.equal(await invited("pending@example.test"), true);
    assert.equal(await invited(" Pending@Example.TEST "), true);
    for (const email of [
      "expired@example.test",
      "revoked@example.test",
      "accepted@example.test",
      "stranger@example.test",
      null,
    ])
      assert.equal(await invited(email), false, String(email));
    // Only the web login may ask; nobody else holds execute.
    const grants = (
      await client.query(
        "select has_function_privilege('jomcall_app','app_private.signup_invited(text)','execute') as app, has_function_privilege('anon','app_private.signup_invited(text)','execute') as anon, has_function_privilege('authenticated','app_private.signup_invited(text)','execute') as authed",
      )
    ).rows[0];
    assert.deepEqual(grants, { app: true, anon: false, authed: false });
    // The owner must bypass the forced row-level security on app.invitation.
    const owner = (
      await client.query(
        "select r.rolsuper or r.rolbypassrls as bypass from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='app_private.signup_invited(text)'::regprocedure",
      )
    ).rows[0].bypass;
    assert.equal(owner, true);
  });
});
