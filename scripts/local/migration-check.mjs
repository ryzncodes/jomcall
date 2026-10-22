import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { checkBindings } from "./check.mjs";
checkBindings();
const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "54622")
  throw Error("LOCAL_ONLY");
const name = "jomcall_migration_test_" + randomBytes(6).toString("hex");
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
function command(args, input) {
  return execFileSync(
    "docker",
    ["exec", "-i", "-e", "PGPASSWORD", "supabase_db_jomcall-local", ...args],
    { input, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}
function sql(db, input) {
  return command(
    ["psql", "-U", "supabase_admin", "-d", db, "-v", "ON_ERROR_STOP=1", "-q"],
    input,
  );
}
try {
  sql("postgres", `create database ${name};`);
  const baseline = command([
    "pg_dump",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "--schema-only",
    "--schema=auth",
    "--no-owner",
    "--no-privileges",
  ]);
  sql(
    name,
    'create schema extensions; create extension if not exists "uuid-ossp" with schema extensions; create extension if not exists pgcrypto with schema extensions;',
  );
  sql(name, baseline);
  for (const file of readdirSync("supabase/migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort())
    sql(name, readFileSync("supabase/migrations/" + file, "utf8"));
  sql(name, readFileSync("supabase/auth-grants.sql", "utf8"));
  const check = command([
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    name,
    "-At",
    "-c",
    "select count(*) from pg_tables where schemaname='app' and rowsecurity",
  ]);
  console.log("Scratch migration replay passed; RLS tables:", check.trim());
} catch (e) {
  console.error(
    e.stderr?.toString().replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") ??
      e.message,
  );
  process.exitCode = 1;
} finally {
  sql("postgres", `drop database if exists ${name};`);
}
