// Hosted database release job. Owner only; no service holds these settings.
//
//   npm run hosted:migrate -- --target staging --env-file /secure/release-staging.env
//
// Refuses to run without --target, when --target differs from HOSTED_TARGET in
// the env file, when any release setting is missing or wrong, against a
// loopback or unlisted host, without TLS, or without a typed confirmation at a
// terminal. Prints names, codes and the database host only; never a URL,
// password or key.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import pg from "pg";
import {
  databaseConnection,
  type Env,
} from "../../packages/contracts/src/hosting.ts";
import { readiness } from "../../packages/contracts/src/hosted-env.ts";

export const TARGETS = ["staging", "prod"] as const;
export const ROLES: [string, string][] = [
  ["jomcall_app", "HOSTED_APP_PASSWORD"],
  ["jomcall_worker", "HOSTED_WORKER_PASSWORD"],
  ["jomcall_queue", "HOSTED_QUEUE_PASSWORD"],
  ["jomcall_agent", "HOSTED_AGENT_PASSWORD"],
];

export type Plan = {
  target: (typeof TARGETS)[number];
  host: string;
  phrase: string;
  connection: ReturnType<typeof databaseConnection>;
};

export function planRelease(args: string[], env: Env): Plan {
  const i = args.indexOf("--target");
  const target = i >= 0 ? args[i + 1] : undefined;
  if (!target || !(TARGETS as readonly string[]).includes(target))
    throw Error("TARGET_REQUIRED: --target staging|prod");
  if (env.HOSTED_TARGET !== target)
    throw Error("TARGET_MISMATCH: HOSTED_TARGET");
  const findings = readiness("release", env);
  if (findings.length)
    throw Error(
      "RELEASE_NOT_READY: " +
        findings.map((f) => `${f.name}=${f.code}`).join(", "),
    );
  const connection = databaseConnection(
    env.HOSTED_ADMIN_DATABASE_URL,
    "HOSTED_ADMIN_DATABASE_URL",
    { ...env, JOMCALL_MODE: "hosted" },
  );
  const host = new URL(connection.connectionString).hostname;
  return {
    target: target as Plan["target"],
    host,
    phrase: `${target} ${host}`,
    connection,
  };
}

export const confirmed = (typed: string, plan: Plan) =>
  typed.trim() === plan.phrase;

const redact = (text: string) =>
  text.replace(/postgres(?:ql)?:\/\/\S+/g, "[database URL redacted]");

async function main() {
  const args = process.argv.slice(2);
  const f = args.indexOf("--env-file");
  const env: Env =
    f >= 0 ? parseEnv(readFileSync(args[f + 1], "utf8")) : process.env;
  const plan = planRelease(args, env);
  if (!process.stdin.isTTY) throw Error("CONFIRMATION_NEEDS_TERMINAL");
  console.log(`About to migrate the ${plan.target} database at ${plan.host}.`);
  console.log(`Type exactly "${plan.phrase}" to continue:`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question("> ");
  rl.close();
  if (!confirmed(typed, plan)) throw Error("CONFIRMATION_MISMATCH");

  // 1. Schema: the Supabase CLI applies supabase/migrations and records them.
  const pushUrl = new URL(plan.connection.connectionString);
  pushUrl.searchParams.set("sslmode", "require");
  try {
    const out = execFileSync(
      "supabase",
      ["db", "push", "--db-url", pushUrl.toString(), "--yes"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(redact(out));
  } catch (e) {
    console.error(redact(String((e as { stderr?: unknown }).stderr ?? "")));
    throw Error("MIGRATION_PUSH_FAILED");
  }

  const client = new pg.Client(plan.connection);
  await client.connect();
  try {
    // 2. Auth-schema grants. Locally these run as supabase_admin; hosted
    // Supabase gives no such login. UNVERIFIED whether `postgres` may grant
    // them (design 5.4). On a permission error, stop: RUNBOOK.md step 2b.
    try {
      await client.query("begin");
      await client.query(readFileSync("supabase/auth-grants.sql", "utf8"));
      await client.query("commit");
      console.log("Auth-schema grants applied.");
    } catch (e) {
      await client.query("rollback");
      if ((e as { code?: string }).code === "42501")
        throw Error("AUTH_GRANTS_OWNER_STEP: see RUNBOOK.md step 2b");
      throw Error("AUTH_GRANTS_FAILED");
    }
    // 3. Login passwords for the four service roles, generated per environment.
    for (const [role, name] of ROLES) {
      const sql = (
        await client.query(
          "select format('alter role %I password %L',$1::text,$2::text) as sql",
          [role, env[name]],
        )
      ).rows[0].sql as string;
      await client.query(sql);
    }
    console.log("Service role passwords set.");
    // 4. Verification: every repository migration is recorded; roles exist.
    const files = readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql"))
      .map((x) => x.split("_")[0])
      .sort();
    const applied = (
      await client.query(
        "select version from supabase_migrations.schema_migrations order by 1",
      )
    ).rows.map((r) => r.version as string);
    const missing = files.filter((v) => !applied.includes(v));
    if (missing.length)
      throw Error("MIGRATIONS_NOT_RECORDED: " + missing.join(","));
    const roles = (
      await client.query(
        "select count(*)::int as n from pg_roles where rolname like 'jomcall\\_%'",
      )
    ).rows[0].n as number;
    if (roles < 10) throw Error(`ROLES_INCOMPLETE: ${roles} of 10`);
    console.log(
      `Verified: ${files.length} migrations recorded, ${roles} jomcall roles present.`,
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    const message = e instanceof Error ? e.message : "";
    console.error(/^[A-Z_]+(:|$)/.test(message) ? message : "RELEASE_FAILED");
    process.exitCode = 1;
  });
