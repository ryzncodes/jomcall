// WhatsApp work in the agent process: turn stored webhook events into
// messages and turns, answer with the shared text brain, and send through
// the provider after the send rules allow it. All database access goes
// through app_private.whatsapp_work, which re-checks state under row locks.
import pg from "pg";
import {
  databaseConnection,
  validNamespace,
} from "../../../packages/contracts/src/hosting.ts";
import type { ModelClient } from "../../../packages/inference/src/index.ts";
import { inputBudget } from "../../../packages/inference/src/budget.ts";
import {
  configuredProvider,
  createModelClient,
} from "../../../packages/inference/src/provider.ts";
import type {
  ToolAccess,
  ToolResult,
} from "../../../packages/domain/src/agent-test/tools.ts";
import { agentRules } from "../../../packages/domain/src/agent-test/prompt.ts";
import { claimsFalseSuccess } from "../../../packages/domain/src/agent-test/safety.ts";
import { calculateAvailability } from "../../../packages/domain/src/booking/availability.ts";
import {
  decideSend,
  type SendFacts,
} from "../../../packages/domain/src/whatsapp/policy.ts";
import {
  disclosureText,
  noticeText,
  whatsappChannelNote,
  type NoticeKind,
} from "../../../packages/domain/src/whatsapp/texts.ts";
import {
  openCredentials,
  whatsappMode,
  type SealedCredentials,
  type SendOutcome,
  type WhatsAppProvider,
} from "../../../packages/whatsapp/src/index.ts";
import { runTextBrain } from "../agent/brain.ts";

type Env = Record<string, string | undefined>;
export type WhatsAppWorkerOptions = {
  provider: WhatsAppProvider;
  // Tests inject a model; otherwise the configured provider is used.
  model?: ModelClient;
  env?: Env;
};

const code = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : "";
  return /^[A-Z0-9_]{1,60}$/.test(m) ? m : fallback;
};

export class WhatsAppWorker {
  private pool: pg.Pool;
  private env: Env;
  constructor(
    readonly namespace: string,
    private options: WhatsAppWorkerOptions,
  ) {
    this.env = options.env ?? process.env;
    validNamespace(namespace, this.env);
    if (options.model && this.env.NODE_ENV !== "test") throw Error("TEST_ONLY");
    // Local: 127.0.0.1:54622 only. Hosted: TLS and an allow-listed host.
    this.pool = new pg.Pool({
      ...databaseConnection(
        this.env.AGENT_DATABASE_URL,
        "AGENT_DATABASE_URL",
        this.env,
      ),
      max: 2,
    });
    this.pool.on("error", () => console.error("WHATSAPP_DATABASE_POOL_ERROR"));
  }

  async op(
    action: string,
    id: string | null = null,
    lease: string | null = null,
    data: unknown = {},
  ): Promise<any> {
    return (
      await this.pool.query(
        "select app_private.whatsapp_work($1,$2,$3,$4,$5)as value",
        [action, this.namespace, id, lease, JSON.stringify(data)],
      )
    ).rows[0].value;
  }

  // One pass of every kind of work. Bounded so a busy queue cannot starve
  // the other kinds.
  async tick() {
    await this.op("maintain");
    for (let i = 0; i < 4; i++) {
      const r = await this.op("ingest");
      if (!r?.processed) break;
    }
    await this.verifyOne();
    for (let i = 0; i < 4; i++) if (!(await this.runOneTurn())) break;
    for (let i = 0; i < 20; i++) if (!(await this.sendOne())) break;
  }

  private token(sealed: SealedCredentials | null, orgId: string) {
    // The fake provider needs no token and never sees a real one.
    if (whatsappMode(this.env) !== "cloud") return "fake-token";
    if (!sealed) throw Error("WHATSAPP_CREDENTIALS_MISSING");
    return openCredentials(sealed, this.env.WHATSAPP_CREDENTIALS_KEY, orgId)
      .accessToken;
  }

  async verifyOne() {
    const v = await this.op("verify_claim");
    if (!v) return false;
    let result: { ok: boolean; reason?: string; displayPhone?: string | null };
    try {
      result = await this.options.provider.verifyNumber({
        phoneNumberId: v.phoneNumberId,
        accessToken: this.token(v.credentials, v.orgId),
      });
    } catch (e) {
      result = { ok: false, reason: code(e, "VERIFICATION_FAILED") };
    }
    await this.op("verify_result", v.id, null, {
      revision: v.revision,
      ok: result.ok,
      reason: result.reason,
      displayPhone: result.displayPhone,
    });
    return true;
  }

  async runOneTurn() {
    const claim = await this.op("turn_claim");
    if (!claim) return false;
    if (claim.skipped) return true;
    const { turn, conversation, contact, session } = claim;
    try {
      let text: string;
      let citations: string[] = [];
      let usage: unknown[] = [];
      let model: string | null = null;
      if (turn.kind === "agent") {
        const answer = await this.answer(claim);
        text = answer.text;
        citations = answer.citations;
        usage = answer.usage;
        model = answer.model;
      } else
        text = noticeText(turn.kind as NoticeKind, contact.preferred_language);
      // The confirmation of an opt-out carries nothing else.
      const disclosure =
        conversation.disclosed || turn.kind === "notice_opt_out"
          ? ""
          : disclosureText(
              session.snapshot?.settings,
              contact.preferred_language,
            );
      const done = await this.op("turn_complete", turn.id, turn.lease_token, {
        text,
        disclosure,
        citations,
        usage,
        model,
      });
      if (done === null) return true;
    } catch (e) {
      await this.op("turn_fail", turn.id, turn.lease_token, {
        code: code(e, "TURN_FAILED"),
      });
    }
    return true;
  }

  private async answer(claim: any) {
    const { turn, session } = claim;
    const config = this.options.model
      ? null
      : await configuredProvider(this.env);
    if (!this.options.model && !config) throw Error("MODEL_DISABLED");
    const model =
      this.options.model ?? (await createModelClient(config!, this.env));
    const access: ToolAccess = {
      read: async () => {
        const v = await this.op("turn_context", turn.id, turn.lease_token);
        if (!v) throw Error("TURN_CANCELLED");
        return {
          snapshot: v.session.snapshot,
          locationId: v.session.location_id,
          resources: v.resources,
        };
      },
      availability: async (args) => {
        const v = await this.op(
          "turn_availability",
          turn.id,
          turn.lease_token,
          args,
        );
        if (!v) throw Error("TURN_CANCELLED");
        return calculateAvailability(
          session.org_id,
          v.resource,
          v.schedule,
          v.occupied,
          args,
        ).items;
      },
      record: async (step, call, effect): Promise<ToolResult> => {
        const v = await this.op("turn_record", turn.id, turn.lease_token, {
          step,
          call,
          effect,
        });
        if (!v) throw Error("TURN_CANCELLED");
        return v;
      },
    };
    const answer = await runTextBrain({
      model,
      signal: AbortSignal.timeout(60000),
      rules: agentRules + whatsappChannelNote,
      snapshot: session.snapshot,
      text: turn.input,
      history: claim.history ?? [],
      resources: claim.resources ?? [],
      access,
      // Knowledge-core rules and facts fit the pinned model's input budget.
      budget: inputBudget(config?.identity ?? null),
    });
    // A real customer must never be told something was done when it was not.
    if (claimsFalseSuccess(answer.text)) throw Error("UNSAFE_ANSWER");
    return { ...answer, model: config?.identity ?? "test" };
  }

  async sendOne() {
    const claim = await this.op("send_claim");
    if (!claim) return false;
    if (claim.skipped) return true;
    const { message, channel, contact, conversation } = claim;
    const facts: SendFacts = {
      message: {
        kind: message.kind === "template" ? "template" : "text",
        templateVariables: (message.template_variables ?? []).map(String),
        optOutNotice:
          message.author === "system" && message.turnKind === "notice_opt_out",
      },
      channel: { state: channel.state },
      contact: {
        doNotContact: contact.doNotContact,
        deletionPending: contact.deletionPending,
      },
      conversation: { lastInboundAt: conversation.lastInboundAt },
      consent: claim.consent,
      template: claim.template,
      fallback: claim.fallback,
      now: claim.now,
    };
    const decision = decideSend(facts);
    if (!decision.allow) {
      await this.op("send_result", message.id, message.lease_token, {
        outcome: "blocked",
        code: decision.reason,
      });
      return true;
    }
    let outcome: SendOutcome;
    try {
      const target = {
        phoneNumberId: channel.phoneNumberId,
        accessToken: this.token(channel.credentials, channel.orgId),
        to: conversation.waId,
      };
      outcome =
        decision.mode === "text"
          ? await this.options.provider.sendText(target, message.body)
          : await this.options.provider.sendTemplate(target, {
              name: decision.template.name,
              language: decision.template.language,
              variables: decision.fallback
                ? []
                : facts.message.templateVariables,
            });
    } catch (e) {
      // Credentials that cannot be opened mean nothing was sent.
      const reason = code(e, "");
      outcome = reason.startsWith("WHATSAPP_CREDENTIALS")
        ? { outcome: "failed", code: reason }
        : { outcome: "unknown" };
    }
    await this.op("send_result", message.id, message.lease_token, {
      ...outcome,
      ...(decision.mode === "template" && decision.fallback
        ? { templateId: decision.template.id }
        : {}),
    });
    return true;
  }

  close() {
    return this.pool.end();
  }
}
