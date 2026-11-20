// Ringgit amounts on the public pages, from integer sen: whole ringgit
// without decimals ("RM 49"), anything else with two ("RM 0.32").
export function rm(sen: number): string {
  return sen % 100 === 0 ? `RM ${sen / 100}` : `RM ${(sen / 100).toFixed(2)}`;
}
