// Text the engine writes that is worth testing on its own.

// The invitation email, English then BM. The link is the only way to join.
export function invitationText(link: string): string {
  return [
    "You have been invited to a workspace on JomCall.",
    "",
    "Open this link to join. You will be asked to sign in or create an account with this email address first.",
    link,
    "",
    "If you were not expecting this, ignore this message.",
    "",
    "----------------------------------------",
    "",
    "Anda telah dijemput ke satu ruang kerja di JomCall.",
    "",
    "Buka pautan ini untuk menyertai. Anda akan diminta log masuk atau mencipta akaun dengan alamat e-mel ini dahulu.",
    link,
    "",
    "Jika anda tidak menjangkakan jemputan ini, abaikan mesej ini.",
  ].join("\n");
}

// A short reason for a failed job that is safe to log: an error code such as
// ETIMEDOUT or EAUTH, else the error's class name. Never the message.
export function failureCode(e: unknown): string {
  const safe = (v: unknown) =>
    typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : null;
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; name?: unknown; message?: unknown };
    return (
      safe(o.code) ??
      (/^[A-Z][A-Z0-9_]{2,39}$/.test(String(o.message))
        ? String(o.message)
        : null) ??
      safe(o.name) ??
      "UNKNOWN"
    );
  }
  return "UNKNOWN";
}
