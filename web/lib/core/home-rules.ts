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
};

export type StepId = "setup" | "test" | "publish" | "plan" | "phone";
export type Step = {
  id: StepId;
  state: "done" | "todo" | "waiting";
  href: string | null;
};

// The phone line is offered when the service has telephony configured.
function phoneOffered(f: HomeFacts) {
  return !!f.phones?.provider.configured || !!f.channels?.phone;
}
const activeNumber = (f: HomeFacts) => !!f.phones?.items.some((n) => n.active);
// A paid plan with a started period. Pay as you go is where every
// workspace starts, and the plan card reads it as "choose a plan"; an
// unpaid fee is its own row in the needs list once live.
function planChosen(p: PlanSummary) {
  return p.plan !== "payg" && (p.periodState === "free" || p.periodState === "charged");
}

export function checklist(f: HomeFacts): Step[] {
  const link = (href: string) => (f.manager ? href : null);
  const done = (ok: boolean) => (ok ? "done" : "todo") as Step["state"];
  const steps: Step[] = [
    {
      id: "setup",
      state: done(f.published || f.setup?.session?.state === "applied"),
      href: link("/app/setup"),
    },
    { id: "test", state: done(!!f.tests?.length), href: link("/app/test") },
    { id: "publish", state: done(f.published), href: link("/app/agent") },
  ];
  if (!f.manager) return steps;
  if (f.plan) {
    steps.push({ id: "plan", state: done(planChosen(f.plan)), href: "/app/billing" });
  }
  if (f.phones && phoneOffered(f)) {
    const waiting = !activeNumber(f) && f.phones.request?.state === "open";
    steps.push(
      waiting
        ? { id: "phone", state: "waiting", href: null }
        : {
            id: "phone",
            state: done(activeNumber(f)),
            // Asking for a number is refused without a plan that includes
            // one, so the button waits for the plan step.
            href: f.phones.planIncludesNumber ? "/app/phones" : null,
          },
    );
  }
  return steps;
}

// Live: published, a chosen plan (nothing is answered without one), plus an
// active number when a phone line is offered. Staff cannot read billing or
// phone numbers, and a failed read cannot tell, so those checks are skipped.
export function isLive(f: HomeFacts): boolean {
  if (!f.published) return false;
  if (f.manager && f.plan && !planChosen(f.plan)) return false;
  if (!f.manager || !f.phones || !phoneOffered(f)) return true;
  return activeNumber(f);
}

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
] as const;

export function homeState(f: HomeFacts): "failed" | "checklist" | "today" {
  if (FETCHED.every((k) => f[k] === undefined)) return "failed";
  return isLive(f) ? "today" : "checklist";
}
