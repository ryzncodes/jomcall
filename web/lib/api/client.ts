import type { ApiClient, Call, WorkspaceSnapshot } from "./types";
const records: [string, number, number, string, Call["outcome"]][] = [
  ["02:42", 154, 82, "BM", 0],
  ["02:18", 108, 58, "EN", 1],
  ["01:56", 72, 39, "中文", 2],
  ["01:34", 191, 103, "BM", 0],
  ["01:12", 95, 51, "EN", 3],
  ["00:48", 122, 66, "BM", 2],
];
const fixture: WorkspaceSnapshot = {
  organization: { id: "sample-org", name: "Studio Contoh" },
  contacts: records.map((_, i) => ({
    id: `sample-contact-${i}`,
    org_id: "sample-org",
    name: `Pelanggan Contoh ${String.fromCharCode(65 + i)}`,
    phone_e164: null,
    do_not_contact: false,
  })),
  calls: records.map(([clock, duration, sen, language, outcome], i) => ({
    id: `sample-call-${i}`,
    recording_preview: true,
    transfer_result: i === 1 ? "unavailable" : "not_requested",
    entry_point: i % 2 === 0 ? "forwarded_missed" : "direct",
    org_id: "sample-org",
    contact_id: `sample-contact-${i}`,
    agent_version_id: "sample-version-1",
    direction: "inbound",
    location_id: "sample-location",
    phone_line_id: "sample-line",
    started_at: `2026-10-15T${clock}:00Z`,
    duration_seconds: duration,
    cost_sen: sen,
    language,
    outcome,
  })),
};
// Replace this adapter with the real transport. Screens depend on this interface only.
export const api: ApiClient = {
  async listActivity() {
    return structuredClone(fixture);
  },
};
export const previewActivity = () => structuredClone(fixture);
export const money = (sen: number) =>
  `RM ${new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sen / 100)}`;
export const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
export const duration = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
