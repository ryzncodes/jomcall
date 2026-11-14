import type { PoolClient } from "pg";
import { z } from "zod";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../contracts/src/index.ts";
import { topupInput } from "../../contracts/src/billing.ts";
import { command } from "../../db/src/receipts.ts";
import { page } from "../../db/src/pagination.ts";
import {
  createProvider,
  paymentReadiness,
  publicOrigin,
  type PaymentProvider,
} from "../../billing/src/provider.ts";
import { manager } from "./authorization.ts";

// Built from the environment on each use; see packages/billing/src/provider.ts.
export function paymentProvider(): PaymentProvider {
  return createProvider();
}

const empty = z.object({}).strict();
const providerError = (e: unknown) =>
  new AppError(
    e instanceof Error && /^PAYMENT_[A-Z_]+$/.test(e.message)
      ? e.message
      : "PAYMENT_PROVIDER_ERROR",
    502,
  );

async function prices(tx: PoolClient) {
  return (
    await tx.query(
      "select distinct on(kind) kind,unit_sen,per_quantity,version from app.billing_price where effective_from<=now() order by kind,version desc",
    )
  ).rows;
}

export async function wallet(tx: PoolClient, orgId: string) {
  const summary = (
    await tx.query("select app_private.wallet_summary($1) as value", [orgId])
  ).rows[0].value;
  const ready = paymentReadiness();
  return {
    ...summary,
    balanceSen: Number(summary.balanceSen),
    provider: {
      name: ready.provider,
      configured: ready.configured,
      sandbox: ready.sandbox,
      reason: ready.reason,
    },
    prices: await prices(tx),
  };
}

export async function billingRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
) {
  if (!path.startsWith("/billing/")) return;
  // Only the owner and admins see or pay for billing.
  manager(ctx);
  const lists = {
    "/billing/ledger": "ledger",
    "/billing/usage": "usage",
    "/billing/topups": "topups",
    "/billing/receipts": "receipts",
  } as const;
  if (method === "GET" && path in lists)
    return page(tx, ctx.orgId, lists[path as keyof typeof lists], query);
  if (method === "GET" && path === "/billing/wallet") return wallet(tx, ctx.orgId);
  if (method === "POST" && path === "/billing/trial") {
    empty.parse(body);
    return command(
      tx,
      ctx,
      key,
      "billing.claimTrial",
      {},
      async () => {
        await tx.query("select app_private.claim_trial($1)", [ctx.orgId]);
        return { ref: {}, data: await wallet(tx, ctx.orgId) };
      },
      async () => wallet(tx, ctx.orgId),
    );
  }
  const loadTopup = async (id: string) => {
    const row = (
      await tx.query("select * from app.billing_topup where org_id=$1 and id=$2", [
        ctx.orgId,
        id,
      ])
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return row;
  };
  if (method === "POST" && path === "/billing/topups") {
    const v = topupInput.parse(body);
    const ready = paymentReadiness();
    if (!ready.configured) throw new AppError("PAYMENTS_NOT_CONNECTED", 503);
    return command(
      tx,
      ctx,
      key,
      "billing.startTopup",
      v,
      async () => {
        const provider = paymentProvider();
        const topup = (
          await tx.query("select app_private.create_topup($1,$2,$3) as value", [
            ctx.orgId,
            v.amountSen,
            provider.name,
          ])
        ).rows[0].value;
        const org = (
          await tx.query("select name from app.organization where id=$1", [ctx.orgId])
        ).rows[0];
        const origin = publicOrigin();
        let checkout;
        try {
          // A failure here rolls the whole top-up back; nothing is charged.
          checkout = await provider.createCheckout({
            topupId: topup.id,
            amountSen: v.amountSen,
            description: "JomCall credit top-up",
            payerName: org.name,
            payerEmail: ctx.identity.confirmedEmail,
            callbackUrl: `${origin}/api/billing/webhook/${provider.name}`,
            redirectUrl: `${origin}/app/billing?topup=${topup.id}`,
          });
        } catch (e) {
          throw providerError(e);
        }
        const attached = (
          await tx.query("select app_private.attach_topup($1,$2,$3,$4) as value", [
            ctx.orgId,
            topup.id,
            checkout.providerRef,
            checkout.checkoutUrl,
          ])
        ).rows[0].value;
        return { ref: { id: topup.id }, data: attached };
      },
      async (ref) => loadTopup(String(ref.id)),
    );
  }
  const m = path.match(/^\/billing\/topups\/([^/]+)\/reconcile$/);
  if (m && method === "POST") {
    const id = uuid.parse(m[1]);
    empty.parse(body);
    const topup = await loadTopup(id);
    if (!topup.provider_ref || ["paid", "review"].includes(topup.state)) return topup;
    const ready = paymentReadiness();
    if (!ready.configured || ready.provider !== topup.provider)
      throw new AppError("PAYMENTS_NOT_CONNECTED", 503);
    let result;
    try {
      result = await paymentProvider().getPayment(topup.provider_ref);
    } catch (e) {
      throw providerError(e);
    }
    // Only a paid answer changes anything; an unpaid bill stays payable.
    if (result.paid)
      await tx.query(
        "select app_private.settle_topup($1,$2,$3,$4,$5,$6,$7,'reconcile')",
        [
          topup.provider,
          result.providerRef,
          result.eventKey,
          true,
          result.amountSen,
          result.currency,
          result.paidAt,
        ],
      );
    return loadTopup(id);
  }
}
