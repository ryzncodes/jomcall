import type { MetadataRoute } from "../lib/next-metadata";
import { isIndexable, siteOrigin } from "../lib/site";

// Open only on the real site (jomcall.com). Everywhere else, search engines
// are asked to stay out entirely.
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/api", "/invite", "/login", "/signup", "/forgot-password", "/open-link", "/admin"],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
