// Integer sen to "RM 1,234.50". Only whole numbers of sen are accepted.
export function formatSen(sen: number) {
  if (!Number.isSafeInteger(sen)) throw Error("INVALID_AMOUNT");
  const abs = Math.abs(sen);
  const ringgit = Math.floor(abs / 100)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    cents = (abs % 100).toString().padStart(2, "0");
  return `${sen < 0 ? "−" : ""}RM ${ringgit}.${cents}`;
}
