// Pure text helpers with no Node-only imports, so browser bundles can use
// them (the setup review page recomputes price-row outcomes with them).
// text.ts re-exports these.

// A lookup key is a code in upper case with letters and digits only:
// "ns-60 l" and "NS60L" both become "NS60L".
export const normaliseCode = (text: string) =>
  text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
