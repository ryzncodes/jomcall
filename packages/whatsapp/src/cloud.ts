// Client for Meta's WhatsApp Business Platform Cloud API.
//
// Written from Meta's public documentation, read on 2026-11-14; tests use a
// fake fetch only. Against Meta, on hosted staging on 2026-11-17 and
// 2026-11-18, only verifyNumber (the number check on connect) and sendText
// have run. subscribeApp, listTemplates and sendTemplate have not. See docs/research/whatsapp-go-live.md for the sources.
//
// This is a hosted service. The client refuses to exist unless
// JOMCALL_WHATSAPP_PROVIDER=cloud, and only the agent process may create it.
// It never logs a token, a phone number or a message body.
import {
  whatsappMode,
  type NumberCheck,
  type ProviderTemplate,
  type SendOutcome,
  type SendTarget,
  type SubscribeResult,
  type TemplateList,
  type TemplateMessage,
  type WhatsAppProvider,
} from "./provider.ts";

// Latest Graph API version on the changelog page on 2026-11-14 (released
// 2026-11-04). The only place the version is named.
export const graphVersion = "v27.0";
const graphOrigin = "https://graph.facebook.com";

// Template listing limits. A longer list is refused as a whole, because the
// database treats a template missing from the list as not at the provider.
export const templatePageSize = 100;
export const templatePageCap = 10;
export const templateCap = 1000;

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
        return {
          ok: false,
          reason: errorCode(body) ?? "VERIFICATION_FAILED",
          ...detailOf(body),
        };
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
    // Observed against Meta on 2026-11-18 (hosted staging, test number):
    // POST /<WABA_ID>/subscribed_apps with the token as a bearer and no body
    // answers {"success":true}, and events reach the webhook only after it.
    // Repeating it is harmless. Success only when the answer says so.
    async subscribeApp(input): Promise<SubscribeResult> {
      if (!/^[0-9]{5,30}$/.test(input.wabaId) || !input.accessToken)
        return { ok: false, reason: "INVALID_TARGET" };
      let response: Response;
      try {
        response = await send(
          `${graphOrigin}/${graphVersion}/${input.wabaId}/subscribed_apps`,
          {
            method: "POST",
            headers: { authorization: "Bearer " + input.accessToken },
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      } catch {
        return { ok: false, reason: "PROVIDER_UNREACHABLE" };
      }
      const body = await readJson(response);
      if (!response.ok) {
        const meta = errorCode(body);
        if (meta) return { ok: false, reason: meta, ...detailOf(body) };
        // A server error with no Meta code is temporary.
        return {
          ok: false,
          reason:
            response.status >= 500 ? "PROVIDER_UNREACHABLE" : "SUBSCRIBE_FAILED",
        };
      }
      return body?.success === true
        ? { ok: true }
        : { ok: false, reason: "SUBSCRIBE_FAILED" };
    },
    // UNCONFIRMED AGAINST META: GET /<WABA_ID>/message_templates with the
    // fields name, language and status, as recorded in the WhatsApp design
    // (open item O8). Paging is assumed to follow the usual Graph shape
    // (paging.cursors.after, with paging.next present while more pages
    // remain). The next request is always built here from the cursor; a URL
    // taken from the response is never fetched, so the token cannot be sent
    // anywhere else.
    async listTemplates(input): Promise<TemplateList> {
      if (!/^[0-9]{5,30}$/.test(input.wabaId) || !input.accessToken)
        return { ok: false, reason: "INVALID_TARGET" };
      const templates: ProviderTemplate[] = [];
      const deadline = input.signal;
      const timedOut = { ok: false, reason: "TEMPLATE_LIST_TIMEOUT" } as const;
      let after: string | null = null;
      for (let page = 0; page < templatePageCap; page++) {
        // The caller's deadline has passed: stop paging.
        if (deadline?.aborted) return timedOut;
        const query = new URLSearchParams({
          fields: "name,language,status",
          limit: String(templatePageSize),
          ...(after ? { after } : {}),
        });
        let response: Response;
        let body: any;
        try {
          response = await send(
            `${graphOrigin}/${graphVersion}/${input.wabaId}/message_templates?${query}`,
            {
              headers: { authorization: "Bearer " + input.accessToken },
              signal: deadline
                ? AbortSignal.any([AbortSignal.timeout(timeoutMs), deadline])
                : AbortSignal.timeout(timeoutMs),
            },
          );
          body = await readJson(response);
        } catch {
          return deadline?.aborted
            ? timedOut
            : { ok: false, reason: "PROVIDER_UNREACHABLE" };
        }
        if (deadline?.aborted) return timedOut;
        if (!response.ok)
          return {
            ok: false,
            reason: errorCode(body) ?? "TEMPLATE_LIST_FAILED",
          };
        if (!Array.isArray(body?.data))
          return { ok: false, reason: "TEMPLATE_LIST_INVALID" };
        for (const item of body.data) {
          const t = readTemplate(item);
          // One malformed item makes the whole list untrustworthy.
          if (t === "invalid")
            return { ok: false, reason: "TEMPLATE_LIST_INVALID" };
          if (t) templates.push(t);
        }
        if (templates.length > templateCap)
          return { ok: false, reason: "TEMPLATE_LIST_TOO_LONG" };
        const cursor = body?.paging?.cursors?.after;
        if (!body?.paging?.next) return { ok: true, templates };
        if (typeof cursor !== "string" || !/^[A-Za-z0-9_=-]{1,512}$/.test(cursor))
          return { ok: false, reason: "TEMPLATE_LIST_INVALID" };
        after = cursor;
      }
      // More pages than the cap allows: refuse rather than report a part.
      return { ok: false, reason: "TEMPLATE_LIST_TOO_LONG" };
    },
  };
}

// One listed template. A missing, empty or non-text name, language or status, or a
// status that is not upper-case letters and underscores, is "invalid" and
// fails the whole list: the database would otherwise read the template as
// missing at the provider. A name or language in a shape no local template
// can have (the same rules as templateCreate) cannot match any local row,
// so it is left out (null).
function readTemplate(item: any): ProviderTemplate | "invalid" | null {
  const name = item?.name,
    language = item?.language,
    status = item?.status;
  if (
    typeof name !== "string" ||
    !name ||
    typeof language !== "string" ||
    !language ||
    typeof status !== "string" ||
    !/^[A-Z_]{1,60}$/.test(status)
  )
    return "invalid";
  if (
    !/^[a-z0-9_]{1,512}$/.test(name) ||
    !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)
  )
    return null;
  return { name, language, status };
}

// Meta's code with its subcode (META_100_33), for the log only.
function detailOf(body: any): { detail?: string } {
  const code = errorCode(body);
  const sub = body?.error?.error_subcode;
  return code && Number.isInteger(sub) && sub >= 0
    ? { detail: code + "_" + sub }
    : {};
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
