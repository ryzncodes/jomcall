import type { CrmData, ConnectorId } from "./crm";
import type { SetupDraft } from "./product-types";
import { channelReady, walletBalance } from "./service";
import { makeEvent } from "./inbox";
export type StepKind = "wait" | "condition" | "whatsapp" | "call";
export type WorkflowStep = {
  id: string;
  kind: StepKind;
  minutes: number;
  template_id: string;
};
export type WorkflowRevision = {
  id: string;
  org_id: string;
  number: number;
  at: string;
  steps: WorkflowStep[];
  source: ConnectorId | "manual";
  reentry: boolean;
  quiet_from: string;
  quiet_to: string;
};
export type WorkflowRun = {
  id: string;
  org_id: string;
  contact_id: string;
  revision_id: string;
  step: number;
  state: "active" | "waiting" | "review" | "complete" | "stopped";
  created_at: string;
  advanced_at?: string;
  next_at: string | null;
  event_id: string | null;
  reason: RunReason | null;
};
export type RunReason =
  | "consent"
  | "quiet"
  | "channel"
  | "template"
  | "engagement"
  | "funds"
  | "duplicate"
  | "source"
  | "paused"
  | "unpublished"
  | "deleted"
  | "waiting"
  | "unclear";
export interface OutboundData {
  draft: Omit<WorkflowRevision, "id" | "org_id" | "number" | "at">;
  revisions: WorkflowRevision[];
  runs: WorkflowRun[];
}
export const newOutbound = (): OutboundData => ({
  draft: {
    source: "manual",
    reentry: false,
    quiet_from: "20:00",
    quiet_to: "09:00",
    steps: [
      {
        id: "sample-step-message",
        kind: "whatsapp",
        minutes: 30,
        template_id: "sample-template-followup",
      },
      { id: "sample-step-wait", kind: "wait", minutes: 30, template_id: "" },
      {
        id: "sample-step-condition",
        kind: "condition",
        minutes: 30,
        template_id: "",
      },
      { id: "sample-step-call", kind: "call", minutes: 30, template_id: "" },
    ],
  },
  revisions: [],
  runs: [],
});
export function validOutbound(v: OutboundData | undefined): v is OutboundData {
  return (
    !!v &&
    Array.isArray(v.draft?.steps) &&
    v.draft.steps.every(
      (s) => s && ["wait", "condition", "whatsapp", "call"].includes(s.kind),
    ) &&
    Array.isArray(v.revisions) &&
    Array.isArray(v.runs)
  );
}
export const timeValid = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export function publishable(o: OutboundData, d: SetupDraft) {
  return (
    o.draft.steps.length > 0 &&
    o.draft.steps.length <= 12 &&
    timeValid(o.draft.quiet_from) &&
    timeValid(o.draft.quiet_to) &&
    o.draft.quiet_from !== o.draft.quiet_to &&
    o.draft.steps.every((s) =>
      s.kind === "wait"
        ? Number.isInteger(s.minutes) && s.minutes >= 1 && s.minutes <= 10080
        : s.kind === "whatsapp"
          ? d.services.templates.some(
              (t) => t.id === s.template_id && t.status === "approved",
            )
          : true,
    )
  );
}
export function publishWorkflow(o: OutboundData, d: SetupDraft): OutboundData {
  if (!publishable(o, d)) return o;
  return {
    ...o,
    revisions: [
      ...o.revisions,
      {
        ...structuredClone(o.draft),
        id: crypto.randomUUID(),
        org_id: d.organization.id,
        number: o.revisions.length + 1,
        at: new Date().toISOString(),
      },
    ],
  };
}
export function enrollReason(
  c: CrmData,
  d: SetupDraft,
  id: string,
): RunReason | null {
  const r = c.outbound.revisions.at(-1),
    p = c.contacts.find((x) => x.id === id);
  if (!r) return "unpublished";
  if (!p) return "deleted";
  if (d.extensions.platform.suspended.includes(d.organization.id))
    return "paused";
  if (!p.opt_in || p.do_not_contact) return "consent";
  if (
    r.source !== "manual" &&
    (!c.connectors.some((x) => x.id === r.source && x.status === "connected") ||
      p.lead_source !== r.source)
  )
    return "source";
  if (
    c.outbound.runs.some(
      (x) =>
        x.contact_id === id &&
        (!r.reentry || !["complete", "stopped"].includes(x.state)),
    )
  )
    return "duplicate";
  return null;
}
export function enroll(
  c: CrmData,
  d: SetupDraft,
  id: string,
  at = new Date().toISOString(),
): CrmData {
  if (enrollReason(c, d, id)) return c;
  return {
    ...c,
    outbound: {
      ...c.outbound,
      runs: [
        ...c.outbound.runs,
        {
          id: crypto.randomUUID(),
          org_id: d.organization.id,
          contact_id: id,
          revision_id: c.outbound.revisions.at(-1)!.id,
          step: 0,
          state: "active",
          created_at: at,
          next_at: null,
          event_id: null,
          reason: null,
        },
      ],
    },
  };
}
export function inQuietHours(at: string, from: string, to: string) {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
  return from < to ? clock >= from && clock < to : clock >= from || clock < to;
}
export function advance(
  c: CrmData,
  d: SetupDraft,
  id: string,
  at: string,
  outcome: "delivered" | "unknown",
  body: string,
): CrmData {
  const run = c.outbound.runs.find((r) => r.id === id);
  if (
    !run ||
    Date.parse(at) < Date.parse(run.created_at) ||
    ["review", "complete", "stopped"].includes(run.state) ||
    isNaN(Date.parse(at))
  )
    return c;
  const rev = c.outbound.revisions.find((r) => r.id === run.revision_id),
    contact = c.contacts.find((p) => p.id === run.contact_id);
  if (!rev) return c;
  let next = { ...run },
    contacts = c.contacts,
    calls = c.calls;
  const stop = (reason: RunReason) => {
    next = { ...next, state: "stopped", reason };
  };
  const block = (reason: RunReason) => {
    next = { ...next, state: "waiting", reason };
  };
  const step = rev.steps[run.step];
  if (!contact) stop("deleted");
  else if (!contact.opt_in || contact.do_not_contact) stop("consent");
  else if (d.extensions.platform.suspended.includes(d.organization.id))
    block("paused");
  else if (run.advanced_at && Date.parse(at) < Date.parse(run.advanced_at))
    block("waiting");
  else if (!step) next = { ...next, state: "complete", reason: null };
  else if (run.next_at && Date.parse(at) < Date.parse(run.next_at))
    block("waiting");
  else if (step.kind === "wait" && !run.next_at)
    next = {
      ...next,
      state: "waiting",
      reason: "waiting",
      advanced_at: at,
      next_at: new Date(Date.parse(at) + step.minutes * 60000).toISOString(),
    };
  else if (
    (step.kind === "condition" || step.kind === "call") &&
    (Date.parse(contact.last_inbound_at) <= Date.parse(run.created_at) ||
      Date.parse(contact.last_inbound_at) > Date.parse(at))
  )
    block("engagement");
  else if (
    (step.kind === "call" || step.kind === "whatsapp") &&
    inQuietHours(at, rev.quiet_from, rev.quiet_to)
  )
    block("quiet");
  else if (step.kind === "whatsapp" && !channelReady(d)) block("channel");
  else if (step.kind === "call" && (!d.phone_line.verified || !d.test_passed))
    block("channel");
  else if (
    step.kind === "whatsapp" &&
    !d.services.templates.some(
      (t) => t.id === step.template_id && t.status === "approved",
    )
  )
    block("template");
  else if (
    (step.kind === "whatsapp" || step.kind === "call") &&
    contact.events.some(
      (e) => e.delivery === "unknown" || e.delivery === "sending",
    )
  )
    block("unclear");
  else if (
    (step.kind === "whatsapp" || step.kind === "call") &&
    walletBalance(d) < (step.kind === "call" ? 32 : 5)
  )
    block("funds");
  else {
    next.advanced_at = at;
    if (step.kind === "whatsapp" || step.kind === "call") {
      const eventId = `workflow-${run.id}-${run.step}`,
        event = makeEvent(
          step.kind === "call" ? "phone" : "message",
          "team",
          step.kind === "whatsapp"
            ? d.services.templates.find((t) => t.id === step.template_id)!.body
            : body,
          {
            id: eventId,
            at,
            delivery: outcome,
            template: step.kind === "whatsapp",
            template_id: step.template_id,
            ...(step.kind === "call"
              ? {
                  call_snapshot: {
                    agent_version_id: d.agent.version_id,
                    location_id: d.phone_line.location_id,
                    phone_line_id: d.phone_line.id,
                    language: contact.language,
                  },
                }
              : {}),
          },
        );
      contacts = c.contacts.map((p) =>
        p.id === contact.id
          ? {
              ...p,
              events: [...p.events.filter((e) => e.id !== eventId), event],
            }
          : p,
      );
      if (
        step.kind === "call" &&
        outcome === "delivered" &&
        !calls.some((x) => x.id === eventId)
      )
        calls = [
          ...calls,
          {
            id: eventId,
            org_id: d.organization.id,
            contact_id: contact.id,
            agent_version_id: d.agent.version_id,
            direction: "outbound",
            started_at: at,
            duration_seconds: 60,
            cost_sen: 32,
            language: contact.language,
            outcome: 2,
            location_id: d.phone_line.location_id,
            phone_line_id: d.phone_line.id,
          },
        ];
      next.event_id = eventId;
    }
    next =
      (step.kind === "whatsapp" || step.kind === "call") &&
      outcome === "unknown"
        ? { ...next, state: "review", reason: "unclear" }
        : {
            ...next,
            step: run.step + 1,
            next_at: null,
            state: run.step + 1 >= rev.steps.length ? "complete" : "active",
            reason: null,
          };
  }
  return {
    ...c,
    contacts,
    calls,
    outbound: {
      ...c.outbound,
      runs: c.outbound.runs.map((r) => (r.id === id ? next : r)),
    },
  };
}
export function resolveRun(
  c: CrmData,
  id: string,
  delivered: boolean,
  at: string,
  d: SetupDraft,
): CrmData {
  const r = c.outbound.runs.find((x) => x.id === id);
  if (!r || r.state !== "review" || !r.event_id) return c;
  const rev = c.outbound.revisions.find((x) => x.id === r.revision_id)!;
  const step = rev.steps[r.step];
  const contact = c.contacts.find((p) => p.id === r.contact_id);
  if (!contact) return c;
  const attempt = contact.events.find((e) => e.id === r.event_id);
  let calls = c.calls;
  if (
    delivered &&
    step.kind === "call" &&
    !calls.some((x) => x.id === r.event_id)
  )
    calls = [
      ...calls,
      {
        id: r.event_id,
        org_id: d.organization.id,
        contact_id: r.contact_id,
        agent_version_id: d.agent.version_id,
        direction: "outbound",
        started_at: attempt?.at ?? at,
        duration_seconds: 60,
        cost_sen: 32,
        language: contact.language,
        outcome: 2,
        location_id: d.phone_line.location_id,
        phone_line_id: d.phone_line.id,
        ...attempt?.call_snapshot,
      },
    ];
  return {
    ...c,
    calls,
    contacts: c.contacts.map((p) =>
      p.id === r.contact_id
        ? {
            ...p,
            events: p.events.map((e) =>
              e.id === r.event_id
                ? { ...e, delivery: delivered ? "delivered" : "failed" }
                : e,
            ),
          }
        : p,
    ),
    outbound: {
      ...c.outbound,
      runs: c.outbound.runs.map((x) =>
        x.id === id
          ? {
              ...x,
              step: x.step + 1,
              next_at: null,
              state: delivered
                ? x.step + 1 >= rev.steps.length
                  ? "complete"
                  : "active"
                : "stopped",
              reason: null,
            }
          : x,
      ),
    },
  };
}
