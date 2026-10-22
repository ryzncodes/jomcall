export type Locale = "en" | "ms";
export type Outcome = 0 | 1 | 2 | 3;
export interface Contact {
  id: string;
  org_id: string;
  name: string;
  phone_e164: null;
  do_not_contact: boolean;
}
export interface Call {
  recording_preview?: boolean;
  transfer_result?: "connected" | "unavailable" | "not_requested";
  entry_point?: "direct" | "forwarded_missed";
  id: string;
  org_id: string;
  contact_id: string;
  agent_version_id: string;
  direction: "inbound" | "outbound";
  location_id?: string;
  phone_line_id?: string;
  started_at: string;
  duration_seconds: number;
  cost_sen: number;
  language: string;
  outcome: Outcome;
}
export interface WorkspaceSnapshot {
  organization: { id: string; name: string };
  contacts: Contact[];
  calls: Call[];
}
export interface ApiClient {
  listActivity(): Promise<WorkspaceSnapshot>;
}
