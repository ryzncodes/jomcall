import { newExtensions, validExtensions } from "./remaining";
import { newAdmin, validAdmin } from "./admin";
import { newServices, validServices, forwardingReady } from "./service";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import type { Locale } from "./types";
import type {
  ProductApi,
  SetupDraft,
  TestTurn,
  CallScenario,
} from "./product-types";
import type { AgentSettings } from "./builder-types";
import { businessTypes } from "./builder-types";
export const STORAGE_KEY = "jomcall-preview-setup-v1";
export const template = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
const dictionary = (locale: Locale) => (locale === "ms" ? ms : en).product;
export function newSetup(locale: Locale): SetupDraft {
  const p = dictionary(locale);
  return {
    schema: 1,
    admin: newAdmin(),
    extensions: newExtensions(),
    services: newServices(locale),
    settings: {
      persona: (locale === "ms" ? ms : en).builder.defaultPersona,
      instructions: (locale === "ms" ? ms : en).builder.defaultInstructions,
      booking_mode: "calendar",
      duration_minutes: 30,
      buffer_minutes: 10,
      transfer_enabled: false,
      transfer_number: "",
      take_message: true,
      after_hours: (locale === "ms" ? ms : en).builder.defaultAfterHours,
      state: "Selangor",
      weekly_hours: Array.from({ length: 7 }, (_, i) => ({
        open: i < 6,
        from: "09:00",
        to: "18:00",
      })),
      closures: [],
      documents: [],
    },
    revisions: [],
    step: 0,
    completedSteps: [],
    completed: false,
    organization: {
      id: "sample-org",
      name: "Studio Contoh",
      business_type: "salon",
    },
    location: {
      id: "sample-location",
      org_id: "sample-org",
      name: "Shah Alam",
      hours: p.sampleHours,
      timezone: "Asia/Kuala_Lumpur",
    },
    source_url: "",
    knowledge_items: [
      {
        id: "sample-services",
        org_id: "sample-org",
        kind: "services",
        content: p.sampleServices,
      },
      {
        id: "sample-faq",
        org_id: "sample-org",
        kind: "faq",
        content: p.sampleFaq,
      },
    ],
    agent: {
      id: "sample-agent",
      org_id: "sample-org",
      version_id: "sample-version-1",
      languages: ["ms", "en"],
      voice: "warm",
      greeting: p.sampleGreeting,
      recording_enabled: true,
      recording_disclosure: p.sampleDisclosure,
    },
    phone_line: {
      id: "sample-line",
      org_id: "sample-org",
      location_id: "sample-location",
      agent_id: "sample-agent",
      phone_e164: null,
      reserved: false,
      forwarding_mode: "missed",
      telco: "Maxis",
      verified: false,
    },
    whatsapp_channel: {
      id: "sample-whatsapp",
      org_id: "sample-org",
      provider: "cloud",
      status: "disconnected",
    },
    calendar: { provider: "google", status: "disconnected" },
    test_passed: false,
    wallet_ledger: [],
  };
}
// Only this adapter knows about browser storage. The backend can replace it later.
const valid = (v: unknown): v is SetupDraft => {
  if (!v || typeof v !== "object") return false;
  const d = v as SetupDraft;
  return (
    d.schema === 1 &&
    Number.isInteger(d.step) &&
    d.step >= 0 &&
    d.step <= 8 &&
    Array.isArray(d.completedSteps) &&
    d.completedSteps.every((n) => Number.isInteger(n) && n >= 0 && n <= 8) &&
    typeof d.completed === "boolean" &&
    typeof d.organization?.name === "string" &&
    businessTypes.includes(d.organization.business_type) &&
    typeof d.location?.name === "string" &&
    typeof d.location.hours === "string" &&
    typeof d.source_url === "string" &&
    Array.isArray(d.knowledge_items) &&
    d.knowledge_items.length === 2 &&
    d.knowledge_items.every((k) => typeof k.content === "string") &&
    Array.isArray(d.agent?.languages) &&
    d.agent.languages.every((l) => ["ms", "en", "zh", "mixed"].includes(l)) &&
    ["warm", "clear", "measured"].includes(d.agent.voice) &&
    typeof d.agent.greeting === "string" &&
    typeof d.agent.recording_disclosure === "string" &&
    typeof d.agent.recording_enabled === "boolean" &&
    typeof d.phone_line?.reserved === "boolean" &&
    typeof d.phone_line.verified === "boolean" &&
    ["missed", "always"].includes(d.phone_line.forwarding_mode) &&
    ["Maxis", "CelcomDigi", "U Mobile", "Unifi"].includes(d.phone_line.telco) &&
    ["disconnected", "connected", "skipped"].includes(
      d.whatsapp_channel?.status,
    ) &&
    ["disconnected", "connected", "skipped"].includes(d.calendar?.status) &&
    ["google", "cal"].includes(d.calendar.provider) &&
    typeof d.test_passed === "boolean" &&
    Array.isArray(d.wallet_ledger) &&
    d.wallet_ledger.every(
      (x) =>
        Number.isInteger(x.amount_sen) &&
        (x.reason === "usage" ? x.amount_sen <= 0 : x.amount_sen >= 0) &&
        ["trial", "topup", "usage"].includes(x.reason),
    )
  );
};
export function stepReady(d: SetupDraft, step: number): boolean {
  switch (step) {
    case 0:
      return !!d.organization.name.trim() && !!d.location.name.trim();
    case 1:
      return (
        !!d.location.hours.trim() &&
        d.knowledge_items.every((k) => !!k.content.trim())
      );
    case 2:
      return (
        d.agent.languages.length > 0 &&
        !!d.agent.greeting.trim() &&
        (!d.agent.recording_enabled || !!d.agent.recording_disclosure.trim())
      );
    case 3:
      return d.phone_line.reserved;
    case 4:
      return d.whatsapp_channel.status !== "disconnected";
    case 5:
      return d.calendar.status !== "disconnected";
    case 6:
      return d.test_passed;
    case 7:
      return d.phone_line.verified && forwardingReady(d);
    case 8:
      return (
        d.wallet_ledger.some((l) => l.reason === "trial") &&
        Array.from({ length: 8 }, (_, i) => stepReady(d, i)).every(Boolean)
      );
    default:
      return false;
  }
}
const validSettings = (
  settings: AgentSettings | undefined,
): settings is AgentSettings =>
  !!settings &&
  typeof settings.persona === "string" &&
  typeof settings.instructions === "string" &&
  ["request", "calendar"].includes(settings.booking_mode) &&
  typeof settings.after_hours === "string" &&
  typeof settings.transfer_number === "string" &&
  typeof settings.transfer_enabled === "boolean" &&
  typeof settings.take_message === "boolean" &&
  Number.isInteger(settings.duration_minutes) &&
  Number.isInteger(settings.buffer_minutes) &&
  typeof settings.state === "string" &&
  Array.isArray(settings.weekly_hours) &&
  settings.weekly_hours.length === 7 &&
  settings.weekly_hours.every(
    (h) =>
      h &&
      typeof h.open === "boolean" &&
      typeof h.from === "string" &&
      typeof h.to === "string",
  ) &&
  Array.isArray(settings.closures) &&
  settings.closures.every(
    (c) =>
      c &&
      typeof c.id === "string" &&
      typeof c.date === "string" &&
      typeof c.label === "string",
  ) &&
  Array.isArray(settings.documents) &&
  settings.documents.every(
    (d) =>
      d &&
      typeof d.id === "string" &&
      typeof d.name === "string" &&
      typeof d.content === "string",
  );

export function readSetup(locale: Locale): SetupDraft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (valid(value)) {
        const defaults = newSetup(locale);
        // Older setup previews have no builder fields. Preserve their progress.
        const settings = value.settings;
        return {
          ...value,
          ...(settings !== undefined && !validSettings(settings)
            ? {
                test_passed: false,
                completed: false,
                completedSteps: value.completedSteps.filter((s) => s < 6),
                phone_line: { ...value.phone_line, verified: false },
              }
            : {}),
          admin: validAdmin(value.admin) ? value.admin : defaults.admin,
          extensions: validExtensions(value.extensions)
            ? value.extensions
            : defaults.extensions,
          services: validServices(value.services)
            ? value.services
            : defaults.services,
          settings: validSettings(settings) ? settings : defaults.settings,
          revisions: Array.isArray(value.revisions)
            ? value.revisions.filter(
                (r) =>
                  r &&
                  typeof r.id === "string" &&
                  Number.isInteger(r.number) &&
                  r.number > 0 &&
                  typeof r.created_at === "string" &&
                  !Number.isNaN(Date.parse(r.created_at)) &&
                  valid({
                    ...value,
                    agent: r.agent,
                    knowledge_items: r.knowledge,
                  }) &&
                  validSettings(r.settings) &&
                  typeof r.hours === "string",
              )
            : [],
        };
      }
    }
  } catch {}
  return newSetup(locale);
}

export const productApi: ProductApi = {
  async getSetup(locale) {
    return readSetup(locale);
  },
  async saveSetup(draft) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
  },
  async simulate(fail = false) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (fail) throw new Error("sample-operation-failed");
  },
  async importKnowledge(locale) {
    await productApi.simulate();
    const p = dictionary(locale);
    return {
      hours: p.sampleHours,
      services: p.sampleServices,
      faq: p.sampleFaq,
    };
  },
  testTurns(draft, locale, scenario) {
    const p = dictionary(locale),
      values = {
        name: draft.organization.name,
        hours: draft.location.hours,
        services: draft.knowledge_items[0].content,
      };
    const connected =
      draft.calendar.status === "connected" &&
      draft.settings.booking_mode === "calendar";
    const rows: [TestTurn["role"], string, TestTurn["tool"]?][] = [
      [
        "agent",
        `${template(draft.agent.greeting, values)} ${p.aiDisclosure}${draft.agent.recording_enabled ? " " + draft.agent.recording_disclosure : ""}`,
      ],
      ["caller", p.scenarioPrompts[scenario]],
      [
        "tool",
        scenario === "afterHours"
          ? draft.settings.take_message
            ? p.toolMessage
            : p.toolNoAction
          : scenario === "hours"
            ? p.toolKnowledge
            : scenario === "handoff"
              ? draft.settings.transfer_enabled
                ? p.toolHandoff
                : draft.settings.take_message
                  ? p.toolMessage
                  : p.toolNoAction
              : connected
                ? p.toolCalendar
                : p.toolMessage,
        scenario === "afterHours"
          ? "message"
          : scenario === "hours"
            ? "knowledge"
            : scenario === "handoff"
              ? "handoff"
              : connected
                ? "calendar"
                : "message",
      ],
      [
        "agent",
        scenario === "afterHours"
          ? draft.settings.after_hours
          : scenario === "hours"
            ? template(p.hoursReply, values)
            : scenario === "handoff"
              ? draft.settings.transfer_enabled
                ? p.handoffReply
                : draft.settings.take_message
                  ? p.noTransferReply
                  : p.noMessageReply
              : connected
                ? p.bookingReply
                : draft.settings.take_message
                  ? p.noCalendarReply
                  : p.noMessageReply,
      ],
      ["caller", p.callerThanks],
      [
        "tool",
        scenario === "booking" && connected
          ? p.toolBooked
          : draft.settings.take_message
            ? p.toolSaved
            : p.toolNoAction,
        scenario === "booking" && connected ? "booking" : "message",
      ],
      ["agent", p.callGoodbye],
    ];
    return rows.map(([role, text, tool], i) => ({
      id: `sample-turn-${i}`,
      role,
      text,
      tool,
      at_seconds: i * 2,
    }));
  },
  async reply(draft, locale, text) {
    await productApi.simulate();
    const p = dictionary(locale);
    if (/faq|walk.?in|services|perkhidmatan|dokumen|document/i.test(text))
      return [
        {
          id: "sample-knowledge",
          role: "tool",
          text: p.knowledgeTool,
          tool: "knowledge",
          at_seconds: 0,
        },
        {
          id: "sample-answer",
          role: "agent",
          text: /document|dokumen/i.test(text)
            ? draft.settings.documents.map((d) => d.content).join("\n") ||
              p.chatFallback
            : /services|perkhidmatan/i.test(text)
              ? draft.knowledge_items[0].content
              : draft.knowledge_items[1].content,
          at_seconds: 0,
        },
      ];
    const scenario: CallScenario | null = /after.?hours|closed|tutup/i.test(
      text,
    )
      ? "afterHours"
      : /book|appointment|tempah|janji|预约/i.test(text)
        ? "booking"
        : /hour|open|buka|waktu|几点|营业/i.test(text)
          ? "hours"
          : /person|human|staff|orang|staf|manusia|人工/i.test(text)
            ? "handoff"
            : null;
    if (!scenario)
      return [
        {
          id: "sample-reply",
          role: "agent",
          text: p.chatFallback,
          at_seconds: 0,
        },
      ];
    return productApi.testTurns(draft, locale, scenario).slice(2, 4);
  },
};
