// One interface for transactional email, three implementations:
//   SmtpSender        local Mailpit, or a hosted SMTP provider (nodemailer)
//   CloudflareSender  Cloudflare Email Service REST API (fetch, no SDK)
//   FakeSender        tests; records messages and sends nothing
// The engine picks one from the environment; nothing here prints a value.
import nodemailer from "nodemailer";
import {
  cloudflareMailSettings,
  mailProvider,
  mailSettings,
  type CloudflareMailSettings,
  type Env,
  type MailSettings,
} from "../../packages/contracts/src/hosting.ts";

export type Mail = {
  to: string;
  subject: string;
  text: string;
  // Stable per logical message, so a retried send can be recognised.
  operationId: string;
};

export interface MailSender {
  readonly subject: string;
  readonly inviteBase: string;
  send(mail: Mail): Promise<void>;
  close?(): void;
}

export class SmtpSender implements MailSender {
  readonly subject: string;
  readonly inviteBase: string;
  private transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(private settings: MailSettings) {
    this.subject = settings.subject;
    this.inviteBase = settings.inviteBase;
    this.transport = nodemailer.createTransport({
      ...settings.transport,
      connectionTimeout: 5000,
      socketTimeout: 5000,
    });
  }
  async send(mail: Mail) {
    await this.transport.sendMail({
      from: this.settings.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      messageId: `${mail.operationId}@${this.settings.messageIdDomain}`,
    });
  }
  close() {
    this.transport.close();
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Request and response shapes from Cloudflare's REST API reference (checked
// 2026-11-14). Message-ID is platform-controlled there, so the operation id
// travels in an X- header (custom X- headers are allowed).
export class CloudflareSender implements MailSender {
  readonly subject: string;
  readonly inviteBase: string;
  constructor(
    private settings: CloudflareMailSettings,
    private fetcher: Fetch = fetch,
  ) {
    this.subject = settings.subject;
    this.inviteBase = settings.inviteBase;
  }
  async send(mail: Mail) {
    let response: Response;
    try {
      response = await this.fetcher(this.settings.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.settings.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: this.settings.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          headers: { "X-JomCall-Operation": mail.operationId },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw Error("MAIL_UNAVAILABLE");
    }
    let body: {
      success?: boolean;
      errors?: { code?: number }[];
      result?: { permanent_bounces?: string[] } | null;
    } = {};
    try {
      body = await response.json();
    } catch {
      // A non-JSON answer is handled by the status checks below.
    }
    if (!response.ok || body.success !== true) {
      const code = Number(body.errors?.[0]?.code);
      // Numeric Cloudflare codes only (e.g. 10004 throttled); never a message.
      throw Error(
        `MAIL_REJECTED_${response.status}` +
          (Number.isInteger(code) ? `_${code}` : ""),
      );
    }
    // Accepted, but the address bounced permanently: retrying cannot help, so
    // report it once and let the caller acknowledge the job.
    if (body.result?.permanent_bounces?.length)
      console.error("MAIL_PERMANENT_BOUNCE");
  }
}

export class FakeSender implements MailSender {
  readonly sent: Mail[] = [];
  constructor(
    readonly subject = "Test invitation",
    readonly inviteBase = "https://app.example.test",
  ) {}
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}

export function createMailSender(env: Env = process.env): MailSender {
  return mailProvider(env) === "cloudflare"
    ? new CloudflareSender(cloudflareMailSettings(env))
    : new SmtpSender(mailSettings(env));
}
