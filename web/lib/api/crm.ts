import { newOutbound, validOutbound, type OutboundData } from "./outbound";
import { scheduleFor } from "./remaining";
import { auditEntry, type AuditEntry, branchAvailable } from "./admin";
import { INBOX_KEY, inboxApi, makeEvent, type InboxData } from "./inbox";
import { previewActivity } from "./client";
import type { Call, Locale } from "./types";
import type { SetupDraft } from "./product-types";
export type ConnectorId =
  "google" | "cal" | "sheets" | "facebook" | "tiktok" | "webhook";
export type Connector = {
  id: ConnectorId;
  org_id: string;
  status: "disconnected" | "connected" | "error";
  checked_at: string | null;
  runs: number;
};
export type ConsentRecord = {
  id: string;
  org_id: string;
  contact_id: string;
  kind: "opt_in" | "do_not_contact";
  granted: boolean;
  at: string;
  source: "sample" | "staff";
};
export type Booking = {
  id: string;
  org_id: string;
  contact_id: string;
  location_id: string;
  title: string;
  start_at: string;
  duration_minutes: number;
  status: "confirmed" | "requested" | "cancelled";
  source: "ai" | "staff";
  provider: "google" | "cal" | null;
  updated_at: string;
};
export interface CrmData extends InboxData {
  outbound: OutboundData;
  activity_audit: AuditEntry[];
  bookings: Booking[];
  consents: ConsentRecord[];
  connectors: Connector[];
  calls: Call[];
}
export const CRM_KEY = "jomcall-preview-crm-v1";
export const connectorIds: ConnectorId[] = [
  "google",
  "cal",
  "sheets",
  "facebook",
  "tiktok",
  "webhook",
];
export const klDay = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const shiftDay = (day: string, offset: number) =>
  klDay(
    new Date(new Date(`${day}T12:00:00+08:00`).getTime() + offset * 86400000),
  );
export const bookingTime = (day: string, time: string) =>
  new Date(`${day}T${time}:00+08:00`).toISOString();
export function seedCrm(locale: Locale): CrmData {
  const inbox = inboxApi.load(locale),
    now = new Date().toISOString(),
    day = klDay();
  return {
    ...inbox,
    outbound: newOutbound(),
    activity_audit: [],
    consents: inbox.contacts.flatMap((c) =>
      (["opt_in", "do_not_contact"] as const).map((kind) => ({
        id: crypto.randomUUID(),
        org_id: c.org_id,
        contact_id: c.id,
        kind,
        granted: c[kind],
        at: now,
        source: "sample" as const,
      })),
    ),
    bookings: inbox.contacts.slice(0, 3).map((c, i) => ({
      id: `sample-booking-${i}`,
      org_id: c.org_id,
      contact_id: c.id,
      location_id: "sample-location",
      title: locale === "ms" ? "Konsultasi contoh" : "Sample consultation",
      start_at: bookingTime(
        shiftDay(day, i === 2 ? 1 : 0),
        i === 0 ? "10:00" : "15:00",
      ),
      duration_minutes: 30,
      status: "requested",
      source: "ai",
      provider: null,
      updated_at: now,
    })),
    connectors: connectorIds.map((id) => ({
      id,
      org_id: "sample-org",
      status: "disconnected",
      checked_at: null,
      runs: 0,
    })),
    calls: previewActivity()
      .calls.map((c, i) => ({
        ...c,
        contact_id: `sample-contact-${(i % 4) + 1}`,
      }))
      .filter((c) => inbox.contacts.some((p) => p.id === c.contact_id)),
  };
}
export const crmApi = {
  load(locale: Locale, recoverPending = true): CrmData {
    const raw = localStorage.getItem(CRM_KEY);
    if (!raw) return seedCrm(locale);
    const d = JSON.parse(raw) as CrmData;
    if (
      d.schema !== 1 ||
      !Array.isArray(d.contacts) ||
      !Array.isArray(d.bookings) ||
      !Array.isArray(d.consents) ||
      !Array.isArray(d.calls) ||
      !d.consents.every(
        (c) =>
          c &&
          typeof c.contact_id === "string" &&
          !isNaN(Date.parse(c.at)) &&
          ["opt_in", "do_not_contact"].includes(c.kind),
      ) ||
      !d.calls.every(
        (c) =>
          c &&
          typeof c.contact_id === "string" &&
          !isNaN(Date.parse(c.started_at)) &&
          [0, 1, 2, 3].includes(c.outcome),
      ) ||
      !Array.isArray(d.connectors) ||
      !d.contacts.every(
        (c) =>
          typeof c.id === "string" &&
          typeof c.name === "string" &&
          typeof c.language === "string" &&
          typeof c.do_not_contact === "boolean" &&
          typeof c.opt_in === "boolean" &&
          Number.isInteger(c.stage) &&
          c.stage >= 0 &&
          c.stage < 4 &&
          ["ai", "staff"].includes(c.owner) &&
          ["open", "waiting", "resolved"].includes(c.status) &&
          !isNaN(Date.parse(c.last_inbound_at)) &&
          Array.isArray(c.events) &&
          c.events.length &&
          c.events.every(
            (e) => typeof e.body === "string" && !isNaN(Date.parse(e.at)),
          ),
      ) ||
      !d.bookings.every(
        (b) =>
          typeof b.id === "string" &&
          !isNaN(Date.parse(b.start_at)) &&
          Number.isFinite(b.duration_minutes) &&
          ["requested", "confirmed", "cancelled"].includes(b.status),
      ) ||
      !connectorIds.every((id) =>
        d.connectors.some(
          (c) =>
            c.id === id &&
            ["disconnected", "connected", "error"].includes(c.status),
        ),
      )
    )
      throw new Error("Invalid local preview");
    return {
      ...d,
      outbound: validOutbound(d.outbound) ? d.outbound : newOutbound(),
      activity_audit: Array.isArray(d.activity_audit)
        ? d.activity_audit.filter(
            (e) =>
              e && typeof e.action === "string" && !isNaN(Date.parse(e.at)),
          )
        : [],
      contacts: d.contacts.map((c) => ({
        ...c,
        events: c.events.map((e) =>
          recoverPending && e.delivery === "sending"
            ? { ...e, delivery: "unknown" }
            : e,
        ),
      })),
    };
  },
  save(data: CrmData) {
    localStorage.setItem(CRM_KEY, JSON.stringify(data));
    localStorage.removeItem(INBOX_KEY);
  },
  audit(previous: CrmData, next: CrmData): CrmData {
    const records = next.contacts.flatMap((c) => {
      const old = previous.contacts.find((p) => p.id === c.id);
      return (["opt_in", "do_not_contact"] as const)
        .filter((kind) => !old || old[kind] !== c[kind])
        .map((kind) => ({
          id: crypto.randomUUID(),
          org_id: c.org_id,
          contact_id: c.id,
          kind,
          granted: c[kind],
          at: new Date().toISOString(),
          source: "staff" as const,
        }));
    });
    const changes = (
      ["contacts", "bookings", "connectors", "outbound"] as const
    ).filter((k) => JSON.stringify(previous[k]) !== JSON.stringify(next[k]));
    return {
      ...next,
      consents: [...next.consents, ...records],
      activity_audit: [
        ...(next.activity_audit ?? []),
        ...changes.map((k) =>
          auditEntry(k === "connectors" ? "integrations" : k),
        ),
      ],
    };
  },
  removeContact(d: CrmData, id: string): CrmData {
    return {
      ...d,
      outbound: {
        ...d.outbound,
        runs: d.outbound.runs.filter((r) => r.contact_id !== id),
      },
      contacts: d.contacts.filter((c) => c.id !== id),
      consents: d.consents.filter((c) => c.contact_id !== id),
      bookings: d.bookings.filter((b) => b.contact_id !== id),
      calls: d.calls.filter((c) => c.contact_id !== id),
    };
  },
  exportContact(d: CrmData, id: string) {
    return JSON.stringify(
      {
        sample: true,
        exported_at: new Date().toISOString(),
        contact: d.contacts.find((c) => c.id === id),
        workflow_runs: d.outbound.runs.filter((r) => r.contact_id === id),
        consent_records: d.consents.filter((c) => c.contact_id === id),
        bookings: d.bookings.filter((b) => b.contact_id === id),
        calls: d.calls.filter((c) => c.contact_id === id),
      },
      null,
      2,
    );
  },
  saveBooking(d: CrmData, booking: Booking, body: string): CrmData {
    return {
      ...d,
      bookings: [...d.bookings.filter((b) => b.id !== booking.id), booking],
      contacts: d.contacts.map((c) =>
        c.id === booking.contact_id
          ? { ...c, events: [...c.events, makeEvent("system", "system", body)] }
          : c,
      ),
    };
  },
};
export function bookingConflict(
  d: CrmData,
  b: Booking,
  draft: SetupDraft,
): "past" | "closed" | "conflict" | null {
  if (!branchAvailable(draft, b.location_id)) return "closed";
  const start = new Date(b.start_at),
    end = start.getTime() + b.duration_minutes * 60000;
  if (start.getTime() < Date.now()) return "past";
  const day = klDay(start),
    local = new Date(`${day}T12:00:00Z`),
    weekday = (local.getUTCDay() + 6) % 7;
  const schedule = scheduleFor(draft, b.location_id);
  const hours = schedule.weekly_hours[weekday];
  if (
    !hours?.open ||
    !/^\d{2}:\d{2}$/.test(hours.from) ||
    !/^\d{2}:\d{2}$/.test(hours.to) ||
    hours.from >= hours.to ||
    schedule.closures.some((c) => c.date === day) ||
    start.getTime() < new Date(`${day}T${hours.from}:00+08:00`).getTime() ||
    end > new Date(`${day}T${hours.to}:00+08:00`).getTime()
  )
    return "closed";
  const buffer = draft.settings.buffer_minutes * 60000;
  if (
    d.bookings.some(
      (other) =>
        other.id !== b.id &&
        other.status !== "cancelled" &&
        other.location_id === b.location_id &&
        start.getTime() <
          new Date(other.start_at).getTime() +
            other.duration_minutes * 60000 +
            buffer &&
        end + buffer > new Date(other.start_at).getTime(),
    )
  )
    return "conflict";
  return null;
}
