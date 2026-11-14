// Client for Meta's WhatsApp Business Platform Cloud API.
//
// NEVER RUN AGAINST META. Written from Meta's public documentation, read on
// 2026-11-14; every request shape below is exercised only against a fake
// fetch in tests. See docs/research/whatsapp-go-live.md for the sources.
//
// This is a hosted service. The client refuses to exist unless
// JOMCALL_WHATSAPP_PROVIDER=cloud, and only the agent process may create it.
// It never logs a token, a phone number or a message body.
import {
  whatsappMode,
  type NumberCheck,
  type SendOutcome,
  type SendTarget,
  type TemplateMessage,
  type WhatsAppProvider,
} from "./provider.ts";

// Latest Graph API version on the changelog page on 2026-11-14 (released
// 2026-11-04). The only place the version is named.
export const graphVersion = "v27.0";
const graphOrigin = "https://graph.facebook.com";

type Env = Record<string, string | undefined>;

function valid(target: { phoneNumberId: string; accessToken: string }) {
  return /^[0-9]{5,30}$/.test(target.phoneNumberId) && !!target.accessToken;
}

export function createCloudProvider(
  options: { env?: Env; send?: typeof fetch; timeoutMs?: number } = {},
): WhatsAppProvider {
  if (whatsappMode(options.env ?? process.env) !== "cloud")
    throw Error("WHATSAPP_CLOUD_DISABLED");
  const send = options.send ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;

  async function post(target: SendTarget, message: Record<string, unknown>) {
    if (!valid(target) || !/^[1-9][0-9]{1,14}$/.test(target.to))
      return { outcome: "failed", code: "INVALID_TARGET" } as const;
    let response: Response;
    try {
      response = await send(
        `${graphOrigin}/${graphVersion}/${target.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + target.accessToken,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: target.to,
            ...message,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch {
      // Timeout or broken connection: Meta may have accepted the message.
      return { outcome: "unknown" } as const;
    }
    return readSendResponse(response);
  }

  return {
    name: "cloud",
    sendText(target, body) {
      return post(target, {
        type: "text",
        text: { preview_url: false, body },
      });
    },
    sendTemplate(target, template: TemplateMessage) {
      return post(target, {
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          ...(template.variables.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: template.variables.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ],
              }
            : {}),
        },
      });
    },
    async verifyNumber(target): Promise<NumberCheck> {
      if (!valid(target)) return { ok: false, reason: "INVALID_TARGET" };
      let response: Response;
      try {
        response = await send(
          `${graphOrigin}/${graphVersion}/${target.phoneNumberId}?fields=display_phone_number,verified_name`,
          {
            headers: { authorization: "Bearer " + target.accessToken },
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      } catch {
        return { ok: false, reason: "PROVIDER_UNREACHABLE" };
      }
      const body = await readJson(response);
      if (!response.ok)
        return { ok: false, reason: errorCode(body) ?? "VERIFICATION_FAILED" };
      if (body?.id !== target.phoneNumberId)
        return { ok: false, reason: "NUMBER_MISMATCH" };
      const digits = String(body.display_phone_number ?? "").replace(
        /[^0-9]/g,
        "",
      );
      return {
        ok: true,
        displayPhone: /^[1-9][0-9]{1,14}$/.test(digits) ? "+" + digits : null,
      };
    },
  };
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Meta's errors carry a numeric code; the documentation says to act on the
// code, not on the message text.
function errorCode(body: any): string | null {
  const code = body?.error?.code;
  return Number.isInteger(code) && code >= 0 ? "META_" + code : null;
}

export async function readSendResponse(
  response: Response,
): Promise<SendOutcome> {
  const body = await readJson(response);
  if (response.ok) {
    const id = body?.messages?.[0]?.id;
    return typeof id === "string" && id.length > 0 && id.length <= 256
      ? { outcome: "sent", providerMessageId: id }
      : { outcome: "unknown" };
  }
  // A server-side failure says nothing about whether the message went out.
  if (response.status >= 500) return { outcome: "unknown" };
  return { outcome: "failed", code: errorCode(body) ?? "META_REJECTED" };
}
