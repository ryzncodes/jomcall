// Words on the Home screen, kept apart from the component so tests can read
// them. `w` picks English or Bahasa Melayu.
import { formatSen } from "../../../../packages/billing/src/money";
import type { Need, todayCounts } from "../../../lib/core/home-rules";
import { dayText } from "../../../lib/core/plan-rules";

export type W = (en: string, ms: string) => string;

// English needs a singular for one; Bahasa Melayu does not change the noun.
const count = (n: number, one: string, many: string, ms: string, w: W) =>
  w(`${n} ${n === 1 ? one : many}`, `${n} ${ms}`);

export function todayParts(
  c: ReturnType<typeof todayCounts>,
  w: W,
): { text: string; label?: string }[] {
  const out: { text: string; label?: string }[] = [];
  if (c.calls !== null) out.push({ text: count(c.calls, "call", "calls", "panggilan", w) });
  if (c.missed !== null) out.push({ text: w(`${c.missed} not answered`, `${c.missed} tidak dijawab`) });
  if (c.bookings !== null) out.push({ text: count(c.bookings, "booking", "bookings", "tempahan", w) });
  if (c.balanceSen !== null)
    out.push({ text: formatSen(c.balanceSen), label: w("Wallet", "Dompet") });
  return out;
}

export function needText(n: Need, w: W, balanceSen: number | null) {
  const rm = balanceSen === null ? "" : formatSen(balanceSen);
  switch (n.id) {
    case "wallet_exhausted":
      return w("Wallet empty: calls are not answered", "Dompet kosong: panggilan tidak dijawab");
    case "wallet_grace":
      return w("Wallet below zero: top up soon", "Baki dompet di bawah sifar: tambah nilai segera");
    case "plan_unpaid":
      return n.date
        ? w(`Plan fee unpaid: pay by ${dayText(n.date, false)}`, `Yuran pelan belum dibayar: bayar sebelum ${dayText(n.date, true)}`)
        : w("Plan fee unpaid", "Yuran pelan belum dibayar");
    case "wallet_low":
      return w(`Wallet low: ${rm}`, `Baki dompet rendah: ${rm}`);
    case "bookings":
      return w(
        `${n.count} ${n.count === 1 ? "booking" : "bookings"} to confirm`,
        `${n.count} tempahan perlu disahkan`,
      );
    case "chats":
      return w(
        `${n.count} WhatsApp ${n.count === 1 ? "chat" : "chats"} waiting for you`,
        `${n.count} sembang WhatsApp menunggu anda`,
      );
    case "gaps":
      return w(
        `${n.count} ${n.count === 1 ? "question" : "questions"} the agent could not answer`,
        `${n.count} soalan yang ejen tidak dapat jawab`,
      );
  }
}
