// Usage: npm run hosted:readiness -- --service agent [--env-file /etc/jomcall/agent.env]
// Without --env-file it checks this process's environment (run it inside the
// container). Prints names and codes only; never a value. Exit 1 if not ready.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  readiness,
  SERVICES,
  type Service,
} from "../../packages/contracts/src/hosted-env.ts";

const args = process.argv.slice(2);
const option = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const service = option("--service") as Service | undefined;
if (!service || !SERVICES.includes(service)) {
  console.error(
    `READINESS_USAGE: --service ${SERVICES.join("|")} [--env-file path]`,
  );
  process.exit(2);
}
const file = option("--env-file");
let env: Record<string, string | undefined>;
try {
  env = file ? parseEnv(readFileSync(file, "utf8")) : process.env;
} catch {
  console.error("READINESS_ENV_FILE_UNREADABLE");
  process.exit(2);
}
const findings = readiness(service, env);
if (!findings.length) {
  console.log(`${service}: ready`);
} else {
  console.log(`${service}: not ready`);
  for (const f of findings) console.log(`  ${f.name}: ${f.code}`);
  process.exitCode = 1;
}
