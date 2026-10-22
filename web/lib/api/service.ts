import { branchAvailable } from "./admin";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import type { Locale } from "./types";
import type { SetupDraft } from "./product-types";
import type { CrmData } from "./crm";
export type MessageTemplate = {
  id: string;
  org_id: string;
  name: string;
  body: string;
  language: "en" | "ms";
  status: "draft" | "pending" | "approved" | "rejected";
  category: "utility" | "marketing";
  updated_at: string;
};
export type Payment = {
  id: string;
  org_id: string;
  amount_sen: number;
  method: "fpx" | "duitnow" | "mock";
  status: "paid" | "failed" | "unknown";
  created_at: string;
};
export type Usage = {
  id: string;
  org_id: string;
  kind: "voice" | "message";
  quantity: number;
  amount_sen: number;
  at: string;
};
export interface ServiceSettings {
  quality: "healthy" | "watch" | "restricted";
  templates: MessageTemplate[];
  payments: Payment[];
  usage: Usage[];
  auto_topup: { enabled: boolean; threshold_sen: number; amount_sen: number };
}
export function newServices(locale: Locale): ServiceSettings {
  const t = locale === "ms" ? ms : en,
    at = "2026-10-15T00:00:00+08:00";
  return {
    quality: "healthy",
    templates: [
      {
        id: "sample-template-followup",
        org_id: "sample-org",
        name: t.inbox.templateName,
        body: t.inbox.templateBody,
        language: locale,
        status: "approved",
        category: "utility",
        updated_at: at,
      },
      {
        id: "sample-template-reminder",
        org_id: "sample-org",
        name: t.services.reminderName,
        body: t.services.reminderBody,
        language: locale,
        status: "draft",
        category: "utility",
        updated_at: at,
      },
    ],
    payments: [],
    usage: [],
    auto_topup: { enabled: false, threshold_sen: 1000, amount_sen: 5000 },
  };
}
export function validServices(
  v: ServiceSettings | undefined,
): v is ServiceSettings {
  return (
    !!v &&
    ["healthy", "watch", "restricted"].includes(v.quality) &&
    Array.isArray(v.templates) &&
    v.templates.every(
      (t) =>
        t &&
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        typeof t.body === "string" &&
        ["draft", "pending", "approved", "rejected"].includes(t.status) &&
        ["en", "ms"].includes(t.language) &&
        ["utility", "marketing"].includes(t.category) &&
        !isNaN(Date.parse(t.updated_at)),
    ) &&
    Array.isArray(v.payments) &&
    v.payments.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        Number.isSafeInteger(p.amount_sen) &&
        p.amount_sen > 0 &&
        ["fpx", "duitnow", "mock"].includes(p.method) &&
        ["paid", "failed", "unknown"].includes(p.status) &&
        !isNaN(Date.parse(p.created_at)),
    ) &&
    Array.isArray(v.usage) &&
    v.usage.every(
      (u) =>
        u &&
        typeof u.id === "string" &&
        ["voice", "message"].includes(u.kind) &&
        Number.isSafeInteger(u.amount_sen) &&
        u.amount_sen >= 0 &&
        Number.isFinite(u.quantity) &&
        u.quantity > 0 &&
        !isNaN(Date.parse(u.at)),
    ) &&
    !!v.auto_topup &&
    typeof v.auto_topup.enabled === "boolean" &&
    Number.isSafeInteger(v.auto_topup.threshold_sen) &&
    v.auto_topup.threshold_sen >= 0 &&
    Number.isSafeInteger(v.auto_topup.amount_sen) &&
    v.auto_topup.amount_sen > v.auto_topup.threshold_sen
  );
}
export const walletBalance = (d: SetupDraft) =>
  d.wallet_ledger.reduce((n, l) => n + l.amount_sen, 0);
export const channelReady = (d: SetupDraft | null) =>
  !!d &&
  d.whatsapp_channel.status === "connected" &&
  d.services.quality !== "restricted";
export const forwardingReady = (d: SetupDraft) =>
  d.phone_line.reserved &&
  d.test_passed &&
  d.phone_line.agent_id === d.agent.id &&
  branchAvailable(d, d.phone_line.location_id);
export const serviceApi = {
  payment(d: SetupDraft, p: Payment): SetupDraft {
    const old = d.services.payments.find((x) => x.id === p.id);
    if (old?.status === "paid") return d;
    // One pending provider outcome at a time; an unknown payment is reconciled, never resent.
    if (
      d.services.payments.some((x) => x.status === "unknown" && x.id !== p.id)
    )
      return d;
    return {
      ...d,
      services: {
        ...d.services,
        payments: [...d.services.payments.filter((x) => x.id !== p.id), p],
      },
      wallet_ledger:
        p.status === "paid" && !d.wallet_ledger.some((l) => l.id === p.id)
          ? [
              ...d.wallet_ledger,
              {
                id: p.id,
                org_id: p.org_id,
                amount_sen: p.amount_sen,
                reason: "topup",
                created_at: p.created_at,
                method: p.method,
              },
            ]
          : d.wallet_ledger,
    };
  },
  candidates(crm: CrmData): Usage[] {
    return [
      ...crm.calls.map((c) => ({
        id: `usage-${c.id}`,
        org_id: c.org_id,
        kind: "voice" as const,
        quantity: c.duration_seconds,
        amount_sen: c.cost_sen,
        at: c.started_at,
      })),
      ...crm.contacts.flatMap((c) =>
        c.events
          .filter(
            (e) =>
              e.kind === "message" &&
              e.author === "team" &&
              e.delivery === "delivered",
          )
          .map((e) => ({
            id: `usage-${e.id}`,
            org_id: c.org_id,
            kind: "message" as const,
            quantity: 1,
            amount_sen: 5,
            at: e.at,
          })),
      ),
    ];
  },
  charge(d: SetupDraft, u: Usage): SetupDraft {
    if (
      d.services.usage.some((x) => x.id === u.id) ||
      d.wallet_ledger.some((l) => l.id === u.id) ||
      walletBalance(d) < u.amount_sen
    )
      return d;
    let next: SetupDraft = {
      ...d,
      services: { ...d.services, usage: [...d.services.usage, u] },
      wallet_ledger: [
        ...d.wallet_ledger,
        {
          id: u.id,
          org_id: u.org_id,
          amount_sen: -u.amount_sen,
          reason: "usage",
          created_at: new Date().toISOString(),
        },
      ],
    };
    const auto = next.services.auto_topup;
    if (
      auto.enabled &&
      walletBalance(next) < auto.threshold_sen &&
      !next.services.payments.some((p) => p.status === "unknown")
    )
      next = serviceApi.payment(next, {
        id: `auto-${u.id}`,
        org_id: u.org_id,
        amount_sen: auto.amount_sen,
        method: "mock",
        status: "paid",
        created_at: new Date().toISOString(),
      });
    return next;
  },
  route(d: SetupDraft, patch: Partial<SetupDraft["phone_line"]>): SetupDraft {
    return {
      ...d,
      phone_line: { ...d.phone_line, ...patch, verified: false },
      completed: false,
      completedSteps: d.completedSteps.filter((s) => s < 7),
    };
  },
};
