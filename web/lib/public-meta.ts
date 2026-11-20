import type { Metadata } from "next";
import { isHostedSite, localePath, siteOrigin, type PublicLocale, type PublicPageId } from "./site.ts";

export function pageMetadata(
  id: PublicPageId,
  locale: PublicLocale,
  { title, description }: { title: string; description: string },
): Metadata {
  const origin = siteOrigin() ?? "";
  const en = origin + localePath(id, "en");
  const ms = origin + localePath(id, "ms");
  const url = locale === "en" ? en : ms;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: { en, ms, "x-default": en },
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      siteName: "JomCall",
      locale: locale === "en" ? "en_MY" : "ms_MY",
    },
    ...(isHostedSite()
      ? {}
      : { robots: { index: false, follow: false } }),
  };
}
