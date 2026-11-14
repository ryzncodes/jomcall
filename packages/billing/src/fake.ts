import { randomBytes } from "node:crypto";
import { parseBillplzCallback } from "./callback.ts";
import { sign } from "./signature.ts";
import type { PaymentProvider } from "./provider.ts";

// Not a secret: the fake provider exists only in local mode, and this key
// lets the simulator and tests sign callbacks the production parser checks.
export const fakeSignatureKey = "jomcall-local-fake-provider-key";

type Bill = { id: string; amountSen: number; paid: boolean; paidAmountSen: number };

// In-memory stand-in for a real provider. Nothing leaves the machine.
export function createFakeProvider(options: { key: string; origin: string }) {
  const bills = new Map<string, Bill>();
  const provider: PaymentProvider & {
    bills: Map<string, Bill>;
    markPaid(id: string, amountSen?: number): void;
  } = {
    name: "fake",
    sandbox: true,
    bills,
    async createCheckout(input) {
      const id = "fake_" + randomBytes(8).toString("hex");
      bills.set(id, { id, amountSen: input.amountSen, paid: false, paidAmountSen: 0 });
      return {
        providerRef: id,
        checkoutUrl: `${options.origin}/app/billing?fake_bill=${id}`,
      };
    },
    async getPayment(id) {
      const b = bills.get(id);
      return {
        providerRef: id,
        eventKey: `reconcile:${id}:${b?.paid ? "paid" : "unpaid"}`,
        paid: !!b?.paid,
        amountSen: b ? b.paidAmountSen : null,
        currency: "MYR",
        paidAt: null,
      };
    },
    parseCallback(body, contentType) {
      return parseBillplzCallback(body, contentType, options.key);
    },
    markPaid(id, amountSen) {
      const b = bills.get(id);
      if (b) Object.assign(b, { paid: true, paidAmountSen: amountSen ?? b.amountSen });
    },
  };
  return provider;
}

// Builds a Billplz-shaped callback body for a fake bill.
export function fakeCallback(input: {
  id: string;
  amountSen: number;
  paid: boolean;
  paidAmountSen?: number;
  transactionId?: string;
  key?: string;
  paidAt?: string;
}) {
  const fields: [string, string][] = [
    ["id", input.id],
    ["collection_id", "fakecol1"],
    ["paid", String(input.paid)],
    ["state", input.paid ? "paid" : "due"],
    ["amount", String(input.amountSen)],
    ["paid_amount", String(input.paid ? (input.paidAmountSen ?? input.amountSen) : 0)],
    ["due_at", "2026-11-14"],
    ["email", "owner@example.invalid"],
    ["mobile", ""],
    ["name", "SAMPLE BUSINESS"],
    ["url", `http://127.0.0.1:4182/app/billing?fake_bill=${input.id}`],
    ["paid_at", input.paid ? (input.paidAt ?? "2026-11-14 10:00:00 +0800") : ""],
    ["transaction_id", input.transactionId ?? "fake-tx-" + randomBytes(4).toString("hex")],
    ["transaction_status", input.paid ? "completed" : "failed"],
  ];
  fields.push(["x_signature", sign(fields, input.key ?? fakeSignatureKey)]);
  return new URLSearchParams(fields).toString();
}
