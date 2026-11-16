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

const otherPrefix = "Other branches (hours on request from staff): ";
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
    // Keep room for the shortest form of the "Other branches" line.
    const left = hours.length - i - 1;
    if (bytes([...out, next, ...(left ? [otherPrefix + `${left} more`] : [])]) > maxBytes) break;
    out.push(next);
  }
  const rest = hours.slice(i);
  if (rest.length) {
    const prefix = otherPrefix;
    const names = rest.map((h) => line(h.name, 120));
    const build = (k: number) =>
      prefix + (k ? names.slice(0, k).join(", ") : "") + (k < names.length ? `${k ? " and " : ""}${names.length - k} more` : "");
    // Name as many as fit inside the cap; when none fit the short count line is written anyway.
    let k = names.length;
    while (k > 0 && bytes([...out, build(k)]) > maxBytes) k--;
    out.push(build(k));
  }
  return out;
}
