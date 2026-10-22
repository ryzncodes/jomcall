import { readFileSync } from "node:fs";
import { run, checkBindings } from "./check.mjs";
import pg from "pg";
import { execFileSync } from "node:child_process";
checkBindings();
const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "54622")
  throw Error("LOCAL_DATABASE_REQUIRED");
// CLI-generated migrations are the only schema source; never defaults to --linked.
try {
  run("supabase", ["db", "push", "--local", "--yes"]);
} catch (e) {
  console.error(
    e.stderr
      ?.toString()
      .replace(/postgres(?:ql)?:\/\/\S+/g, "[database URL redacted]"),
  );
  process.exit(1);
}
execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "-e",
    "PGPASSWORD",
    "supabase_db_jomcall-local",
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "-",
  ],
  {
    encoding: "utf8",
    input: readFileSync("supabase/auth-grants.sql", "utf8"),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  },
);
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
for (const [role, key] of [
  ["jomcall_app", "LOCAL_APP_PASSWORD"],
  ["jomcall_worker", "LOCAL_WORKER_PASSWORD"],
  ["jomcall_queue", "LOCAL_QUEUE_PASSWORD"],
  ["jomcall_agent", "LOCAL_AGENT_PASSWORD"],
]) {
  const password = process.env[key];
  if (!/^[a-f0-9]{64}$/.test(password ?? ""))
    throw Error("INVALID_LOCAL_SECRET");
  await client.query(`alter role ${role} password '${password}'`);
}
await client.end();
console.log("Local migrations and constrained role credentials applied.");
