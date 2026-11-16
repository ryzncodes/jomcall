// Pure rules the WhatsApp template list relies on, kept apart so they can be
// tested without a browser.
import { providerStatusNotFound } from "../../../packages/contracts/src/whatsapp";

// The marker the database stores on the channel while a claimed check has
// not been answered yet.
export const syncPendingReason = "TEMPLATE_SYNC_PENDING";

// The line about the last check with WhatsApp, for the whole list.
export type SyncLine = "checking" | "failed" | "checked" | null;
export function syncLine(
  syncedAt: string | null,
  reason: string | null,
): SyncLine {
  if (reason === syncPendingReason) return "checking";
  if (reason) return "failed";
  return syncedAt ? "checked" : null;
}

// The note under one template about what WhatsApp said of it.
//   not_found      seen at WhatsApp before, missing from the last list
//   from_provider  its status comes from WhatsApp
//   not_listed     the last check succeeded and WhatsApp did not list it
export type TemplateNote = "not_found" | "from_provider" | "not_listed" | null;
export function templateNote(
  t: { provider_status: string | null },
  syncedAt: string | null,
  reason: string | null,
): TemplateNote {
  if (t.provider_status === providerStatusNotFound) return "not_found";
  if (t.provider_status !== null) return "from_provider";
  return syncLine(syncedAt, reason) === "checked" ? "not_listed" : null;
}
