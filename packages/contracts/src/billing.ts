import { z } from "zod";

// Top-up amounts the owner may pick, in sen. Limits match the database.
export const topupAmounts = [2000, 5000, 10000, 20000] as const;
export const topupInput = z
  .object({ amountSen: z.number().int().min(1000).max(500000) })
  .strict();
export const billingPages = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(2048).optional(),
  })
  .strict();

export type WalletStateName = "unfunded" | "ok" | "low" | "grace" | "exhausted";
export type Wallet = {
  balanceSen: number;
  currency: "MYR";
  state: WalletStateName;
  serviceAllowed: boolean;
  lowThresholdSen: number;
  graceFloorSen: number;
  trialClaimed: boolean;
  trialCreditSen: number;
  provider: {
    name: "disabled" | "fake" | "billplz";
    configured: boolean;
    sandbox: boolean;
    reason: string | null;
  };
  prices: { kind: string; unit_sen: number; per_quantity: number; version: number }[];
};
export type LedgerEntry = {
  id: string;
  kind: "topup" | "trial_credit" | "usage" | "refund" | "adjustment";
  amount_sen: number;
  currency: "MYR";
  reason: string | null;
  usage_event_id: string | null;
  topup_id: string | null;
  created_at: string;
};
export type UsageEvent = {
  id: string;
  kind: string;
  quantity: number;
  amount_sen: number;
  occurred_at: string;
  created_at: string;
};
export type Topup = {
  id: string;
  provider: string;
  amount_sen: number;
  currency: "MYR";
  state: "created" | "pending" | "paid" | "failed" | "expired" | "review";
  checkout_url: string | null;
  provider_ref: string | null;
  refunded_sen: number;
  failure_code: string | null;
  paid_at: string | null;
  created_at: string;
};
export type Receipt = {
  id: string;
  topup_id: string;
  number: string;
  amount_sen: number;
  tax_sen: number;
  currency: "MYR";
  buyer_name: string;
  provider: string;
  provider_ref: string;
  einvoice_state: string;
  issued_at: string;
  created_at: string;
};
