// Writes the LiveKit SIP inbound trunk and dispatch rule for every active
// JomCall phone number into output/telephony/ (git-ignored), for an operator
// to apply with `lk`. It never contacts LiveKit or a provider.
//
//   npm run telephony:sip-config -- --allowed 203.0.113.10,203.0.113.11
//   npm run telephony:sip-config -- --username jomcall-trunk --trunk ST_xxx
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { livekitSipConfig } from "../../packages/domain/src/phone/sip-config.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "54622") throw Error("LOCAL_DATABASE_REQUIRED");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const numbers = (
  await client.query("select e164 from app.phone_number where active order by e164")
).rows.map((r) => r.e164 as string);
await client.end();
const config = livekitSipConfig({
  numbers,
  allowedAddresses: flag("allowed")?.split(",").filter(Boolean),
  authUsername: flag("username"),
  trunkId: flag("trunk"),
  krisp: args.includes("--krisp"),
});
mkdirSync("output/telephony", { recursive: true });
writeFileSync("output/telephony/inbound-trunk.json", JSON.stringify(config.inboundTrunk, null, 2) + "\n");
writeFileSync("output/telephony/dispatch-rule.json", JSON.stringify(config.dispatchRule, null, 2) + "\n");
console.log(`Wrote output/telephony/ for ${numbers.length} number(s). Apply in that folder:`);
for (const c of config.commands) console.log("  " + c);
