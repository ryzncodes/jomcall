import { turnInput, type TestTurn, type Readiness } from "./agent-test.ts";
import { proposalApply } from "./agent-test.ts";
import {
  testStart,
  revisionInput,
  type TestSession,
  type SessionDetail,
  type KnowledgeHit,
} from "./agent-test.ts";
import {
  bookingInput,
  bookingRevision,
  bookingReschedule,
  bookingList,
  type Booking,
} from "./booking.ts";
import {
  resourceCreate,
  resourceUpdate,
  slotsInput,
  type Resource,
  type Slot,
} from "./booking.ts";
import { z } from "zod";
import { uuid, name, organizationInput, type Role } from "./index.ts";
import { agentSettings, knowledgeInput, scheduleInput } from "./agent.ts";
import {
  contactInput,
  contactUpdate,
  noteInput,
  consentInput,
  dncInput,
} from "./contacts.ts";
export type Mode = "mock" | "local";
export function parseMode(value?: string): Mode {
  if (value === undefined) return "mock";
  if (value !== "mock" && value !== "local") throw Error("INVALID_MODE");
  return value;
}
export const capabilitiesFor = (mode: Mode) => ({
  coreRead: true,
  coreWrite: true,
  whatsappSend: mode === "mock",
  voiceCall: mode === "mock",
  calendarWrite: mode === "mock",
  bookingLocal: true,
  calendarExternalWrite: mode === "mock",
  agentTextTest: mode === "mock",
  payments: mode === "mock",
  outbound: mode === "mock",
});
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Membership = { id: string; name: string; role: Role };
export type Session = {
  userId: string;
  email: string;
  memberships: Membership[];
};
export type Organization = {
  id: string;
  name: string;
  business_type: string;
  revision: number;
};
export type Location = {
  id: string;
  org_id: string;
  name: string;
  address: string;
  state: string;
  timezone: string;
  revision: number;
  primary_location: boolean;
};
export type Bootstrap = {
  workspace: Organization;
  role: Role;
  locations: Location[];
  agent: { id: string; revision: number; published_version_id: string | null };
  contactCount: number;
};
export type AgentSettings = z.infer<typeof agentSettings>;
export type Agent = {
  id: string;
  revision: number;
  draft: Partial<AgentSettings>;
  published_version_id: string | null;
};
export type Knowledge = {
  id: string;
  kind: "faq" | "services" | "text-document";
  name: string;
  content: string;
  revision: number;
};
export type Version = {
  id: string;
  sequence: number;
  created_at: string;
  snapshot: { settings: AgentSettings; knowledge: Knowledge[] };
};
export type Contact = {
  id: string;
  org_id: string;
  name: string;
  phone_e164: string | null;
  preferred_language: "ms" | "en" | "zh";
  do_not_contact: boolean;
  deletion_pending: boolean;
  revision: number;
  created_at: string;
};
export type Note = { id: string; text: string; created_at: string };
export type Consent = {
  id: string;
  channel: string;
  purpose: string;
  granted: boolean;
  evidence: string;
  created_at: string;
};
export type Profile = Contact & { notes: Page<Note>; consents: Page<Consent> };
export type Job = {
  id: string;
  target_id: string;
  kind: "export" | "deletion";
  state: "pending" | "completed" | "failed" | "expired";
  expires_at: string | null;
  created_at: string;
};
export type Member = {
  org_id: string;
  email: string;
  id: string;
  user_id: string;
  role: Role;
  active: boolean;
  revision: number;
};
export type Invitation = {
  id: string;
  email: string;
  role: Role;
  state: string;
  delivery_state: string;
};
export type Audit = {
  id: string;
  action: string;
  target_id: string;
  created_at: string;
};
export type Schedule = Omit<
  z.infer<typeof scheduleInput>,
  "expectedRevision"
> & { revision: number };
const empty = z.object({}).strict(),
  id = z.object({ id: uuid }).strict(),
  revision = { expectedRevision: z.number().int().positive() },
  pages = z
    .object({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(2048).optional(),
      search: z.string().max(200).optional(),
    })
    .strict();
const location = {
  name,
  address: z.string().max(500),
  state: z.string().max(100),
  timezone: z.string(),
};
function route<I extends z.ZodType, O>(
  method: string,
  path: string,
  input: I,
  output: O,
) {
  return { method, path, input, output };
}
const out = <T>() => undefined as T;
export const commands = {
  testReadiness: route(
    "GET",
    "/agent-tests/readiness",
    empty,
    out<Readiness>(),
  ),
  submitTestTurn: route(
    "POST",
    "/agent-tests/:id/turns",
    turnInput.extend({ id: uuid }),
    out<TestTurn>(),
  ),
  cancelTestTurn: route(
    "POST",
    "/agent-tests/:sessionId/turns/:id/cancel",
    revisionInput.extend({ sessionId: uuid, id: uuid }),
    out<TestTurn>(),
  ),
  retryTestTurn: route(
    "POST",
    "/agent-tests/:sessionId/turns/:id/retry",
    revisionInput.extend({ sessionId: uuid, id: uuid }),
    out<TestTurn>(),
  ),
  applyBookingProposal: route(
    "POST",
    "/agent-tests/:sessionId/proposals/:id/apply",
    proposalApply.extend({ sessionId: uuid, id: uuid }),
    out<Booking>(),
  ),
  startAgentTest: route("POST", "/agent-tests", testStart, out<TestSession>()),
  agentTests: route("GET", "/agent-tests", empty, out<TestSession[]>()),
  agentTest: route("GET", "/agent-tests/:id", id, out<SessionDetail>()),
  testKnowledge: route(
    "GET",
    "/agent-tests/:id/knowledge",
    id.extend({ query: z.string().min(1).max(200) }),
    out<KnowledgeHit[]>(),
  ),
  deleteAgentTest: route(
    "DELETE",
    "/agent-tests/:id",
    revisionInput.extend({ id: uuid }),
    out<{ id: string }>(),
  ),
  bookings: route("GET", "/bookings", bookingList, out<Page<Booking>>()),
  booking: route("GET", "/bookings/:id", id, out<Booking>()),
  requestBooking: route("POST", "/bookings", bookingInput, out<Booking>()),
  confirmBooking: route(
    "POST",
    "/bookings/:id/confirm",
    bookingRevision.extend({ id: uuid }),
    out<Booking>(),
  ),
  rescheduleBooking: route(
    "POST",
    "/bookings/:id/reschedule",
    bookingReschedule.extend({ id: uuid }),
    out<Booking>(),
  ),
  cancelBooking: route(
    "POST",
    "/bookings/:id/cancel",
    bookingRevision.extend({ id: uuid }),
    out<Booking>(),
  ),
  bookingResources: route(
    "GET",
    "/booking-resources",
    z.object({ locationId: uuid.optional() }).strict(),
    out<Resource[]>(),
  ),
  createBookingResource: route(
    "POST",
    "/booking-resources",
    resourceCreate,
    out<Resource>(),
  ),
  updateBookingResource: route(
    "PATCH",
    "/booking-resources/:id",
    resourceUpdate.extend({ id: uuid }),
    out<Resource>(),
  ),
  availability: route(
    "GET",
    "/booking-availability",
    slotsInput,
    out<Page<Slot>>(),
  ),
  session: route("GET", "/session", empty, out<Session>()),
  organizations: route("GET", "/organizations", empty, out<Membership[]>()),
  createOrganization: route(
    "POST",
    "/organizations",
    organizationInput,
    out<{ orgId: string }>(),
  ),
  bootstrap: route("GET", "/organizations/:id/bootstrap", id, out<Bootstrap>()),
  updateOrganization: route(
    "PATCH",
    "/organizations/:id",
    z
      .object({ id: uuid, name, businessType: z.string(), ...revision })
      .strict(),
    out<Organization>(),
  ),
  listContacts: route("GET", "/contacts", pages, out<Page<Contact>>()),
  getContact: route("GET", "/contacts/:id", id, out<Profile>()),
  createContact: route(
    "POST",
    "/contacts",
    contactInput,
    out<Contact & { duplicatePhone?: boolean }>(),
  ),
  updateContact: route(
    "PATCH",
    "/contacts/:id",
    contactUpdate.extend({ id: uuid }),
    out<Contact>(),
  ),
  addNote: route(
    "POST",
    "/contacts/:id/notes",
    noteInput.extend({ id: uuid }),
    out<Note>(),
  ),
  addConsent: route(
    "POST",
    "/contacts/:id/consents",
    consentInput.extend({ id: uuid }),
    out<Consent>(),
  ),
  setDnc: route(
    "PUT",
    "/contacts/:id/do-not-contact",
    dncInput.extend({ id: uuid }),
    out<Contact>(),
  ),
  notes: route(
    "GET",
    "/contacts/:id/notes",
    pages.extend({ id: uuid }),
    out<Page<Note>>(),
  ),
  consents: route(
    "GET",
    "/contacts/:id/consents",
    pages.extend({ id: uuid }),
    out<Page<Consent>>(),
  ),
  requestExport: route(
    "POST",
    "/contacts/:id/export",
    id.extend(revision),
    out<Job>(),
  ),
  requestDeletion: route(
    "POST",
    "/contacts/:id/deletion",
    id.extend(revision),
    out<Job>(),
  ),
  jobs: route("GET", "/jobs", empty, out<Job[]>()),
  getJob: route("GET", "/jobs/:id", id, out<Job>()),
  retryJob: route("POST", "/jobs/:id/retry", id, out<Job>()),
  draft: route("GET", "/agents/:id/draft", id, out<Agent>()),
  saveDraft: route(
    "PUT",
    "/agents/:id/draft",
    id.extend({ ...revision, settings: agentSettings }),
    out<Agent>(),
  ),
  knowledge: route("GET", "/agents/:id/knowledge", id, out<Knowledge[]>()),
  saveKnowledge: route(
    "POST",
    "/agents/:agentId/knowledge",
    knowledgeInput.extend({ agentId: uuid }),
    out<Agent>(),
  ),
  deleteKnowledge: route(
    "DELETE",
    "/agents/:agentId/knowledge/:id",
    z
      .object({
        agentId: uuid,
        id: uuid,
        expectedAgentRevision: z.number().int().positive(),
      })
      .strict(),
    out<Agent>(),
  ),
  publish: route(
    "POST",
    "/agents/:id/publish",
    id.extend(revision),
    out<Version>(),
  ),
  versions: route(
    "GET",
    "/agents/:id/versions",
    pages.extend({ id: uuid }),
    out<Page<Version>>(),
  ),
  version: route(
    "GET",
    "/agents/:agentId/versions/:id",
    id.extend({ agentId: uuid }),
    out<Version>(),
  ),
  restore: route(
    "POST",
    "/agents/:id/restore",
    id.extend({ ...revision, versionId: uuid }),
    out<Agent>(),
  ),
  locations: route("GET", "/locations", empty, out<Location[]>()),
  createLocation: route(
    "POST",
    "/locations",
    z.object(location).strict(),
    out<Location>(),
  ),
  updateLocation: route(
    "PATCH",
    "/locations/:id",
    id.extend({ ...location, ...revision }),
    out<Location>(),
  ),
  archiveLocation: route(
    "POST",
    "/locations/:id/archive",
    id.extend(revision),
    out<Location>(),
  ),
  schedule: route("GET", "/locations/:id/schedule", id, out<Schedule>()),
  saveSchedule: route(
    "PUT",
    "/locations/:id/schedule",
    scheduleInput.extend({ id: uuid }),
    out<Schedule>(),
  ),
  members: route("GET", "/members", empty, out<Member[]>()),
  changeMember: route(
    "PATCH",
    "/members/:id",
    id.extend({ ...revision, role: z.enum(["admin", "staff"]) }),
    out<Member>(),
  ),
  revokeMember: route(
    "POST",
    "/members/:id/revoke",
    id.extend(revision),
    out<Member>(),
  ),
  invitations: route("GET", "/invitations", empty, out<Invitation[]>()),
  invite: route(
    "POST",
    "/invitations",
    z.object({ email: z.email(), role: z.enum(["admin", "staff"]) }).strict(),
    out<Invitation>(),
  ),
  resendInvite: route("POST", "/invitations/:id/resend", id, out<Invitation>()),
  revokeInvite: route("POST", "/invitations/:id/revoke", id, out<Invitation>()),
  acceptInvite: route(
    "POST",
    "/invitations/accept",
    z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    out<Member>(),
  ),
  audit: route("GET", "/audit", pages, out<Page<Audit>>()),
};
export type Command = keyof typeof commands;
export type Input<K extends Command> = z.input<(typeof commands)[K]["input"]>;
export type Output<K extends Command> = (typeof commands)[K]["output"];
export interface CoreClient {
  execute<K extends Command>(
    command: K,
    input: Input<K>,
    key?: string,
  ): Promise<Output<K>>;
}
