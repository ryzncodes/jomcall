// Posts a fake, signed provider callback to the local web app, as Billplz
// would. Local mode with JOMCALL_PAYMENT_PROVIDER=fake only; never reaches
// a real provider.
//   npm run billing:simulate -- paid <fake bill id>
//   npm run billing:simulate -- failed <fake bill id>
//   npm run billing:simulate -- wrong-amount <fake bill id>
//   npm run billing:simulate -- bad-signature <fake bill id>
import pg from "pg";
import { fakeCallback } from "../../packages/billing/src/fake.ts";

const [action, id] = process.argv.slice(2);
const actions = ["paid", "failed", "wrong-amount", "bad-signature", "replay"];
if (!actions.includes(action ?? "") || !/^fake_[0-9a-f]{16}$/.test(id ?? "")) {
  console.error(`Usage: npm run billing:simulate -- <${actions.join("|")}> fake_<16 hex>`);
  process.exit(2);
}
const origin = process.env.LOCAL_ORIGIN ?? "http://127.0.0.1:4182";
const url = new URL(origin);
if (url.hostname !== "127.0.0.1") throw Error("LOCAL_ONLY");
const db = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
const dbUrl = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (dbUrl.hostname !== "127.0.0.1" || dbUrl.port !== "54622") throw Error("LOCAL_DATABASE_REQUIRED");
await db.connect();
const row = (
  await db.query("select amount_sen from app.billing_topup where provider='fake' and provider_ref=$1", [id])
).rows[0];
await db.end();
if (!row) {
  console.error("No fake top-up with that id.");
  process.exit(1);
}
const amount = row.amount_sen as number;
const body = fakeCallback({
  id,
  amountSen: amount,
  paid: action !== "failed",
  paidAmountSen: action === "wrong-amount" ? Math.max(1, amount - 100) : amount,
  transactionId: action === "replay" ? "simulated-paid" : `simulated-${action}-${Date.now()}`,
  key: action === "bad-signature" ? "not-the-key" : undefined,
});
const response = await fetch(`${origin}/api/billing/webhook/fake`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
});
console.log(`${action}: HTTP ${response.status}`);
