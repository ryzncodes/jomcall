// Pure rules behind the Home screen: a checklist until the agent is live,
// then one line of today's numbers and a list of what needs the owner.
// A fact left undefined means its read failed or was not made (staff do not
// read billing or phone numbers); it hides its own step or row only.
import type { Booking } from "../../../packages/contracts/src/booking";
import type { PlanSummary, Wallet } from "../../../packages/contracts/src/billing";
import type { CallSummary, Channels, PhoneNumbers } from "../../../packages/contracts/src/phone";
import type { ConversationSummary } from "../../../packages/contracts/src/whatsapp";
import type { KnowledgeGap } from "../../../packages/contracts/src/knowledge";
import type { TestSession } from "../../../packages/contracts/src/agent-test";
import type { Setup } from "../../../packages/contracts/src/setup";
import type { FirstRun } from "../../../packages/contracts/src/first-run";
import { klDate, lastGraceDay } from "./plan-rules";

export type HomeFacts = {
  manager: boolean;
  published: boolean;
  setup?: Setup;
  tests?: TestSession[];
  plan?: PlanSummary;
  wallet?: Wallet;
  phones?: PhoneNumbers;
  channels?: Channels;
  calls?: CallSummary[];
  bookingsToday?: Booking[];
  toConfirm?: Booking[];
  chats?: ConversationSummary[];
  gaps?: KnowledgeGap[];
  firstRun?: FirstRun;
};

export type StepId = "setup" | "test" | "publish" | "plan" | "phone" | "call";
export type Step = {
  id: StepId;
  state: "done" | "todo" | "waiting";
  href: string | null;
  // Plan step only: a chosen plan whose fee is unpaid (the button says pay).
  unpaid?: true;
  // Why a step has no button yet.
  hint?: "plan_first" | "number_first";
};

// What the list is worked out from: Home builds it from its own reads,
// the sidebar and setup's live page from the firstRun read. A part left
// undefined was not read (staff) or failed; its step is left out.
export type ChecklistFacts = {
  manager: boolean;
  published: boolean;
  setupApplied?: boolean;
  tested?: boolean;
  plan?: FirstRun["plan"];
  phone?: FirstRun["phone"];
  firstCall?: FirstRun["firstCall"];
};

// The phone line is offered when the service has telephony configured.
function phoneOffered(f: HomeFacts) {
  return !!f.phones?.provider.configured || !!f.channels?.phone;
}
// A paid plan with a started period. Pay as you go is where every
// workspace starts, and the plan card reads it as "choose a plan"; an
// unpaid fee is its own row in the needs list once live.
function planChosen(p: PlanSummary) {
  return p.plan !== "payg" && (p.periodState === "free" || p.periodState === "charged");
}

export function checklistFacts(f: HomeFacts): ChecklistFacts {
  const active = f.phones?.items.find((n) => n.active);
  return {
    manager: f.manager,
    published: f.published,
    setupApplied: f.setup?.session?.state === "applied",
    tested: !!f.tests?.length,
    ...(f.plan
      ? { plan: { chosen: planChosen(f.plan), unpaid: f.plan.periodState === "unpaid" } }
      : {}),
    ...(f.phones
      ? {
          phone: {
            offered: phoneOffered(f),
            active: !!active,
            activeE164: active?.e164 ?? null,
            requestOpen: f.phones.request?.state === "open",
            planIncludesNumber: f.phones.planIncludesNumber,
          },
        }
      : {}),
    ...(f.firstRun ? { firstCall: f.firstRun.firstCall } : {}),
  };
}

export function stepsFrom(c: ChecklistFacts): Step[] {
  const link = (href: string) => (c.manager ? href : null);
  const done = (ok: boolean) => (ok ? "done" : "todo") as Step["state"];
  const steps: Step[] = [
    { id: "setup", state: done(c.published || !!c.setupApplied), href: link("/app/setup") },
    { id: "test", state: done(!!c.tested), href: link("/app/test") },
    { id: "publish", state: done(c.published), href: link("/app/agent") },
  ];
  if (!c.manager) return steps;
  if (c.plan)
    steps.push({
      id: "plan",
      state: done(c.plan.chosen),
      href: "/app/billing",
      ...(c.plan.unpaid ? { unpaid: true as const } : {}),
    });
  const phone = c.phone;
  if (phone?.offered) {
    steps.push(
      !phone.active && phone.requestOpen
        ? { id: "phone", state: "waiting", href: null }
        : phone.active
          ? { id: "phone", state: "done", href: "/app/phone-numbers" }
          : // Asking for a number is refused without a plan that includes
            // one, so the button waits for the plan step.
            phone.planIncludesNumber
            ? { id: "phone", state: "todo", href: "/app/phone-numbers" }
            : { id: "phone", state: "todo", href: null, hint: "plan_first" },
    );
    // Forwarding cannot be seen; the first answered real call is the sign.
    if (c.firstCall !== undefined)
      steps.push(
        c.firstCall
          ? { id: "call", state: "done", href: null }
          : phone.active
            ? { id: "call", state: "todo", href: "/app/phone-numbers" }
            : { id: "call", state: "todo", href: null, hint: "number_first" },
      );
  }
  return steps;
}

export const checklist = (f: HomeFacts): Step[] => stepsFrom(checklistFacts(f));

// Live: published, a chosen plan (nothing is answered without one), plus an
// active number and a first answered call when a phone line is offered.
// Staff cannot read billing or phone numbers, and a failed read cannot
// tell, so those checks are skipped.
export function liveFrom(c: ChecklistFacts): boolean {
  if (!c.published) return false;
  if (c.manager && c.plan && !c.plan.chosen) return false;
  if (!c.manager || !c.phone || !c.phone.offered) return true;
  if (!c.phone.active) return false;
  return c.firstCall === undefined || !!c.firstCall;
}

export const isLive = (f: HomeFacts): boolean => liveFrom(checklistFacts(f));

// Kuala Lumpur has no daylight saving: its day starts at 16:00 UTC.
export function klDayRange(now: Date): { from: string; to: string } {
  const from = new Date(`${klDate(now)}T00:00:00+08:00`);
  return {
    from: from.toISOString(),
    to: new Date(from.getTime() + 86_400_000).toISOString(),
  };
}

export function todayCounts(f: HomeFacts, now: Date) {
  const day = klDate(now);
  const today = f.calls?.filter((c) => klDate(new Date(c.started_at)) === day);
  return {
    calls: today ? today.length : null,
    missed: today ? today.filter((c) => c.state === "refused").length : null,
    bookings: f.bookingsToday ? f.bookingsToday.length : null,
    balanceSen: f.manager && f.wallet ? f.wallet.balanceSen : null,
  };
}

export type NeedId =
  | "wallet_exhausted"
  | "wallet_grace"
  | "plan_unpaid"
  | "wallet_low"
  | "bookings"
  | "chats"
  | "gaps";
export type Need = { id: NeedId; count: number; href: string; date?: string };

// Billing first, then customers waiting, then knowledge gaps.
export function needsYou(f: HomeFacts): Need[] {
  const out: Need[] = [];
  if (f.manager) {
    const state = f.wallet?.state;
    if (state === "exhausted" || state === "grace")
      out.push({ id: `wallet_${state}`, count: 1, href: "/app/billing" });
    if (f.plan?.periodState === "unpaid")
      out.push({
        id: "plan_unpaid",
        count: 1,
        href: "/app/billing",
        // The last day to pay, as the plan card and the email show it.
        ...(f.plan.graceUntil ? { date: lastGraceDay(f.plan.graceUntil) } : {}),
      });
    if (state === "low")
      out.push({ id: "wallet_low", count: 1, href: "/app/billing" });
  }
  const add = (id: NeedId, list: unknown[] | undefined, href: string) => {
    if (list?.length) out.push({ id, count: list.length, href });
  };
  add("bookings", f.toConfirm, "/app/bookings");
  add("chats", f.chats, "/app/inbox");
  add("gaps", f.gaps, "/app/agent#questions");
  return out;
}

const FETCHED = [
  "setup",
  "tests",
  "plan",
  "wallet",
  "phones",
  "channels",
  "calls",
  "bookingsToday",
  "toConfirm",
  "chats",
  "gaps",
  "firstRun",
] as const;

export function homeState(f: HomeFacts): "failed" | "checklist" | "today" {
  if (FETCHED.every((k) => f[k] === undefined)) return "failed";
  return isLive(f) ? "today" : "checklist";
}

// Home reloads every 15 seconds. A read that fails once keeps its last good
// value, so one dropped request does not flip the checklist and Today or hide
// billing rows. A change of viewer role starts again from the new reads.
export function keepLastGood(prev: HomeFacts | undefined, next: HomeFacts): HomeFacts {
  if (!prev || prev.manager !== next.manager) return next;
  const out: HomeFacts = { ...next };
  for (const k of FETCHED)
    if (out[k] === undefined && prev[k] !== undefined)
      (out as Record<string, unknown>)[k] = prev[k];
  return out;
}
