// A Malaysian number as callers dial it at home: +60 becomes a leading 0.
// Other numbers stay as stored.
export const localNumber = (e164: string) =>
  e164.startsWith("+60") ? "0" + e164.slice(3) : e164;
