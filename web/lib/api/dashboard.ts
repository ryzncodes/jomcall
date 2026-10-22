import type { SetupDraft } from "./product-types";
import { klDay, type CrmData } from "./crm";
import { channelReady, walletBalance } from "./service";
export function dashboardData(d: SetupDraft, c: CrmData, day: string) {
  const calls = c.calls.filter((x) => klDay(new Date(x.started_at)) === day);
  const bookings = c.bookings.filter(
    (x) => klDay(new Date(x.start_at)) === day && x.status !== "cancelled",
  );
  const usage = d.wallet_ledger.filter(
    (x) =>
      x.reason === "usage" &&
      x.created_at &&
      klDay(new Date(x.created_at)) === day,
  );
  const inbound = calls.filter((x) => x.direction === "inbound");
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: inbound.filter(
      (x) =>
        Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kuala_Lumpur",
            hour: "2-digit",
            hourCycle: "h23",
          }).format(new Date(x.started_at)),
        ) === hour,
    ).length,
  }));
  const alerts: {
    kind:
      | "handoff"
      | "delivery"
      | "calendar"
      | "channel"
      | "phone"
      | "balance"
      | "payment";
    count: number;
    href: string;
  }[] = [];
  const handoff = c.contacts.filter(
    (x) => x.status !== "resolved" && x.owner === "staff",
  );
  if (handoff.length)
    alerts.push({
      kind: "handoff",
      count: handoff.length,
      href: `/app/inbox?contact=${handoff[0].id}`,
    });
  const uncertain = c.contacts.filter((x) =>
    x.events.some((e) => e.delivery === "unknown"),
  );
  if (uncertain.length)
    alerts.push({
      kind: "delivery",
      count: uncertain.length,
      href: `/app/inbox?contact=${uncertain[0].id}`,
    });
  if (
    c.bookings.some((x) => x.status === "requested") &&
    d.calendar.status !== "connected"
  )
    alerts.push({
      kind: "calendar",
      count: c.bookings.filter((x) => x.status === "requested").length,
      href: "/app/integrations",
    });
  if (!channelReady(d))
    alerts.push({ kind: "channel", count: 1, href: "/app/whatsapp" });
  if (!d.phone_line.verified)
    alerts.push({ kind: "phone", count: 1, href: "/app/phone-numbers" });
  if (walletBalance(d) < 1000)
    alerts.push({ kind: "balance", count: 1, href: "/app/billing" });
  if (d.services.payments.some((x) => x.status === "unknown"))
    alerts.push({ kind: "payment", count: 1, href: "/app/billing" });
  return {
    calls,
    inbound,
    bookings,
    hours,
    alerts,
    recovered: inbound.filter((x) => x.entry_point === "forwarded_missed")
      .length,
    spend: Math.max(0, -usage.reduce((n, x) => n + x.amount_sen, 0)),
    balance: walletBalance(d),
    confirmed: bookings.filter((x) => x.status === "confirmed").length,
  };
}
