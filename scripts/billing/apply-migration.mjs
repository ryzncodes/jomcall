// Applies one migration file to the local database and records it, for a
// worktree whose migration list differs from what `supabase db push` expects
// (another branch has already applied a migration this branch does not have).
// Local database only. Does nothing if the version is already recorded.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import pg from "pg";
const file = process.argv[2];
const match = /^(\d{14})_(.+)\.sql$/.exec(basename(file ?? ""));
if (!match) throw Error("USAGE: apply-migration.mjs supabase/migrations/<version>_<name>.sql");
const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "54622") throw Error("LOCAL_DATABASE_REQUIRED");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  const done = await client.query("select 1 from supabase_migrations.schema_migrations where version=$1", [match[1]]);
  if (done.rowCount) console.log("Already applied:", match[1]);
  else {
    const sql = readFileSync(file, "utf8");
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)", [match[1], match[2], [sql]]);
    await client.query("commit");
    console.log("Applied:", match[1], match[2]);
  }
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]"));
  process.exitCode = 1;
} finally {
  await client.end();
}
