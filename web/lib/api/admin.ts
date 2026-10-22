import type { SetupDraft } from "./product-types";
import type { CrmData } from "./crm";
export type AuditAction =
  | "organization"
  | "branches"
  | "team"
  | "notifications"
  | "keys"
  | "retention"
  | "agent"
  | "channels"
  | "wallet"
  | "contacts"
  | "bookings"
  | "integrations"
  | "export"
  | "outbound"
  | "platform"
  | "installation"
  | "session";
export type AuditEntry = {
  org_id: string;
  id: string;
  at: string;
  action: AuditAction;
};
export type Branch = {
  org_id: string;
  id: string;
  name: string;
  address: string;
  archived: boolean;
};
export type Member = {
  org_id: string;
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "staff";
  status: "active" | "invited" | "inactive";
};
export type PreviewKey = {
  org_id: string;
  id: string;
  name: string;
  suffix: string;
  scope: "activity" | "bookings";
  status: "active" | "revoked";
  created_at: string;
};
export interface AdminSettings {
  branches: Branch[];
  primary_address: string;
  members: Member[];
  notifications: {
    enabled: boolean;
    time: string;
    callbacks: boolean;
    last_preview_at: string | null;
  };
  retention_days: number;
  keys: PreviewKey[];
  audit: AuditEntry[];
}
export function newAdmin(): AdminSettings {
  return {
    branches: [],
    primary_address: "",
    members: [
      {
        id: "sample-owner",
        org_id: "sample-org",
        name: "Pemilik Contoh",
        email: "owner@example.invalid",
        role: "owner",
        status: "active",
      },
      {
        id: "sample-staff",
        org_id: "sample-org",
        name: "Staf Contoh",
        email: "team@example.invalid",
        role: "staff",
        status: "active",
      },
    ],
    notifications: {
      enabled: false,
      time: "18:00",
      callbacks: true,
      last_preview_at: null,
    },
    retention_days: 30,
    keys: [],
    audit: [],
  };
}
export const auditEntry = (action: AuditAction): AuditEntry => ({
  org_id: "sample-org",
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  action,
});
export function validAdmin(a: AdminSettings | undefined): a is AdminSettings {
  return (
    !!a &&
    Array.isArray(a.branches) &&
    a.branches.every(
      (b) =>
        b &&
        typeof b.id === "string" &&
        typeof b.name === "string" &&
        typeof b.address === "string" &&
        typeof b.archived === "boolean",
    ) &&
    typeof a.primary_address === "string" &&
    Array.isArray(a.members) &&
    a.members.some((m) => m && m.role === "owner" && m.status === "active") &&
    a.members.every(
      (m) =>
        m &&
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        typeof m.email === "string" &&
        ["owner", "admin", "staff"].includes(m.role) &&
        ["active", "invited", "inactive"].includes(m.status),
    ) &&
    !!a.notifications &&
    typeof a.notifications.enabled === "boolean" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(a.notifications.time) &&
    typeof a.notifications.callbacks === "boolean" &&
    (a.notifications.last_preview_at === null ||
      (typeof a.notifications.last_preview_at === "string" &&
        !isNaN(Date.parse(a.notifications.last_preview_at)))) &&
    [7, 30, 90, 365].includes(a.retention_days) &&
    Array.isArray(a.keys) &&
    a.keys.every(
      (k) =>
        k &&
        typeof k.id === "string" &&
        typeof k.name === "string" &&
        typeof k.suffix === "string" &&
        ["activity", "bookings"].includes(k.scope) &&
        ["active", "revoked"].includes(k.status) &&
        !isNaN(Date.parse(k.created_at)),
    ) &&
    Array.isArray(a.audit) &&
    a.audit.every(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.action === "string" &&
        !isNaN(Date.parse(e.at)),
    )
  );
}
export const branchesFor = (d: SetupDraft): Branch[] => [
  {
    id: d.location.id,
    org_id: d.organization.id,
    name: d.location.name,
    address: d.admin.primary_address,
    archived: false,
  },
  ...d.admin.branches,
];
export const branchAvailable = (d: SetupDraft, id: string) =>
  branchesFor(d).some((b) => b.id === id && !b.archived);
export const branchInUse = (d: SetupDraft, c: CrmData, id: string) =>
  id === d.location.id ||
  d.phone_line.location_id === id ||
  c.bookings.some((b) => b.location_id === id && b.status !== "cancelled");
export function auditSetup(before: SetupDraft, next: SetupDraft): SetupDraft {
  const changed = (a: unknown, b: unknown) =>
    JSON.stringify(a) !== JSON.stringify(b);
  const actions: AuditAction[] = [];
  if (changed(before.extensions?.branch_hours, next.extensions?.branch_hours))
    actions.push("branches");
  for (const k of ["platform", "installation", "session"] as const)
    if (changed(before.extensions?.[k], next.extensions?.[k])) actions.push(k);
  if (changed(before.organization, next.organization))
    actions.push("organization");
  if (
    changed(
      [before.location, before.admin.branches, before.admin.primary_address],
      [next.location, next.admin.branches, next.admin.primary_address],
    )
  )
    actions.push("branches");
  for (const k of ["notifications", "keys"] as const)
    if (changed(before.admin[k], next.admin[k])) actions.push(k);
  if (changed(before.admin.members, next.admin.members)) actions.push("team");
  if (before.admin.retention_days !== next.admin.retention_days)
    actions.push("retention");
  if (
    changed(
      [before.agent, before.settings, before.knowledge_items],
      [next.agent, next.settings, next.knowledge_items],
    )
  )
    actions.push("agent");
  if (
    changed(
      [
        before.phone_line,
        before.whatsapp_channel,
        before.calendar,
        before.services.quality,
        before.services.templates,
      ],
      [
        next.phone_line,
        next.whatsapp_channel,
        next.calendar,
        next.services.quality,
        next.services.templates,
      ],
    )
  )
    actions.push("channels");
  if (
    changed(
      [
        before.wallet_ledger,
        before.services.auto_topup,
        before.services.payments,
      ],
      [next.wallet_ledger, next.services.auto_topup, next.services.payments],
    )
  )
    actions.push("wallet");
  return actions.length
    ? {
        ...next,
        admin: {
          ...next.admin,
          audit: [...next.admin.audit, ...actions.map(auditEntry)],
        },
      }
    : next;
}
export function sampleKeyResponse(
  key: PreviewKey,
  resource: "activity" | "bookings",
  crm: CrmData,
) {
  if (key.status === "revoked")
    return { sample: true, status: 401, result: "revoked" };
  if (key.scope !== resource)
    return { sample: true, status: 403, result: "scope" };
  return {
    sample: true,
    status: 200,
    result: resource,
    count:
      resource === "activity"
        ? crm.calls.length
        : crm.bookings.filter((b) => b.status !== "cancelled").length,
  };
}
