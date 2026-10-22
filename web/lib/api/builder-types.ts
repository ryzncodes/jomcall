import type { SetupDraft } from "./product-types";
export interface AgentSettings {
  persona: string;
  instructions: string;
  booking_mode: "request" | "calendar";
  duration_minutes: number;
  buffer_minutes: number;
  transfer_enabled: boolean;
  transfer_number: string;
  take_message: boolean;
  after_hours: string;
  state: string;
  weekly_hours: { open: boolean; from: string; to: string }[];
  closures: { id: string; date: string; label: string }[];
  documents: { id: string; name: string; content: string }[];
}
export interface AgentRevision {
  id: string;
  number: number;
  created_at: string;
  agent: SetupDraft["agent"];
  settings: AgentSettings;
  hours: string;
  knowledge: SetupDraft["knowledge_items"];
}
export const businessTypes = [
  "salon",
  "clinic",
  "dental",
  "workshop",
  "property",
  "education",
  "retail",
  "hospitality",
  "professional",
  "other",
] as const;
export const malaysiaStates = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "Kuala Lumpur",
  "Labuan",
  "Putrajaya",
];
