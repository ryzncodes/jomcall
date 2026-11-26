// The call log's one line for a call's result, shared with the contact
// timeline so the two cannot drift.
import type { CallSummary } from "../../../packages/contracts/src/phone";

export function outcomeText(
  c: Pick<CallSummary, "state" | "refusal" | "outcome">,
  w: (en: string, ms: string) => string,
) {
  if (c.state === "refused")
    return c.refusal === "LINES_BUSY" || c.refusal === "CALLER_LIMIT"
      ? w("Busy line played", "Talian sibuk dimainkan")
      : c.refusal === "NO_PHONE_ENTITLEMENT"
        ? w(
            "Not answered: no plan with a phone number. Choose a plan in Billing.",
            "Tidak dijawab: tiada pelan dengan nombor telefon. Pilih pelan di Bil & penggunaan.",
          )
        : c.refusal === "WALLET_UNFUNDED" || c.refusal === "WALLET_EXHAUSTED"
          ? w(
              "Not answered: the wallet was empty. Top up in Billing.",
              "Tidak dijawab: dompet kosong. Tambah nilai di Bil & penggunaan.",
            )
          : w("Not answered", "Tidak dijawab");
  if (c.state === "active") return w("On the line", "Sedang dalam talian");
  const map: Record<string, [string, string]> = {
    answered: ["Answered", "Dijawab"],
    booking_proposed: ["Booking to confirm", "Tempahan untuk disahkan"],
    message: ["Message taken", "Mesej diambil"],
    handoff: ["Staff follow-up", "Susulan staf"],
    transferred: ["Transferred", "Dipindahkan"],
    transfer_failed: ["Transfer not answered", "Pindahan tidak dijawab"],
    abandoned: ["Caller hung up", "Pemanggil meletak telefon"],
  };
  const pair = c.outcome ? map[c.outcome] : undefined;
  return pair ? w(pair[0], pair[1]) : w("Ended", "Tamat");
}
