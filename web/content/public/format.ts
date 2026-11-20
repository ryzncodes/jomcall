// Ringgit amounts on the public pages, from integer sen, in the house format
// with both decimals and a thousands separator: "RM 49.00", "RM 0.32",
// "RM 1,040.00". The space after RM is a no-break space (U+00A0) so the
// amount never wraps away from "RM". One formatter for every page.
const NBSP = "\u00a0";

function amount(sen: number): string {
  const [whole, cents] = (sen / 100).toFixed(2).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

export function rm(sen: number): string {
  return `RM${NBSP}${amount(sen)}`;
}

// The same amount with a plain space, for plain-text output such as
// llms.txt, where a no-break space would only get in a reader's way.
export function rmText(sen: number): string {
  return `RM ${amount(sen)}`;
}

// Text that leaves the visible page (meta tags, structured data, llms.txt)
// gets plain spaces: the no-break space from rm() only matters for wrapping
// on screen, and elsewhere it is an odd character for readers and parsers.
export function plainSpaces(text: string): string {
  return text.replaceAll(NBSP, " ");
}

// The same function under its earlier name; both give "RM 49.00".
export const rmExact = rm;
