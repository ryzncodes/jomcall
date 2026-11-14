import "server-only";
// Meta's webhook for the WhatsApp channel. No session and no CSRF: the
// request is authenticated by its HMAC signature alone. The body is never
// parsed before the signature passes. Events are only stored here; the agent
// process does the rest.
import { mode } from "./config.ts";
import { database } from "./services.ts";
import { namespace } from "../../../packages/domain/src/authorization.ts";
import {
  maxWebhookBytes,
  parseWebhook,
  verifyChallenge,
  verifySignature,
  whatsappReadiness,
} from "../../../packages/whatsapp/src/index.ts";

const plain = (status: number, body = "") =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });

function enabled() {
  if (mode() !== "local") return false;
  return whatsappReadiness().configured;
}

export async function webhookGet(request: Request) {
  if (!enabled()) return plain(404);
  const challenge = verifyChallenge(
    new URL(request.url).searchParams,
    process.env.WHATSAPP_VERIFY_TOKEN ?? "",
  );
  return challenge === null ? plain(403) : plain(200, challenge);
}

async function readRaw(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxWebhookBytes) return null;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxWebhookBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  return Buffer.concat(chunks);
}

export async function webhookPost(request: Request) {
  if (!enabled()) return plain(404);
  const raw = await readRaw(request);
  if (!raw) return plain(413);
  if (
    !verifySignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      process.env.WHATSAPP_APP_SECRET ?? "",
    )
  )
    return plain(401);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    // Signed but unreadable: retrying will not help.
    return plain(200);
  }
  const events = parseWebhook(body);
  if (!events.length) return plain(200);
  try {
    await database().pool.query("select app_private.whatsapp_intake($1,$2)", [
      namespace(),
      JSON.stringify(events),
    ]);
  } catch {
    // Not stored: answer an error so Meta delivers it again.
    console.error("WHATSAPP_INTAKE_FAILED");
    return plain(500);
  }
  return plain(200);
}
