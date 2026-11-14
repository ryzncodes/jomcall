// Sends one signed, fake WhatsApp message to the local app's webhook, as if
// Meta delivered it. Works only when the local app runs with
// JOMCALL_WHATSAPP_PROVIDER=fake. Nothing leaves this machine.
//
//   npm run whatsapp:simulate -- --to <phone_number_id> --from 60123456789 --text "Buka pukul berapa?"
//   npm run whatsapp:simulate -- --to <phone_number_id> --status read --id <wamid>
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  buildInboundText,
  buildStatus,
  signBody,
} from "../../packages/whatsapp/src/webhook.ts";
import { whatsappMode } from "../../packages/whatsapp/src/provider.ts";

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    from: { type: "string", default: "60123456789" },
    name: { type: "string", default: "Pelanggan Contoh" },
    text: { type: "string" },
    status: { type: "string" },
    id: { type: "string" },
    url: {
      type: "string",
      default: "http://127.0.0.1:4182/api/whatsapp/webhook",
    },
  },
});

function fail(code: string): never {
  console.error(code);
  process.exit(1);
}

if (whatsappMode() !== "fake") fail("WHATSAPP_SIMULATOR_NEEDS_FAKE_MODE");
const url = new URL(values.url!);
if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  fail("WHATSAPP_SIMULATOR_LOCAL_ONLY");
const secret = process.env.WHATSAPP_APP_SECRET ?? "";
if (secret.length < 16) fail("WHATSAPP_APP_SECRET_MISSING");
if (!values.to || !/^[0-9]{5,30}$/.test(values.to))
  fail("USAGE: --to <phone_number_id>");
if (!/^[0-9]{8,15}$/.test(values.from!))
  fail("USAGE: --from <digits, no plus>");

let body: unknown;
if (values.status) {
  if (
    !["sent", "delivered", "read", "failed"].includes(values.status) ||
    !values.id
  )
    fail("USAGE: --status sent|delivered|read|failed --id <wamid>");
  body = buildStatus({
    phoneNumberId: values.to,
    id: values.id,
    status: values.status as "sent" | "delivered" | "read" | "failed",
    recipient: values.from!,
  });
} else {
  if (!values.text) fail("USAGE: --text <message>");
  body = buildInboundText({
    phoneNumberId: values.to,
    from: values.from!,
    name: values.name!,
    id: "wamid.SIM" + randomUUID(),
    text: values.text,
  });
}

const raw = JSON.stringify(body);
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": signBody(raw, secret),
  },
  body: raw,
});
console.log(`webhook answered ${response.status}`);
if (!response.ok) process.exit(1);
