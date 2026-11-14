// Public price list, version 2. These figures mirror app.billing_plan and
// app.billing_price version 2 (migration 20261114210000_billing_plans.sql);
// tests/billing/plans.test.ts fails if the two drift apart. The public page
// renders in every mode, including the mock preview without a database, so
// it reads this copy rather than the database.
// Every figure is an owner placeholder, changeable. Amounts in integer sen.
export const priceVersion = 2;
export type PublicPlan = {
  code: "starter" | "growth" | "payg";
  monthlyFeeSen: number;
  includedVoiceSeconds: number;
  phoneNumbers: number;
  whatsappAgent: boolean;
};
export const publicPlans: PublicPlan[] = [
  { code: "starter", monthlyFeeSen: 4900, includedVoiceSeconds: 6000, phoneNumbers: 1, whatsappAgent: false },
  { code: "growth", monthlyFeeSen: 12900, includedVoiceSeconds: 24000, phoneNumbers: 1, whatsappAgent: true },
  { code: "payg", monthlyFeeSen: 0, includedVoiceSeconds: 0, phoneNumbers: 0, whatsappAgent: false },
];
// Per-unit prices: voice per 60 seconds (billed per second), JomCall's own
// WhatsApp agent fee per conversation (Meta bills its fees to the business),
// typed test turns.
export const publicPrices = {
  voiceSenPerMinute: 32,
  whatsappAgentSenPerConversation: 15,
  typedTurnSen: 2,
};
export const sourceUrl = "https://github.com/ryzncodes/jomcall";

// A month's estimate for one plan: the fee plus voice beyond the allowance.
export function monthlyEstimateSen(plan: PublicPlan, minutes: number) {
  const over = Math.max(0, minutes * 60 - plan.includedVoiceSeconds);
  return plan.monthlyFeeSen + Math.ceil((over * publicPrices.voiceSenPerMinute) / 60);
}
