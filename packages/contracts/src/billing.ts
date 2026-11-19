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
    name: "disabled" | "fake" | "curlec";
    configured: boolean;
    sandbox: boolean;
    reason: string | null;
  };
  prices: {
    kind: string;
    unit_sen: number;
    per_quantity: number;
    version: number;
  }[];
};
export type LedgerEntry = {
  id: string;
  kind:
    | "topup"
    | "trial_credit"
    | "usage"
    | "refund"
    | "adjustment"
    | "plan_fee";
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
  // Present only in the response that created the top-up.
  checkout?:
    | {
        kind: "curlec";
        keyId: string;
        orderId: string;
        amountSen: number;
        currency: "MYR";
        name: string;
        description: string;
        prefillEmail: string;
        callbackUrl: string;
      }
    | { kind: "fake"; orderId: string };
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

// Monthly plans (billing design §13). The figures come from the database.
export const planCodes = ["starter", "growth", "payg"] as const;
export const planChoice = z.object({ code: z.enum(planCodes) }).strict();
const planCode = z.enum(planCodes);
const sen = z.number().int();
// app_private.plan_summary. Without a period covering now the database
// leaves out the period's dates, fee and grace; they read as null and 0.
export const planSummary = z.object({
  plan: planCode,
  periodState: z.enum(["none", "free", "charged", "unpaid", "downgraded"]),
  periodStart: z.string().nullable().default(null),
  periodEnd: z.string().nullable().default(null),
  feeSen: sen.default(0),
  includedVoiceSeconds: z.number().int(),
  usedIncludedSeconds: z.number().int(),
  graceUntil: z.string().nullable().default(null),
  phoneNumbers: z.number().int(),
  whatsappAgent: z.boolean(),
  pendingPlan: planCode.nullable().default(null),
  anchorDate: z.string().nullable().default(null),
  balanceSen: sen,
  plans: z.array(
    z.object({
      code: planCode,
      feeSen: sen,
      includedVoiceSeconds: z.number().int(),
      phoneNumbers: z.number().int(),
      whatsappAgent: z.boolean(),
      graceDays: z.number().int(),
    }),
  ),
});
export type PlanSummary = z.output<typeof planSummary>;
// app_private.choose_plan. wallet_short is an answer, not an error: a first
// paid plan needs the whole fee in the wallet and nothing started.
export const planChoiceResult = z.object({
  outcome: z.enum([
    "started",
    "wallet_short",
    "scheduled",
    "cancelled",
    "unchanged",
  ]),
  plan: planCode,
  pendingPlan: planCode.nullable(),
  anchorDate: z.string().nullable(),
  neededSen: sen.optional(),
  balanceSen: sen.optional(),
});
export type PlanChoice = z.output<typeof planChoiceResult>;
