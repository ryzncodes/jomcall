import type { Channels } from "../../../packages/contracts/src/phone";

// The line under "Agent configuration" on Home: which channels this
// workspace has connected. [English, Bahasa Melayu], or null while the read
// is loading or failed, so the page never claims a state it does not know.
export function channelLine(
  channels: Pick<Channels, "phone" | "whatsapp"> | undefined,
): [string, string] | null {
  if (!channels) return null;
  if (channels.phone && channels.whatsapp)
    return [
      "Phone line and WhatsApp connected",
      "Talian telefon dan WhatsApp disambungkan",
    ];
  if (channels.whatsapp) return ["WhatsApp connected", "WhatsApp disambungkan"];
  if (channels.phone)
    return ["Phone line connected", "Talian telefon disambungkan"];
  return ["Channels not connected yet", "Saluran belum disambungkan"];
}
