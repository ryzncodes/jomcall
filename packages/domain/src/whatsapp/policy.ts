// The rules checked before every WhatsApp send. Pure: the worker reads the
// facts under row locks and this decides. A provider is reached only with an
// "allow" from here, so the fake provider (which accepts everything) and the
// real one are held to the same rules.

export const serviceWindowMs = 24 * 60 * 60 * 1000;

export type TemplateFacts = {
  id: string;
  name: string;
  language: string;
  category: "utility" | "marketing" | "authentication";
  status: string;
  variables: number;
};

export type SendFacts = {
  message: { kind: "text" | "template"; templateVariables: string[] };
  channel: { state: string };
  contact: { doNotContact: boolean; deletionPending: boolean };
  conversation: { lastInboundAt: string | null };
  // Latest recorded answer per purpose on the WhatsApp channel; null when
  // the contact was never asked.
  consent: { service: boolean | null; marketing: boolean | null };
  template: TemplateFacts | null;
  // The approved "please reply" template, if the business has one.
  fallback: TemplateFacts | null;
  now: string;
};

export type SendDecision =
  | { allow: true; mode: "text" }
  | {
      allow: true;
      mode: "template";
      template: TemplateFacts;
      fallback: boolean;
    }
  | { allow: false; reason: string };

export function windowOpen(lastInboundAt: string | null, now: string) {
  if (!lastInboundAt) return false;
  const age = new Date(now).getTime() - new Date(lastInboundAt).getTime();
  return age >= 0 && age < serviceWindowMs;
}

function templateAllowed(
  template: TemplateFacts | null,
  facts: SendFacts,
): string | null {
  if (!template || template.status !== "approved")
    return "TEMPLATE_NOT_APPROVED";
  // One-time passcodes are not something this product sends.
  if (template.category === "authentication") return "TEMPLATE_CATEGORY";
  if (template.variables !== facts.message.templateVariables.length)
    return "TEMPLATE_VARIABLES";
  // A template starts or restarts contact, so it needs a recorded yes for
  // its purpose. A missing record is not a yes.
  const granted =
    template.category === "marketing"
      ? facts.consent.marketing
      : facts.consent.service;
  return granted === true ? null : "CONSENT_REQUIRED";
}

export function decideSend(facts: SendFacts): SendDecision {
  if (facts.channel.state !== "connected")
    return { allow: false, reason: "CHANNEL_NOT_CONNECTED" };
  if (facts.contact.deletionPending)
    return { allow: false, reason: "CONTACT_UNAVAILABLE" };
  // Do-not-contact stops everything, including a reply inside the window.
  if (facts.contact.doNotContact)
    return { allow: false, reason: "DO_NOT_CONTACT" };
  if (facts.message.kind === "template") {
    const reason = templateAllowed(facts.template, facts);
    return reason
      ? { allow: false, reason }
      : {
          allow: true,
          mode: "template",
          template: facts.template!,
          fallback: false,
        };
  }
  if (windowOpen(facts.conversation.lastInboundAt, facts.now))
    return { allow: true, mode: "text" };
  // Outside the window WhatsApp accepts templates only. The plain text is
  // not delivered; the customer is asked to reply, which reopens the window.
  if (!facts.fallback) return { allow: false, reason: "WINDOW_CLOSED" };
  const reason = templateAllowed(facts.fallback, {
    ...facts,
    message: { kind: "template", templateVariables: [] },
  });
  return reason
    ? {
        allow: false,
        reason: reason === "CONSENT_REQUIRED" ? reason : "WINDOW_CLOSED",
      }
    : {
        allow: true,
        mode: "template",
        template: facts.fallback,
        fallback: true,
      };
}
