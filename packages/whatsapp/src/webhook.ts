// Webhook verification and parsing for the WhatsApp Cloud API. Pure
// functions: no database, no network. Shapes follow Meta's webhook
// documentation as read on 2026-11-14 (docs/research/whatsapp-go-live.md).
import { createHmac, timingSafeEqual } from "node:crypto";

// Meta documents webhook payloads of up to 3 MB.
export const maxWebhookBytes = 3 * 1024 * 1024;
const maxEvents = 500;

function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// The subscription handshake: Meta calls GET with hub.mode, hub.verify_token
// and hub.challenge, and expects the challenge back. Returns the challenge to
// echo, or null to refuse.
export function verifyChallenge(
  query: URLSearchParams,
  verifyToken: string,
): string | null {
  const challenge = query.get("hub.challenge") ?? "";
  if (
    verifyToken.length < 16 ||
    query.get("hub.mode") !== "subscribe" ||
    !equal(query.get("hub.verify_token") ?? "", verifyToken) ||
    !/^[\x21-\x7e]{1,200}$/.test(challenge)
  )
    return null;
  return challenge;
}

function digest(secret: string, bytes: Uint8Array | string) {
  return createHmac("sha256", secret).update(bytes).digest("hex");
}

// X-Hub-Signature-256 is "sha256=" plus the HMAC-SHA256 of the request body,
// keyed with the Meta app secret, compared in constant time.
//
// UNVERIFIED AGAINST META: the WhatsApp pages do not say whether the HMAC is
// taken over the raw bytes or over a form with non-ASCII characters escaped
// as lowercase \uXXXX (a Messenger Platform page describes the latter). The
// raw bytes are checked first, then the escaped form. Confirm with one real
// delivery that contains non-ASCII text before trusting either.
export function verifySignature(
  raw: Uint8Array,
  header: string | null,
  appSecret: string,
): boolean {
  if (appSecret.length < 16) return false;
  const supplied = /^sha256=([a-f0-9]{64})$/.exec(header ?? "")?.[1];
  if (!supplied) return false;
  if (equal(supplied, digest(appSecret, raw))) return true;
  const text = Buffer.from(raw).toString("utf8");
  if (!/[^\x00-\x7f]/.test(text)) return false;
  let escaped = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    escaped +=
      code > 0x7f ? "\\u" + code.toString(16).padStart(4, "0") : text[i];
  }
  return equal(supplied, digest(appSecret, escaped));
}

export type IntakeEvent = {
  // Idempotency key: a retried or duplicated delivery produces the same key.
  key: string;
  phoneNumberId: string;
  kind: "message" | "status";
  payload: Record<string, unknown>;
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? Array.from(value).slice(0, max).join("") : "";
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const mediaTypes = ["image", "audio", "video", "document", "sticker"];

// Reduces a webhook body to the facts JomCall stores. Anything it does not
// recognise is skipped, never guessed. Media is recorded by ID and type only;
// nothing is downloaded.
export function parseWebhook(body: unknown): IntakeEvent[] {
  const root = record(body);
  if (root.object !== "whatsapp_business_account") return [];
  const events: IntakeEvent[] = [];
  for (const entry of list(root.entry))
    for (const change of list(record(entry).changes)) {
      if (record(change).field !== "messages") continue;
      const value = record(record(change).value);
      const phoneNumberId = text(record(value.metadata).phone_number_id, 40);
      if (!/^[0-9]{5,30}$/.test(phoneNumberId)) continue;
      const names = new Map<string, string>();
      for (const contact of list(value.contacts)) {
        const c = record(contact);
        if (typeof c.wa_id === "string")
          names.set(c.wa_id, text(record(c.profile).name, 120));
      }
      for (const item of list(value.messages)) {
        const m = record(item);
        const id = text(m.id, 256);
        if (!id || events.length >= maxEvents) continue;
        const type = text(m.type, 40);
        const media = mediaTypes.includes(type) ? record(m[type]) : null;
        // A tapped button or list row is the customer's answer in words.
        const reply = record(record(m.interactive).button_reply).title
          ? record(record(m.interactive).button_reply).title
          : record(record(m.interactive).list_reply).title;
        const words =
          type === "text"
            ? record(m.text).body
            : type === "interactive"
              ? reply
              : type === "button"
                ? record(m.button).text
                : undefined;
        events.push({
          key: "m:" + id,
          phoneNumberId,
          kind: "message",
          payload: {
            id,
            // Absent when the customer is known only by a username. Such a
            // message is stored as ignored; see the design's open items.
            from: text(m.from, 20),
            timestamp: /^[0-9]{1,12}$/.test(String(m.timestamp ?? ""))
              ? String(m.timestamp)
              : "",
            type: typeof words === "string" && words ? "text" : type,
            ...(typeof words === "string" && words
              ? { text: text(words, 4096) }
              : {}),
            name: names.get(text(m.from, 20)) ?? "",
            ...(media
              ? {
                  media: {
                    id: text(media.id, 200),
                    mimeType: text(media.mime_type, 100),
                    sha256: text(media.sha256, 100),
                    caption: text(media.caption, 1024),
                    filename: text(media.filename, 200),
                  },
                }
              : {}),
          },
        });
      }
      for (const item of list(value.statuses)) {
        const s = record(item);
        const id = text(s.id, 256),
          status = text(s.status, 20);
        if (
          !id ||
          !["sent", "delivered", "read", "failed"].includes(status) ||
          events.length >= maxEvents
        )
          continue;
        const code = record(list(s.errors)[0]).code;
        events.push({
          key: "s:" + id + ":" + status,
          phoneNumberId,
          kind: "status",
          payload: {
            id,
            status,
            timestamp: /^[0-9]{1,12}$/.test(String(s.timestamp ?? ""))
              ? String(s.timestamp)
              : "",
            ...(Number.isInteger(code) ? { errorCode: String(code) } : {}),
          },
        });
      }
    }
  return events;
}

// Builds a delivery in Meta's shape. Used by the local simulator and tests;
// the names and numbers passed in must be fictional.
export function buildInboundText(input: {
  phoneNumberId: string;
  from: string;
  name: string;
  id: string;
  text: string;
  timestamp?: number;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "",
                phone_number_id: input.phoneNumberId,
              },
              contacts: [{ profile: { name: input.name }, wa_id: input.from }],
              messages: [
                {
                  from: input.from,
                  id: input.id,
                  timestamp: String(
                    input.timestamp ?? Math.floor(Date.now() / 1000),
                  ),
                  type: "text",
                  text: { body: input.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildStatus(input: {
  phoneNumberId: string;
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipient: string;
  errorCode?: number;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "",
                phone_number_id: input.phoneNumberId,
              },
              statuses: [
                {
                  id: input.id,
                  status: input.status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: input.recipient,
                  ...(input.errorCode
                    ? { errors: [{ code: input.errorCode }] }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function signBody(raw: Uint8Array | string, appSecret: string) {
  return "sha256=" + digest(appSecret, raw);
}
