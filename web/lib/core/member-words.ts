// Words for member roles and invitation states, English then Bahasa
// Melayu. A value the screen does not know is shown as it came.
type Words = readonly [string, string];

const ROLES: Record<string, Words> = {
  owner: ["Owner", "Pemilik"],
  admin: ["Admin", "Pentadbir"],
  staff: ["Staff", "Kakitangan"],
};
const INVITES: Record<string, Words> = {
  pending: ["Waiting", "Menunggu"],
  accepted: ["Joined", "Telah menyertai"],
  revoked: ["Cancelled", "Dibatalkan"],
};
const DELIVERY: Record<string, Words> = {
  pending: ["Email sending", "E-mel sedang dihantar"],
  sent: ["Email sent", "E-mel dihantar"],
  failed: ["Email failed", "E-mel gagal"],
  cancelled: ["Email not sent", "E-mel tidak dihantar"],
  expired: ["Email not sent", "E-mel tidak dihantar"],
  skipped: ["Email not sent", "E-mel tidak dihantar"],
};

const pick = (table: Record<string, Words>, value: string): Words =>
  table[value] ?? [value, value];

export const roleWords = (role: string) => pick(ROLES, role);
export const inviteWords = (state: string) => pick(INVITES, state);
export const deliveryWords = (state: string) => pick(DELIVERY, state);
