// Operator actions on a wallet. Local database only; each needs a reason
// and the operator's name, and leaves an audit record.
//   npm run billing:admin -- adjust <org id> <sen, may be negative> "<reason>" "<operator>"
//   npm run billing:admin -- refund <org id> <top-up id> <sen> "<reason>" "<operator>"
// A refund only records that money went back; return it at the provider
// first (Billplz: Payment Order; see docs/research/payment-providers-malaysia.md).
import pg from "pg";
import { randomUUID } from "node:crypto";

const [action, ...args] = process.argv.slice(2);
const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "54622") throw Error("LOCAL_DATABASE_REQUIRED");
const uuid = /^[0-9a-f-]{36}$/;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  let result;
  if (action === "adjust" && args.length === 4 && uuid.test(args[0]) && /^-?\d+$/.test(args[1]))
    result = (await db.query("select app_private.admin_adjust($1,$2,$3,$4,$5) v", [args[0], Number(args[1]), args[2], args[3], "cli-" + randomUUID()])).rows[0].v;
  else if (action === "refund" && args.length === 5 && uuid.test(args[0]) && uuid.test(args[1]) && /^\d+$/.test(args[2]))
    result = (await db.query("select app_private.admin_refund($1,$2,$3,$4,$5,$6) v", [args[0], args[1], Number(args[2]), args[3], args[4], "cli-" + randomUUID()])).rows[0].v;
  else {
    console.error('Usage: adjust <org> <sen> "<reason>" "<operator>" | refund <org> <top-up> <sen> "<reason>" "<operator>"');
    process.exitCode = 2;
  }
  if (result) console.log(JSON.stringify({ balanceSen: result.balanceSen, state: result.state, duplicate: result.duplicate }));
} catch (e) {
  console.error(e instanceof Error ? e.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") : "ERROR");
  process.exitCode = 1;
} finally {
  await db.end();
}
