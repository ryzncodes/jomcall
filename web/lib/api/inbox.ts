import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import type { Call, Locale } from "./types";
export type Delivery = "delivered" | "failed" | "unknown" | "sending";
export type InboxEvent = {
  id: string;
  kind: "message" | "note" | "system" | "phone" | "whatsapp-call";
  author: "customer" | "team" | "aiSender" | "system";
  body: string;
  at: string;
  delivery?: Delivery;
  template?: boolean;
  template_id?: string;
  call_snapshot?: Pick<
    Call,
    "agent_version_id" | "location_id" | "phone_line_id" | "language"
  >;
};
export interface InboxContact {
  lead_source?: "facebook" | "tiktok" | "sheets" | "webhook";
  id: string;
  org_id: string;
  name: string;
  phone_e164: null;
  language: string;
  stage: number;
  do_not_contact: boolean;
  opt_in: boolean;
  call_permission: "unknown" | "requested" | "granted" | "denied";
  owner: "ai" | "staff";
  status: "open" | "waiting" | "resolved";
  last_inbound_at: string;
  events: InboxEvent[];
}
export interface InboxData {
  schema: 1;
  contacts: InboxContact[];
}
export const INBOX_KEY = "jomcall-preview-inbox-v1";
export const replyWindowOpen = (c: InboxContact, now = Date.now()) => {
  const elapsed = now - new Date(c.last_inbound_at).getTime();
  return elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000;
};
export const makeEvent = (
  kind: InboxEvent["kind"],
  author: InboxEvent["author"],
  body: string,
  extra: Partial<InboxEvent> = {},
): InboxEvent => ({
  id: crypto.randomUUID(),
  kind,
  author,
  body,
  at: new Date().toISOString(),
  ...extra,
});
export function newInbox(locale: Locale): InboxData {
  const t = (locale === "ms" ? ms : en).inbox,
    now = Date.now();
  return {
    schema: 1,
    contacts: t.seedNames.map((name, i) => ({
      id: `sample-contact-${i + 1}`,
      org_id: "sample-org",
      name,
      phone_e164: null,
      language: i === 2 ? "zh" : i === 0 ? "ms" : "en",
      stage: i === 3 ? 3 : i === 1 ? 1 : 0,
      do_not_contact: i === 3,
      opt_in: i !== 3,
      call_permission: i === 1 ? "granted" : "unknown",
      owner: i === 1 ? "ai" : "staff",
      status: i === 3 ? "resolved" : i === 1 ? "open" : "waiting",
      last_inbound_at: new Date(
        now - (i === 2 ? 30 : 1) * 3600000,
      ).toISOString(),
      events: [
        {
          id: `initial-${i}`,
          kind: "message",
          author: "customer",
          body: t.seedMessages[i],
          at: new Date(now - (i === 2 ? 30 : 1) * 3600000).toISOString(),
        },
        ...(i === 0
          ? [
              {
                id: "sample-phone-history",
                kind: "phone" as const,
                author: "system" as const,
                body: t.normalHistory,
                at: new Date(now - 3500000).toISOString(),
              },
              {
                id: "sample-wa-history",
                kind: "whatsapp-call" as const,
                author: "system" as const,
                body: t.callHistory,
                at: new Date(now - 3400000).toISOString(),
              },
              {
                id: "sample-handoff",
                kind: "system" as const,
                author: "system" as const,
                body: t.handoff,
                at: new Date(now - 3300000).toISOString(),
              },
            ]
          : []),
      ],
    })),
  };
}
export const inboxApi = {
  load(locale: Locale): InboxData {
    try {
      const raw = localStorage.getItem(INBOX_KEY);
      if (raw) {
        const d = JSON.parse(raw) as InboxData;
        if (
          d.schema === 1 &&
          Array.isArray(d.contacts) &&
          d.contacts.every(
            (c) =>
              c &&
              typeof c.id === "string" &&
              typeof c.name === "string" &&
              typeof c.language === "string" &&
              Number.isInteger(c.stage) &&
              c.stage >= 0 &&
              c.stage < 4 &&
              typeof c.do_not_contact === "boolean" &&
              typeof c.opt_in === "boolean" &&
              ["unknown", "requested", "granted", "denied"].includes(
                c.call_permission,
              ) &&
              ["ai", "staff"].includes(c.owner) &&
              ["open", "waiting", "resolved"].includes(c.status) &&
              !isNaN(Date.parse(c.last_inbound_at)) &&
              Array.isArray(c.events) &&
              c.events.length > 0 &&
              c.events.every(
                (e) =>
                  e &&
                  typeof e.id === "string" &&
                  typeof e.body === "string" &&
                  [
                    "message",
                    "note",
                    "system",
                    "phone",
                    "whatsapp-call",
                  ].includes(e.kind) &&
                  ["customer", "team", "aiSender", "system"].includes(
                    e.author,
                  ) &&
                  !isNaN(Date.parse(e.at)) &&
                  (!e.delivery ||
                    ["delivered", "failed", "unknown", "sending"].includes(
                      e.delivery,
                    )),
              ),
          )
        ) {
          return {
            ...d,
            contacts: d.contacts.map((c) => ({
              ...c,
              events: c.events.map((e) =>
                e.delivery === "sending" ? { ...e, delivery: "unknown" } : e,
              ),
            })),
          };
        }
      }
    } catch {}
    return newInbox(locale);
  },
  save(data: InboxData) {
    try {
      localStorage.setItem(INBOX_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },
  async settle(outcome: Delivery) {
    await new Promise((r) => setTimeout(r, 650));
    return outcome;
  },
  canSend(c: InboxContact, template = false) {
    return (
      !c.do_not_contact &&
      c.owner === "staff" &&
      c.status !== "resolved" &&
      (template ? c.opt_in : replyWindowOpen(c)) &&
      !c.events.some(
        (e) => e.delivery === "unknown" || e.delivery === "sending",
      )
    );
  },
  exportContact(c: InboxContact) {
    return JSON.stringify({ sample: true, contact: c }, null, 2);
  },
};
