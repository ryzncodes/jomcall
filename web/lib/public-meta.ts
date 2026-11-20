import type { Metadata } from "next";
import { canonicalPage, isIndexable, localePath, siteOrigin, type PublicLocale, type PublicPageId } from "./site.ts";

export function pageMetadata(
  id: PublicPageId,
  locale: PublicLocale,
  { title, description }: { title: string; description: string },
): Metadata {
  const origin = siteOrigin() ?? "";
  // A page that names another page as canonical points its canonical, its
  // language alternates and its Open Graph URL there, so the signals agree.
  const target = canonicalPage(id);
  const en = origin + localePath(target, "en");
  const ms = origin + localePath(target, "ms");
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
    ...(isIndexable()
      ? {}
      : { robots: { index: false, follow: false } }),
  };
}
