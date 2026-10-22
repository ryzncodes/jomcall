import { writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { run } from "./check.mjs";
export function writeEnvironment() {
  const status = JSON.parse(run("supabase", ["status", "-o", "json"]));
  const prior = existsSync(".env.local")
    ? Object.fromEntries(
        readFileSync(".env.local", "utf8")
          .trim()
          .split("\n")
          .map((x) => {
            const i = x.indexOf("=");
            return [x.slice(0, i), x.slice(i + 1)];
          }),
      )
    : {};
  const secret = (name) => prior[name] || randomBytes(32).toString("hex");
  const dbPassword = secret("LOCAL_APP_PASSWORD"),
    workerPassword = secret("LOCAL_WORKER_PASSWORD"),
    queuePassword = secret("LOCAL_QUEUE_PASSWORD"),
    agentPassword = secret("LOCAL_AGENT_PASSWORD");
  const shared = {
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    APP_DATABASE_URL: `postgresql://jomcall_app:${dbPassword}@127.0.0.1:54622/postgres`,
    LOCAL_ORIGIN: "http://127.0.0.1:4182",
    INVITATION_KEY: secret("INVITATION_KEY"),
    CSRF_SECRET: secret("CSRF_SECRET"),
    JOMCALL_QUEUE_NAMESPACE: "local",
    JOMCALL_MODEL_PROVIDER: prior.JOMCALL_MODEL_PROVIDER ?? "disabled",
  };
  const root = {
    ...shared,
    LOCAL_ADMIN_DATABASE_URL: status.DB_URL,
    SUPABASE_SERVICE_KEY: status.SERVICE_ROLE_KEY,
    LOCAL_APP_PASSWORD: dbPassword,
    LOCAL_WORKER_PASSWORD: workerPassword,
    LOCAL_QUEUE_PASSWORD: queuePassword,
    LOCAL_AGENT_PASSWORD: agentPassword,
    AGENT_DATABASE_URL: `postgresql://jomcall_agent:${agentPassword}@127.0.0.1:54622/postgres`,
    WORKER_DATABASE_URL: `postgresql://jomcall_worker:${workerPassword}@127.0.0.1:54622/postgres`,
    QUEUE_DATABASE_URL: `postgresql://jomcall_queue:${queuePassword}@127.0.0.1:54622/postgres`,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "54625",
  };
  for (const [path, values] of [
    [".env.local", root],
    ["web/.env.local", shared],
  ]) {
    writeFileSync(
      path,
      Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    chmodSync(path, 0o600);
  }
  console.log("Local environment written (secrets redacted).");
}
