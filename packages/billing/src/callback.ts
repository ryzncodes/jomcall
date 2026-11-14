import { verify } from "./signature.ts";
import type { ProviderResult } from "./provider.ts";

// Shared by the Billplz client and the fake: both speak Billplz's callback
// format, so tests and the simulator exercise the production parser.
const allowed = new Set([
  "id", "collection_id", "paid", "state", "amount", "paid_amount", "due_at",
  "email", "mobile", "name", "url", "paid_at", "x_signature",
  "transaction_id", "transaction_status",
]);
export function parseBillplzCallback(
  body: string,
  contentType: string | null,
  key: string,
): ProviderResult {
  if (!contentType?.toLowerCase().startsWith("application/x-www-form-urlencoded"))
    throw Error("INVALID_CALLBACK");
  const params = new URLSearchParams(body);
  const fields: [string, string][] = [];
  const seen = new Set<string>();
  for (const [k, v] of params) {
    if (!allowed.has(k) || seen.has(k)) throw Error("INVALID_CALLBACK");
    seen.add(k);
    fields.push([k, v]);
  }
  if (!verify(fields, params.get("x_signature"), key)) throw Error("BAD_SIGNATURE");
  const id = params.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw Error("INVALID_CALLBACK");
  const paid = params.get("paid") === "true" && params.get("state") === "paid";
  const raw = params.get("paid_amount") ?? "";
  const amountSen = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const paidAt = parseBillplzTime(params.get("paid_at"));
  const attempt = params.get("transaction_id") || params.get("paid_at") || "";
  return {
    providerRef: id,
    eventKey: `cb:${id}:${paid ? "paid" : "unpaid"}:${attempt}`.slice(0, 200),
    paid,
    amountSen,
    // Billplz handles MYR only (API reference, "Currency").
    currency: "MYR",
    paidAt,
  };
}
// "2018-09-27 15:15:09 +0800"
export function parseBillplzTime(value: string | null) {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!m) return null;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}${m[8]}:${m[9]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}
