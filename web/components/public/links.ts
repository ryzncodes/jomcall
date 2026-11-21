import type { PublicLocale } from "../../lib/site.ts";

export type PublicTheme = "light" | "dark";

// Links from the public pages into the app (`/login`, `/signup`, `/app/*`)
// carry the visitor's language and theme, because the app reads both from
// the query string.
export function appHref(
  path: string,
  locale: PublicLocale,
  theme: PublicTheme,
): string {
  const [url, hash] = path.split("#");
  const [pathname, query] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("lang", locale);
  params.set("theme", theme);
  return `${pathname}?${params}${hash ? `#${hash}` : ""}`;
}
