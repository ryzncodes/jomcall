// Phone numbers as JomCall stores them: E.164 with a leading "+".
const E164 = /^\+[1-9][0-9]{6,14}$/;

export function isE164(value: string): boolean {
  return E164.test(value);
}

// Providers send the dialled and calling numbers in different shapes:
// "+60312345678", "60312345678", "0312345678" (Malaysian national form) or a
// SIP user part. Anything that is not a plain number (for example
// "anonymous" for a withheld caller ID) gives null.
export function toE164(raw: string | undefined | null): string | null {
  const text = String(raw ?? "")
    .trim()
    .replace(/^(?:sip:|tel:)/i, "")
    .replace(/@.*$/, "")
    .replace(/[\s\-().]/g, "");
  if (!/^\+?[0-9]{7,16}$/.test(text)) return null;
  let value = text;
  if (value.startsWith("00")) value = "+" + value.slice(2);
  else if (value.startsWith("0")) value = "+60" + value.slice(1);
  else if (!value.startsWith("+")) value = "+" + value;
  return isE164(value) ? value : null;
}
