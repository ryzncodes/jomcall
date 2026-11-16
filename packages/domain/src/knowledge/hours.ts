// Every branch's opening hours as prompt lines. Pure: the loader and the
// freeze step live elsewhere.
import { days, line } from "./prompt.ts";

export type FrozenHours = {
  locationId: string;
  name: string;
  main: boolean;
  // null means no schedule was saved for the branch.
  weekdays: { start: string; end: string }[][] | null;
  closures: { date: string; reason: string }[];
};

export const hoursBudget = (inputBudget: number) => (inputBudget <= 6000 ? 400 : 1500);

const header = "Opening hours (Asia/Kuala_Lumpur time):";
const bytes = (lines: string[]) => Buffer.byteLength(lines.join("\n"));

function branchLine(h: FrozenHours, closures: FrozenHours["closures"]): string {
  const label = `- ${line(h.name, 120)}${h.main ? " (main branch)" : ""}: `;
  if (!h.weekdays) return label + "hours not set";
  // weekdays[0] is Monday.
  const week = h.weekdays
    .map((intervals, i) => `${days[i]} ${intervals.length ? intervals.map((x) => `${x.start}-${x.end}`).join(", ") : "closed"}`)
    .join("; ");
  const closed = closures.map((c) => (c.reason ? `${c.date} (${line(c.reason, 80)})` : c.date)).join(", ");
  return label + week + (closed ? `. Closed on: ${closed}` : "");
}

export function renderHoursBlock(hours: FrozenHours[], maxBytes: number): string[] {
  if (!hours.length) return [];
  const out = [header];
  const sorted = (h: FrozenHours) => h.closures.slice().sort((a, b) => a.date.localeCompare(b.date));
  // The first branch is always written; drop its latest closed dates until it fits.
  const first = hours[0];
  let closures = sorted(first);
  let text = branchLine(first, closures);
  while (closures.length && bytes([...out, text]) > maxBytes) {
    closures = closures.slice(0, -1);
    text = branchLine(first, closures);
  }
  out.push(text);
  let i = 1;
  for (; i < hours.length; i++) {
    const next = branchLine(hours[i], sorted(hours[i]));
    if (bytes([...out, next]) > maxBytes) break;
    out.push(next);
  }
  const rest = hours.slice(i);
  if (rest.length)
    out.push(`Other branches (hours on request from staff): ${rest.map((h) => line(h.name, 120)).join(", ")}`);
  return out;
}
