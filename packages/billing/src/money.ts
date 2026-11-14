// Integer sen to "RM 1,234.50". Never uses floating point for the sen part.
export function formatSen(sen: number | bigint, locale: "en" | "ms" = "en") {
  const value = BigInt(sen),
    negative = value < 0n,
    abs = negative ? -value : value;
  const ringgit = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    cents = (abs % 100n).toString().padStart(2, "0");
  void locale;
  return `${negative ? "−" : ""}RM ${ringgit}.${cents}`;
}
