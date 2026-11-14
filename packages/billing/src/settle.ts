import type { PaymentEvent, RefundEvent } from "./provider.ts";

type Queryable = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: { value: unknown }[] }>;
};
export type SettleOutcome = {
  outcome: string;
  first?: string;
  topupId?: string;
};

// The one way a verified payment report reaches the wallet. Exactly-once is
// enforced in app_private.settle_topup (event key, then one ledger row per
// top-up), so callers may repeat it freely.
export async function settlePayment(
  db: Queryable,
  provider: string,
  e: PaymentEvent,
  source: "callback" | "reconcile",
): Promise<SettleOutcome> {
  return (
    await db.query(
      "select app_private.settle_topup($1,$2,$3,$4,$5,$6,$7,$8,$9) as value",
      [
        provider,
        e.orderRef,
        e.paymentRef,
        e.eventKey,
        e.paid,
        e.amountSen,
        e.currency,
        e.paidAt,
        source,
      ],
    )
  ).rows[0].value as SettleOutcome;
}

// The one way a verified refund report reaches the wallet: one ledger row per
// provider refund id, written only when the refund is processed.
export async function settleRefund(
  db: Queryable,
  provider: string,
  e: RefundEvent,
  source: "callback" | "reconcile" | "operator",
  reason?: string,
  operator?: string,
): Promise<SettleOutcome> {
  return (
    await db.query(
      "select app_private.settle_refund($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as value",
      [
        provider,
        e.orderRef,
        e.paymentRef,
        e.refundRef,
        e.eventKey,
        e.status,
        e.amountSen,
        e.currency,
        source,
        reason ?? null,
        operator ?? null,
      ],
    )
  ).rows[0].value as SettleOutcome;
}
