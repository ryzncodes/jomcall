import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, isIndexable, localePath, siteOrigin } from "../lib/site";

// Every canonical public page in both languages, each pointing at its twin.
// A page whose canonical is another page is left out. Empty unless the site
// is indexable.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexable()) return [];
  const origin = siteOrigin();
  return PUBLIC_PAGES.filter((p) => !p.canonical).flatMap(({ id }) => {
    const en = origin + localePath(id, "en");
    const ms = origin + localePath(id, "ms");
    const alternates = { languages: { en, ms } };
    return [
      { url: en, alternates },
      { url: ms, alternates },
    ];
  });
}
