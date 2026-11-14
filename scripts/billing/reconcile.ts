// Asks the configured provider about recent unsettled top-ups and settles
// the paid ones (exactly once, through the same database function as the
// callback). Also marks top-ups older than 24 hours as expired.
// Prints counts only. Local database only.
import pg from "pg";
import { createProvider, paymentReadiness } from "../../packages/billing/src/provider.ts";

const ready = paymentReadiness();
const url = new URL(process.env.LOCAL_ADMIN_DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "54622") throw Error("LOCAL_DATABASE_REQUIRED");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  const counts: Record<string, number> = {};
  if (ready.configured) {
    const provider = createProvider();
    const rows = (
      await db.query(
        "select provider_ref from app.billing_topup where provider=$1 and provider_ref is not null and state in('pending','failed','expired') and created_at>now()-interval '30 days' order by created_at limit 200",
        [provider.name],
      )
    ).rows;
    for (const { provider_ref } of rows) {
      try {
        const r = await provider.getPayment(provider_ref);
        if (!r.paid) {
          counts.unpaid = (counts.unpaid ?? 0) + 1;
          continue;
        }
        const out = (
          await db.query("select app_private.settle_topup($1,$2,$3,true,$4,$5,$6,'reconcile') v", [
            provider.name, r.providerRef, r.eventKey, r.amountSen, r.currency, r.paidAt,
          ])
        ).rows[0].v;
        counts[out.outcome] = (counts[out.outcome] ?? 0) + 1;
      } catch (e) {
        const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : "ERROR";
        counts[code] = (counts[code] ?? 0) + 1;
      }
    }
  } else counts[ready.reason ?? "PAYMENTS_DISABLED"] = 1;
  counts.expired = (await db.query("select app_private.expire_topups(24) n")).rows[0].n;
  console.log(JSON.stringify(counts));
} finally {
  await db.end();
}
