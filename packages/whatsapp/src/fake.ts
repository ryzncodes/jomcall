// In-memory WhatsApp provider for tests and the local simulator. It makes no
// network call. It accepts every send unless told otherwise, so every rule
// that must stop a send has to be enforced before the provider is reached.
import { randomUUID } from "node:crypto";
import type {
  NumberCheck,
  ProviderTemplate,
  SendOutcome,
  SendTarget,
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
  rejectNumber(reason: string): void;
  // What listTemplates answers from now on (default: an empty list).
  setTemplates(list: ProviderTemplate[]): void;
  // listTemplates fails with this reason until setTemplates is called.
  failTemplates(reason: string): void;
};

export function createFakeProvider(): FakeProvider {
  let next: SendOutcome | undefined;
  let numberReason: string | undefined;
  let templates: ProviderTemplate[] = [];
  let templateReason: string | undefined;
  const sent: FakeSend[] = [];
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
    failNext(outcome) {
      next = outcome;
    },
    rejectNumber(reason) {
      numberReason = reason;
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
        ? { ok: false, reason: numberReason }
        : { ok: true, displayPhone: null };
    },
  };
}
