// In-memory WhatsApp provider for tests and the local simulator. It makes no
// network call. It accepts every send unless told otherwise, so every rule
// that must stop a send has to be enforced before the provider is reached.
import { randomUUID } from "node:crypto";
import type {
  CodeExchange,
  NumberCheck,
  RegisterResult,
  ProviderTemplate,
  SendOutcome,
  SendTarget,
  SubscribeResult,
  TemplateCreate,
  TemplateMessage,
  WhatsAppProvider,
} from "./provider.ts";

export type FakeSend = {
  to: string;
  phoneNumberId: string;
  providerMessageId: string | null;
} & (
  | { kind: "text"; body: string }
  | { kind: "template"; template: TemplateMessage }
);

export type FakeProvider = WhatsAppProvider & {
  sent: FakeSend[];
  // The next send returns this outcome instead of succeeding.
  failNext(outcome: Exclude<SendOutcome, { outcome: "sent" }>): void;
  // Pass undefined to accept the number again.
  // `detail` is the raw provider code the worker may log (META_100_33).
  rejectNumber(reason: string | undefined, detail?: string): void;
  // Every subscribeApp call, in order. The token is never recorded.
  subscribed: { wabaId: string }[];
  // subscribeApp fails with this reason until it is called with undefined.
  failSubscribe(reason: string | undefined, detail?: string): void;
  // Every code handed to exchangeSignupCode, in order.
  exchanged: string[];
  // exchangeSignupCode fails with this reason until called with undefined.
  failExchange(reason: string | undefined): void;
  // Every registerNumber call, in order. The token is never recorded.
  registered: { phoneNumberId: string; pin: string }[];
  // registerNumber fails with this reason until called with undefined.
  failRegister(reason: string | undefined, detail?: string): void;
  // Every createTemplate call, in order. The token is never recorded.
  created: {
    wabaId: string;
    name: string;
    language: string;
    category: string;
    body: string;
    variables: number;
  }[];
  // createTemplate fails with this reason until called with undefined.
  failCreate(reason: string | undefined, detail?: string): void;
  // The status a created template gets (default PENDING; null: unsaid).
  createStatus(status: string | null): void;
  // What listTemplates answers from now on (default: an empty list).
  setTemplates(list: ProviderTemplate[]): void;
  // listTemplates fails with this reason until setTemplates is called.
  failTemplates(reason: string): void;
};

export function createFakeProvider(): FakeProvider {
  let next: SendOutcome | undefined;
  let numberReason: string | undefined;
  let numberDetail: string | undefined;
  let subscribeDetail: string | undefined;
  let templates: ProviderTemplate[] = [];
  let templateReason: string | undefined;
  let subscribeReason: string | undefined;
  const subscribed: { wabaId: string }[] = [];
  const sent: FakeSend[] = [];
  const created: FakeProvider["created"] = [];
  let createReason: string | undefined;
  let createDetail: string | undefined;
  let createdStatus: string | null = "PENDING";
  const exchanged: string[] = [];
  const registered: { phoneNumberId: string; pin: string }[] = [];
  let exchangeReason: string | undefined;
  let registerReason: string | undefined;
  let registerDetail: string | undefined;
  function settle(
    entry:
      | { kind: "text"; body: string; to: string; phoneNumberId: string }
      | {
          kind: "template";
          template: TemplateMessage;
          to: string;
          phoneNumberId: string;
        },
  ): SendOutcome {
    const forced = next;
    next = undefined;
    const outcome: SendOutcome = forced ?? {
      outcome: "sent",
      providerMessageId: "wamid.FAKE" + randomUUID().replaceAll("-", ""),
    };
    sent.push({
      ...entry,
      providerMessageId:
        outcome.outcome === "sent" ? outcome.providerMessageId : null,
    } as FakeSend);
    return outcome;
  }
  return {
    name: "fake",
    sent,
    subscribed,
    exchanged,
    registered,
    created,
    failCreate(reason, detail) {
      createReason = reason;
      createDetail = detail;
    },
    createStatus(status) {
      createdStatus = status;
    },
    async createTemplate(draft): Promise<TemplateCreate> {
      created.push({
        wabaId: draft.wabaId,
        name: draft.name,
        language: draft.language,
        category: draft.category,
        body: draft.body,
        variables: draft.variables,
      });
      if (createReason)
        return {
          ok: false,
          reason: createReason,
          ...(createDetail ? { detail: createDetail } : {}),
        };
      // Like the real provider: once created, the template is in the list.
      if (!templateReason)
        templates = [
          ...templates.filter(
            (t) => !(t.name === draft.name && t.language === draft.language),
          ),
          {
            name: draft.name,
            language: draft.language,
            status: createdStatus ?? "PENDING",
          },
        ];
      return { ok: true, status: createdStatus };
    },
    failExchange(reason) {
      exchangeReason = reason;
    },
    failRegister(reason, detail) {
      registerReason = reason;
      registerDetail = detail;
    },
    async exchangeSignupCode(input): Promise<CodeExchange> {
      exchanged.push(input.code);
      return exchangeReason
        ? { ok: false, reason: exchangeReason }
        : { ok: true, accessToken: "fake-signup-token" };
    },
    async registerNumber(input): Promise<RegisterResult> {
      registered.push({ phoneNumberId: input.phoneNumberId, pin: input.pin });
      return registerReason
        ? {
            ok: false,
            reason: registerReason,
            ...(registerDetail ? { detail: registerDetail } : {}),
          }
        : { ok: true };
    },
    failNext(outcome) {
      next = outcome;
    },
    rejectNumber(reason, detail) {
      numberReason = reason;
      numberDetail = detail;
    },
    failSubscribe(reason, detail) {
      subscribeReason = reason;
      subscribeDetail = detail;
    },
    async subscribeApp(input): Promise<SubscribeResult> {
      subscribed.push({ wabaId: input.wabaId });
      return subscribeReason
        ? {
            ok: false,
            reason: subscribeReason,
            ...(subscribeDetail ? { detail: subscribeDetail } : {}),
          }
        : { ok: true };
    },
    setTemplates(list) {
      templates = list.map((t) => ({ ...t }));
      templateReason = undefined;
    },
    failTemplates(reason) {
      templateReason = reason;
    },
    async listTemplates() {
      return templateReason
        ? { ok: false as const, reason: templateReason }
        : { ok: true as const, templates: templates.map((t) => ({ ...t })) };
    },
    async sendText(target: SendTarget, body: string) {
      return settle({
        kind: "text",
        body,
        to: target.to,
        phoneNumberId: target.phoneNumberId,
      });
    },
    async sendTemplate(target: SendTarget, template: TemplateMessage) {
      return settle({
        kind: "template",
        template,
        to: target.to,
        phoneNumberId: target.phoneNumberId,
      });
    },
    async verifyNumber(): Promise<NumberCheck> {
      return numberReason
        ? {
            ok: false,
            reason: numberReason,
            ...(numberDetail ? { detail: numberDetail } : {}),
          }
        : { ok: true, displayPhone: null };
    },
  };
}
