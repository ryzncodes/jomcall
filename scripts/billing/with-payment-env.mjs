// Runs a command with the payment settings from the gitignored
// .env.payments added to its environment. Only the names below are read,
// so model and speech keys in other files never reach the web process.
// A variable already set in the environment wins.
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const names = new Set([
  "JOMCALL_PAYMENT_PROVIDER",
  "CURLEC_ENVIRONMENT",
  "CURLEC_KEY_ID",
  "CURLEC_KEY_SECRET",
  "CURLEC_WEBHOOK_SECRET",
  "JOMCALL_PUBLIC_ORIGIN",
]);
const env = { ...process.env };
if (existsSync(".env.payments"))
  for (const line of readFileSync(".env.payments", "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && names.has(m[1]) && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
const [command, ...args] = process.argv.slice(2);
if (!command) throw Error("USAGE: with-payment-env.mjs <command> [args]");
const child = spawn(command, args, { env, stdio: "inherit" });
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
