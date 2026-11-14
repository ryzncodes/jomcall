// Operator actions on a wallet. Local database only; each needs a reason
// and the operator's name, and leaves an audit record.
//   npm run billing:admin -- adjust <org id> <sen, may be negative> "<reason>" "<operator>"
//   npm run billing:admin -- refund <org id> <top-up id> <sen> "<reason>" "<operator>"
// With a payment provider configured, a refund is sent to the provider first
// (Curlec: POST /payments/:id/refund, paid from the Curlec balance, RM0.50
// each) and the wallet is debited once the provider reports it processed;
// a pending refund is finished by the refund.processed webhook. Without a
// provider (money returned by bank transfer), the refund is only recorded.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createProvider, paymentReadiness } from "../../packages/billing/src/provider.ts";
import { settleRefund } from "../../packages/billing/src/settle.ts";

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
  else if (action === "refund" && args.length === 5 && uuid.test(args[0]) && uuid.test(args[1]) && /^\d+$/.test(args[2])) {
    const [org, topupId, sen, reason, operator] = [args[0], args[1], Number(args[2]), args[3], args[4]];
    const t = (
      await db.query(
        "select provider,provider_ref,provider_payment_ref,state,amount_sen-refunded_sen left_sen from app.billing_topup where org_id=$1 and id=$2",
        [org, topupId],
      )
    ).rows[0];
    if (!t) throw Error("NOT_FOUND");
    const ready = paymentReadiness();
    if (ready.configured && ready.provider === t.provider && t.provider_payment_ref) {
      if (t.state !== "paid") throw Error("NOT_REFUNDABLE");
      if (sen <= 0 || sen > t.left_sen) throw Error("REFUND_EXCEEDS_TOPUP");
      if (reason.trim().length < 3 || operator.trim().length < 2) throw Error("INVALID_REFUND");
      const balance = Number((await db.query("select app_private.wallet_snapshot($1)->>'balanceSen' b", [org])).rows[0].b);
      if (sen > balance) throw Error("REFUND_EXCEEDS_BALANCE");
      const refund = await createProvider().refund({
        orderRef: t.provider_ref,
        paymentRef: t.provider_payment_ref,
        amountSen: sen,
        idempotencyKey: "jc-" + randomUUID().replaceAll("-", "").slice(0, 32),
        reason,
      });
      const out = await settleRefund(db, t.provider, refund, "operator", reason, operator);
      console.log(JSON.stringify({ refund: refund.status, outcome: out.outcome }));
    } else
      result = (await db.query("select app_private.admin_refund($1,$2,$3,$4,$5,$6) v", [org, topupId, sen, reason, operator, "cli-" + randomUUID()])).rows[0].v;
  } else {
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
