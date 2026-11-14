// In-memory WhatsApp provider for tests and the local simulator. It makes no
// network call. It accepts every send unless told otherwise, so every rule
// that must stop a send has to be enforced before the provider is reached.
import { randomUUID } from "node:crypto";
import type {
  NumberCheck,
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
};

export function createFakeProvider(): FakeProvider {
  let next: SendOutcome | undefined;
  let numberReason: string | undefined;
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
