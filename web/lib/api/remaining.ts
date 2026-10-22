import type { SetupDraft } from "./product-types";
import type { AgentSettings } from "./builder-types";
export type Health = "missing" | "ready" | "invalid";
export type Installation = {
  database: Health;
  speech: Health;
  model: Health;
  sip: Health;
  checked_at: string | null;
  completed: boolean;
};
export type Schedule = Pick<
  AgentSettings,
  "weekly_hours" | "closures" | "state"
>;
export interface ExtensionSettings {
  session: { member_id: string; method: "email" | "google" } | null;
  platform: {
    suspended: string[];
    resolved: string[];
    assignments: Record<string, string>;
  };
  installation: Installation;
  branch_hours: Record<string, Schedule>;
}
export const newExtensions = (): ExtensionSettings => ({
  session: null,
  platform: { suspended: [], resolved: [], assignments: {} },
  installation: {
    database: "ready",
    speech: "missing",
    model: "missing",
    sip: "missing",
    checked_at: null,
    completed: false,
  },
  branch_hours: {},
});
export function validExtensions(
  v: ExtensionSettings | undefined,
): v is ExtensionSettings {
  return (
    !!v &&
    (!v.session ||
      (typeof v.session.member_id === "string" &&
        ["email", "google"].includes(v.session.method))) &&
    Array.isArray(v.platform?.suspended) &&
    Array.isArray(v.platform?.resolved) &&
    !!v.platform.assignments &&
    typeof v.platform.assignments === "object" &&
    !!v.installation &&
    ["database", "speech", "model", "sip"].every((k) =>
      ["ready", "missing", "invalid"].includes(v.installation[k as "sip"]),
    ) &&
    !!v.branch_hours &&
    Object.values(v.branch_hours).every(
      (s) =>
        s &&
        typeof s.state === "string" &&
        Array.isArray(s.closures) &&
        Array.isArray(s.weekly_hours) &&
        s.weekly_hours.length === 7,
    )
  );
}
export const scheduleFor = (d: SetupDraft, id: string): Schedule =>
  id === d.location.id
    ? d.settings
    : (d.extensions.branch_hours[id] ?? d.settings);
export const installationReady = (i: Installation) =>
  (["database", "speech", "model", "sip"] as const).every(
    (k) => i[k] === "ready",
  );
