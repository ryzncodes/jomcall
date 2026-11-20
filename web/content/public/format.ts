// Ringgit amounts on the public pages, from integer sen, in the house format
// with both decimals: "RM 49.00", "RM 0.32". One formatter for every page.
export function rm(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

// The same function under its earlier name; both give "RM 49.00".
export const rmExact = rm;
