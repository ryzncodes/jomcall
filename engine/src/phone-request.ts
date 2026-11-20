// Emails about phone number requests. The database answers
// app_private.phone_request_notices() with the requests to write about and
// marks each before this is sent: an open request is announced to the
// operator (JOMCALL_OPERATOR_EMAIL) and again every 4 hours while it stays
// open; a number that is ready is announced once to the organization's
// owners, English then Bahasa Melayu. The operator email names the
// workspace and the person who asked; the owner email names only their own
// number.
export type OpenRequest = {
  id: string;
  orgId: string;
  orgName: string | null;
  area: string;
  forwardFrom: string | null;
  requestedAt: string;
  requestedBy: string | null;
};
export type ReadyRequest = { id: string; e164: string | null; emails: string[] };
export type PhoneRequestNotices = { open: OpenRequest[]; ready: ReadyRequest[] };

const line = (s: string | null) => (s ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 200);

export function openRequestMail(r: OpenRequest) {
  return {
    subject: `JomCall: phone number requested (${line(r.orgName) || r.orgId})`,
    text: [
      "A workspace is waiting for a phone number.",
      "",
      `Workspace: ${line(r.orgName)} (${r.orgId})`,
      `Area wanted: ${r.area}`,
      `Their existing number: ${r.forwardFrom ?? "not given"}`,
      `Asked by: ${line(r.requestedBy) || "unknown"}`,
      `Asked at: ${r.requestedAt}`,
      "",
      "Buy a number with the phone-provision command, then add it to the workspace (infra/hosted/RUNBOOK.md step 11). This email repeats every 4 hours until the number is added.",
    ].join("\n"),
  };
}

// 0 in front instead of +60: what a Malaysian phone dials in a forwarding code.
export const nationalNumber = (e164: string) =>
  e164.startsWith("+60") ? "0" + e164.slice(3) : e164;

export function readyRequestMail(r: ReadyRequest, appBase: string) {
  const where = `${appBase.replace(/\/+$/, "")}/app/phone-numbers`;
  const number = r.e164 ?? "";
  const local = nationalNumber(number);
  return {
    subject: "JomCall: your phone number is ready / nombor telefon anda sudah sedia",
    text: [
      `Your JomCall phone number is ready: ${number}`,
      "Calls to it are answered by your published agent.",
      `To send your existing business number to it, set call forwarding on that line to ${local}. The steps for each kind of line are here: ${where}`,
      "Call the number once yourself to hear it.",
      "",
      `Nombor telefon JomCall anda sudah sedia: ${number}`,
      "Panggilan ke nombor ini dijawab oleh ejen anda yang diterbitkan.",
      `Untuk menghantar panggilan nombor perniagaan sedia ada anda ke nombor ini, tetapkan pemajuan panggilan pada talian itu ke ${local}. Langkah bagi setiap jenis talian ada di sini: ${where}`,
      "Cuba telefon nombor ini sekali untuk mendengarnya.",
    ].join("\n"),
  };
}
