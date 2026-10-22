import type { AdminSettings } from "./admin";
import type { ServiceSettings } from "./service";
import type { Locale } from "./types";
import type { AgentSettings, AgentRevision } from "./builder-types";
export type BusinessType =
  | "salon"
  | "clinic"
  | "dental"
  | "workshop"
  | "property"
  | "education"
  | "retail"
  | "hospitality"
  | "professional"
  | "other";
export type VoiceStyle = "warm" | "clear" | "measured";
export type ConnectionStatus = "disconnected" | "connected" | "skipped";
export type CallScenario = "booking" | "hours" | "handoff" | "afterHours";
export type CallFault = "none" | "permission" | "connection" | "timeout";
export type CallState =
  "idle" | "permission" | "connecting" | "live" | "ended" | "error";
import type { ExtensionSettings } from "./remaining";
export interface SetupDraft {
  extensions: ExtensionSettings;
  schema: 1;
  admin: AdminSettings;
  services: ServiceSettings;
  settings: AgentSettings;
  revisions: AgentRevision[];
  step: number;
  completedSteps: number[];
  completed: boolean;
  organization: { id: string; name: string; business_type: BusinessType };
  location: {
    id: string;
    org_id: string;
    name: string;
    hours: string;
    timezone: "Asia/Kuala_Lumpur";
  };
  source_url: string;
  knowledge_items: {
    id: string;
    org_id: string;
    kind: "services" | "faq";
    content: string;
  }[];
  agent: {
    id: string;
    org_id: string;
    version_id: string;
    languages: string[];
    voice: VoiceStyle;
    greeting: string;
    recording_enabled: boolean;
    recording_disclosure: string;
  };
  phone_line: {
    id: string;
    org_id: string;
    location_id: string;
    agent_id: string;
    phone_e164: null;
    reserved: boolean;
    forwarding_mode: "missed" | "always";
    telco: "Maxis" | "CelcomDigi" | "U Mobile" | "Unifi";
    verified: boolean;
  };
  whatsapp_channel: {
    id: string;
    org_id: string;
    provider: "cloud";
    status: ConnectionStatus;
  };
  calendar: { provider: "google" | "cal"; status: ConnectionStatus };
  test_passed: boolean;
  wallet_ledger: {
    id: string;
    org_id: string;
    amount_sen: number;
    reason: "trial" | "topup" | "usage";
    created_at?: string;
    method?: "fpx" | "duitnow" | "mock";
  }[];
}
export interface TestTurn {
  id: string;
  role: "agent" | "caller" | "tool";
  text: string;
  at_seconds: number;
  tool?: "knowledge" | "calendar" | "booking" | "handoff" | "message";
}
export interface ProductApi {
  getSetup(locale: Locale): Promise<SetupDraft>;
  saveSetup(draft: SetupDraft): Promise<boolean>;
  simulate(fail?: boolean): Promise<void>;
  importKnowledge(
    locale: Locale,
  ): Promise<{ hours: string; services: string; faq: string }>;
  testTurns(
    draft: SetupDraft,
    locale: Locale,
    scenario: CallScenario,
  ): TestTurn[];
  reply(draft: SetupDraft, locale: Locale, text: string): Promise<TestTurn[]>;
}
