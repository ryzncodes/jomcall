import type { FirstRun } from "./first-run.ts";
import {
  turnInput,
  voiceStart,
  type TestTurn,
  type TestReadiness,
  type VoiceStartResult,
} from "./agent-test.ts";
import { proposalApply } from "./agent-test.ts";
import {
  testStart,
  revisionInput,
  type TestSession,
  type SessionDetail,
  type KnowledgeHit,
} from "./agent-test.ts";
import {
  followUpList,
  followUpClose,
  followUpReopen,
  followUpAssign,
  followUpConfirmBooking,
  type FollowUp,
  type FollowUpPage,
  type FollowUpCount,
} from "./follow-up.ts";
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
import {
  phoneNumberCreate,
  phoneNumberRequestCreate,
  phoneNumberUpdate,
  callList,
  callSummaryUpdate,
  type CallAiSummary,
  type PhoneNumber,
  type Channels,
  type PhoneNumbers,
  type PhoneNumberRequest,
  type CallSummary,
  type CallDetail,
} from "./phone.ts";
import { z } from "zod";
import {
  topupInput,
  billingPages,
  planChoice,
  type PlanChoice,
  type PlanSummary,
  type Wallet,
  type LedgerEntry,
  type UsageEvent,
  type Topup,
  type Receipt,
} from "./billing.ts";
import {
  channelRevision,
  channelSave,
  channelSignup,
  conversationList,
  staffReply,
  templateCreate,
  templateStatus,
  type ConversationDetail,
  type ConversationSummary,
  type WhatsAppChannel,
  type WhatsAppOverview,
  type WhatsAppTemplate,
} from "./whatsapp.ts";
import { uuid, name, organizationInput, type Role } from "./index.ts";
import { agentSettings, knowledgeInput, scheduleInput } from "./agent.ts";
import {
  setupAnswerInput,
  setupApplyInput,
  setupItemInput,
  setupStart,
  type Setup,
  type SetupApplyResult,
} from "./setup.ts";
import {
  setupPasteText,
  setupUploadCreate,
  uploadSeq,
  type SetupUpload,
} from "./setup-upload.ts";
import {
  catalogueInput,
  confirmInput,
  factInput,
  gapIgnore,
  gapResolve,
  packsInput,
  removeInput,
  ruleInput,
  type KnowledgeCore,
  type KnowledgeGap,
} from "./knowledge.ts";
import type { PackSummary } from "../../domain/src/packs/index.ts";
import type { FrozenHours } from "../../domain/src/knowledge/hours.ts";
import {
  contactInput,
  contactUpdate,
  noteInput,
  consentInput,
  dncInput,
  timelineInput,
  type ContactTimeline,
} from "./contacts.ts";
import { parseMode, type Mode } from "./hosting.ts";
export { parseMode, type Mode };
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
  snapshot: {
    settings: AgentSettings;
    knowledge: Knowledge[];
    // Absent on versions from before the knowledge core.
    packs?: string[];
    facts?: { title: string; value: unknown }[];
    rules?: { kind: string; text: string }[];
    catalogue?: { setId: string; hash: string; rows: number } | null;
    // Every active branch's hours at publish; absent on older versions.
    hours?: FrozenHours[];
  };
};
export type AgentChange = {
  kind: "setting" | "knowledge" | "pack" | "fact" | "rule" | "price" | "hours";
  op: "added" | "changed" | "removed";
  // setting: the settings key; pack: the pack id; hours: the branch name;
  // others: the row's name, title, item or the rule text (first 120 characters).
  label: string;
  // Present on a collapsed line: how many rows it stands for.
  count?: number;
};
export type AgentChanges = {
  count: number;
  token: string;
  published: boolean;
  changes: AgentChange[];
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
    out<TestReadiness>(),
  ),
  submitTestTurn: route(
    "POST",
    "/agent-tests/:id/turns",
    turnInput.extend({ id: uuid }),
    out<TestTurn>(),
  ),
  startVoiceTest: route(
    "POST",
    "/agent-tests/:id/voice",
    voiceStart.extend({ id: uuid }),
    out<VoiceStartResult>(),
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
  followUps: route("GET", "/follow-ups", followUpList, out<FollowUpPage>()),
  followUpCount: route(
    "GET",
    "/follow-ups/count",
    empty,
    out<FollowUpCount>(),
  ),
  closeFollowUp: route(
    "POST",
    "/follow-ups/:id/close",
    followUpClose,
    out<FollowUp>(),
  ),
  reopenFollowUp: route(
    "POST",
    "/follow-ups/:id/reopen",
    followUpReopen,
    out<FollowUp>(),
  ),
  confirmFollowUpBooking: route(
    "POST",
    "/follow-ups/:id/confirm-booking",
    followUpConfirmBooking,
    out<FollowUp>(),
  ),
  assignFollowUp: route(
    "POST",
    "/follow-ups/:id/assign",
    followUpAssign,
    out<FollowUp>(),
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
  contactTimeline: route(
    "GET",
    "/contacts/:id/timeline",
    timelineInput,
    out<ContactTimeline>(),
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
  agentChanges: route("GET", "/agents/:id/changes", id, out<AgentChanges>()),
  publish: route(
    "POST",
    "/agents/:id/publish",
    id.extend({
      ...revision,
      changeToken: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
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
  packs: route("GET", "/packs", empty, out<PackSummary[]>()),
  knowledgeCore: route("GET", "/agents/:id/core", id, out<KnowledgeCore>()),
  savePacks: route(
    "PUT",
    "/agents/:agentId/packs",
    packsInput.extend({ agentId: uuid }),
    out<KnowledgeCore>(),
  ),
  saveFact: route(
    "POST",
    "/agents/:agentId/facts",
    factInput.extend({ agentId: uuid }),
    out<KnowledgeCore>(),
  ),
  deleteFact: route(
    "DELETE",
    "/agents/:agentId/facts/:id",
    removeInput.extend({ agentId: uuid, id: uuid }),
    out<KnowledgeCore>(),
  ),
  saveRule: route(
    "POST",
    "/agents/:agentId/rules",
    ruleInput.extend({ agentId: uuid }),
    out<KnowledgeCore>(),
  ),
  deleteRule: route(
    "DELETE",
    "/agents/:agentId/rules/:id",
    removeInput.extend({ agentId: uuid, id: uuid }),
    out<KnowledgeCore>(),
  ),
  saveCatalogue: route(
    "POST",
    "/agents/:agentId/catalogue",
    catalogueInput.extend({ agentId: uuid }),
    out<KnowledgeCore>(),
  ),
  deleteCatalogueRow: route(
    "DELETE",
    "/agents/:agentId/catalogue/:id",
    removeInput.extend({ agentId: uuid, id: uuid }),
    out<KnowledgeCore>(),
  ),
  confirmKnowledge: route(
    "POST",
    "/agents/:agentId/confirm",
    confirmInput.extend({ agentId: uuid }),
    out<KnowledgeCore>(),
  ),
  setup: route("GET", "/agents/:id/setup", id, out<Setup>()),
  startSetup: route(
    "POST",
    "/agents/:id/setup",
    setupStart.extend({ id: uuid }),
    out<Setup>(),
  ),
  answerSetup: route(
    "PUT",
    "/agents/:id/setup/answers/:questionId",
    setupAnswerInput.extend({
      id: uuid,
      questionId: z.string().regex(/^[a-z][a-z0-9_:-]{0,80}$/),
    }),
    out<Setup>(),
  ),
  saveSetupItem: route(
    "PUT",
    "/agents/:id/setup/items/:itemId",
    setupItemInput.extend({ id: uuid, itemId: uuid }),
    out<Setup>(),
  ),
  applySetup: route(
    "POST",
    "/agents/:id/setup/apply",
    setupApplyInput.extend({ id: uuid }),
    out<SetupApplyResult>(),
  ),
  createSetupUpload: route(
    "POST",
    "/agents/:id/setup/uploads",
    setupUploadCreate.extend({ id: uuid }),
    out<SetupUpload>(),
  ),
  // The body is the chunk's raw bytes (application/octet-stream, at most
  // 3 MiB), not JSON; the input lists the path fields only. `received` is the
  // number of bytes stored for this upload so far, across all chunks.
  putSetupUploadChunk: route(
    "PUT",
    "/agents/:id/setup/uploads/:uploadId/chunks/:seq",
    z.object({ id: uuid, uploadId: uuid, seq: uploadSeq }).strict(),
    out<{ received: number }>(),
  ),
  finishSetupUpload: route(
    "POST",
    "/agents/:id/setup/uploads/:uploadId/finish",
    z.object({ id: uuid, uploadId: uuid }).strict(),
    out<SetupUpload>(),
  ),
  pasteSetupText: route(
    "POST",
    "/agents/:id/setup/uploads/text",
    setupPasteText.extend({ id: uuid }),
    out<SetupUpload>(),
  ),
  removeSetupUpload: route(
    "DELETE",
    "/agents/:id/setup/uploads/:uploadId",
    z.object({ id: uuid, uploadId: uuid }).strict(),
    out<{ removed: true }>(),
  ),
  // Raw bytes (application/octet-stream) for the review page's preview.
  setupUploadChunk: route(
    "GET",
    "/agents/:id/setup/uploads/:uploadId/chunks/:seq",
    z.object({ id: uuid, uploadId: uuid, seq: uploadSeq }).strict(),
    out<Uint8Array>(),
  ),
  knowledgeGaps: route(
    "GET",
    "/agents/:id/gaps",
    id.extend({ status: z.enum(["open", "resolved", "ignored"]).optional() }),
    out<KnowledgeGap[]>(),
  ),
  resolveGap: route(
    "POST",
    "/agents/:agentId/gaps/:id/resolve",
    z.intersection(z.object({ agentId: uuid, id: uuid }), gapResolve),
    out<KnowledgeGap>(),
  ),
  ignoreGap: route(
    "POST",
    "/agents/:agentId/gaps/:id/ignore",
    gapIgnore.extend({ agentId: uuid, id: uuid }),
    out<KnowledgeGap>(),
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
  wallet: route("GET", "/billing/wallet", empty, out<Wallet>()),
  walletLedger: route(
    "GET",
    "/billing/ledger",
    billingPages,
    out<Page<LedgerEntry>>(),
  ),
  usageEvents: route(
    "GET",
    "/billing/usage",
    billingPages,
    out<Page<UsageEvent>>(),
  ),
  topups: route("GET", "/billing/topups", billingPages, out<Page<Topup>>()),
  receipts: route(
    "GET",
    "/billing/receipts",
    billingPages,
    out<Page<Receipt>>(),
  ),
  claimTrial: route("POST", "/billing/trial", empty, out<Wallet>()),
  startTopup: route("POST", "/billing/topups", topupInput, out<Topup>()),
  reconcileTopup: route(
    "POST",
    "/billing/topups/:id/reconcile",
    id,
    out<Topup>(),
  ),
  plan: route("GET", "/billing/plan", empty, out<PlanSummary>()),
  choosePlan: route("POST", "/billing/plan", planChoice, out<PlanChoice>()),
  channels: route("GET", "/channels", empty, out<Channels>()),
  firstRun: route("GET", "/first-run", empty, out<FirstRun>()),
  phoneNumbers: route("GET", "/phone-numbers", empty, out<PhoneNumbers>()),
  createPhoneNumber: route(
    "POST",
    "/phone-numbers",
    phoneNumberCreate,
    out<PhoneNumber>(),
  ),
  requestPhoneNumber: route(
    "POST",
    "/phone-number-requests",
    phoneNumberRequestCreate,
    out<PhoneNumberRequest>(),
  ),
  updatePhoneNumber: route(
    "PATCH",
    "/phone-numbers/:id",
    phoneNumberUpdate.extend({ id: uuid }),
    out<PhoneNumber>(),
  ),
  calls: route("GET", "/calls", callList, out<Page<CallSummary>>()),
  call: route("GET", "/calls/:id", id, out<CallDetail>()),
  updateCallSummary: route(
    "PATCH",
    "/calls/:id/summary",
    callSummaryUpdate.extend({ id: uuid }),
    out<CallAiSummary>(),
  ),
  whatsappOverview: route(
    "GET",
    "/channels/whatsapp",
    empty,
    out<WhatsAppOverview>(),
  ),
  saveWhatsAppChannel: route(
    "PUT",
    "/channels/whatsapp",
    channelSave,
    out<WhatsAppChannel>(),
  ),
  connectWhatsAppSignup: route(
    "POST",
    "/channels/whatsapp/signup",
    channelSignup,
    out<WhatsAppChannel>(),
  ),
  disconnectWhatsApp: route(
    "POST",
    "/channels/whatsapp/disconnect",
    channelRevision,
    out<WhatsAppChannel>(),
  ),
  createWhatsAppTemplate: route(
    "POST",
    "/channels/whatsapp/templates",
    templateCreate,
    out<WhatsAppTemplate>(),
  ),
  updateWhatsAppTemplate: route(
    "PATCH",
    "/channels/whatsapp/templates/:id",
    templateStatus.extend({ id: uuid }),
    out<WhatsAppTemplate>(),
  ),
  submitWhatsAppTemplate: route(
    "POST",
    "/channels/whatsapp/templates/:id/submit",
    channelRevision.extend({ id: uuid }),
    out<WhatsAppTemplate>(),
  ),
  conversations: route(
    "GET",
    "/conversations",
    conversationList,
    out<ConversationSummary[]>(),
  ),
  conversation: route(
    "GET",
    "/conversations/:id",
    id,
    out<ConversationDetail>(),
  ),
  replyConversation: route(
    "POST",
    "/conversations/:id/messages",
    staffReply.extend({ id: uuid }),
    out<ConversationDetail>(),
  ),
  takeoverConversation: route(
    "POST",
    "/conversations/:id/takeover",
    channelRevision.extend({ id: uuid }),
    out<ConversationDetail>(),
  ),
  handbackConversation: route(
    "POST",
    "/conversations/:id/handback",
    channelRevision.extend({ id: uuid }),
    out<ConversationDetail>(),
  ),
  resolveConversation: route(
    "POST",
    "/conversations/:id/resolve",
    channelRevision.extend({ id: uuid }),
    out<ConversationDetail>(),
  ),
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
