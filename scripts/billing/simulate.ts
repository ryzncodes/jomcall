// Posts a fake, signed Curlec-shaped webhook to the local web app. Local mode
// with JOMCALL_PAYMENT_PROVIDER=fake only; never reaches Curlec.
//   npm run billing:simulate -- paid <fake order id>
//   npm run billing:simulate -- failed <fake order id>
//   npm run billing:simulate -- wrong-amount <fake order id>
//   npm run billing:simulate -- bad-signature <fake order id>
//   npm run billing:simulate -- replay <fake order id>     (same payment twice)
//   npm run billing:simulate -- refund <fake order id>     (full refund, processed)
import pg from "pg";
import { fakeWebhook } from "../../packages/billing/src/fake.ts";

const [action, id] = process.argv.slice(2);
const actions = ["paid", "failed", "wrong-amount", "bad-signature", "replay", "refund"];
if (!actions.includes(action ?? "") || !/^order_fake[0-9a-f]{10}$/.test(id ?? "")) {
  console.error(`Usage: npm run billing:simulate -- <${actions.join("|")}> order_fake<10 hex>`);
  process.exit(2);
}
const origin = process.env.LOCAL_ORIGIN ?? "http://127.0.0.1:4182";
if (new URL(origin).hostname !== "127.0.0.1") throw Error("LOCAL_ONLY");
const dbUrl = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (dbUrl.hostname !== "127.0.0.1" || dbUrl.port !== "54622") throw Error("LOCAL_DATABASE_REQUIRED");
const db = new pg.Client({ connectionString: dbUrl.toString() });
await db.connect();
const row = (
  await db.query(
    "select amount_sen,provider_payment_ref from app.billing_topup where provider='fake' and provider_ref=$1",
    [id],
  )
).rows[0];
await db.end();
if (!row) {
  console.error("No fake top-up with that order id.");
  process.exit(1);
}
const amount = row.amount_sen as number;
if (action === "refund" && !row.provider_payment_ref) {
  console.error("That top-up has no credited payment to refund.");
  process.exit(1);
}
const delivery = fakeWebhook({
  event:
    action === "failed" ? "payment.failed" : action === "refund" ? "refund.processed" : "payment.captured",
  orderId: id,
  amountSen: action === "wrong-amount" ? Math.max(100, amount - 100) : amount,
  paymentId: action === "refund" ? row.provider_payment_ref : action === "replay" ? `pay_fake${id.slice(-10)}` : undefined,
  secret: action === "bad-signature" ? "not-the-secret" : undefined,
});
const send = () =>
  fetch(`${origin}/api/billing/webhook/fake`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": delivery.signature,
      "x-razorpay-event-id": delivery.eventId,
    },
    body: delivery.body,
  });
console.log(`${action}: HTTP ${(await send()).status}`);
if (action === "replay") console.log(`replay: HTTP ${(await send()).status}`);
