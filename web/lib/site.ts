import { appOrigin, isHosted } from "../../packages/contracts/src/hosting.ts";

export type PublicLocale = "en" | "ms";

const PAGES = [
  { id: "home", path: "/" },
  { id: "pricing", path: "/pricing" },
  { id: "how-it-works", path: "/how-it-works" },
  { id: "call-forwarding", path: "/call-forwarding" },
  { id: "languages", path: "/languages" },
  { id: "faq", path: "/faq" },
  { id: "industries", path: "/industries" },
  { id: "industries-clinics", path: "/industries/clinics", parent: "industries" },
  { id: "industries-salons", path: "/industries/salons", parent: "industries" },
  { id: "industries-car-workshops", path: "/industries/car-workshops", parent: "industries" },
  { id: "industries-aircond-home-repair", path: "/industries/aircond-home-repair", parent: "industries" },
  { id: "industries-restaurants", path: "/industries/restaurants", parent: "industries" },
  { id: "industries-tuition-centres", path: "/industries/tuition-centres", parent: "industries" },
  { id: "compare", path: "/compare" },
  { id: "compare-voicemail", path: "/compare/voicemail", parent: "compare" },
  { id: "compare-receptionist", path: "/compare/receptionist", parent: "compare" },
  { id: "compare-answering-service", path: "/compare/answering-service", parent: "compare" },
  { id: "compare-whatsapp-bot", path: "/compare/whatsapp-bot", parent: "compare" },
  { id: "trust", path: "/trust" },
  { id: "guides", path: "/guides" },
  { id: "guides-what-is-an-ai-receptionist", path: "/guides/what-is-an-ai-receptionist", parent: "guides" },
  { id: "guides-missed-calls-cost", path: "/guides/missed-calls-cost", parent: "guides" },
  // Shares most of its facts with /call-forwarding, so it names that page as
  // its canonical (NOTES.md, Task 8): the sitemap and llms.txt leave it out.
  {
    id: "guides-call-forwarding-malaysia",
    path: "/guides/call-forwarding-malaysia",
    parent: "guides",
    canonical: "call-forwarding",
  },
  { id: "privacy", path: "/privacy" },
  { id: "terms", path: "/terms" },
] as const satisfies readonly {
  id: string;
  path: string;
  parent?: string;
  canonical?: string;
}[];

export type PublicPageId = (typeof PAGES)[number]["id"];

export const PUBLIC_PAGES: readonly {
  id: PublicPageId;
  path: string;
  parent?: PublicPageId;
  // Set when the page's canonical URL is another page's.
  canonical?: PublicPageId;
}[] = PAGES;

// The page whose URL is this page's canonical: itself, unless the registry
// names another page.
export function canonicalPage(id: PublicPageId): PublicPageId {
  return PUBLIC_PAGES.find((p) => p.id === id)?.canonical ?? id;
}

export function localePath(id: PublicPageId, locale: PublicLocale): string {
  const page = PUBLIC_PAGES.find((p) => p.id === id);
  if (!page) throw Error(`UNKNOWN_PAGE: ${id}`);
  if (locale === "en") return page.path;
  return page.path === "/" ? "/ms" : `/ms${page.path}`;
}

// True when this build serves the real, indexable site. Read at call time.
export function isHostedSite(): boolean {
  return isHosted(process.env);
}

// Absolute origin of the public site: APP_ORIGIN in hosted mode, otherwise
// undefined (mock and local pages use relative paths and are noindex).
export function siteOrigin(): string | undefined {
  if (!isHostedSite()) return undefined;
  if (!process.env.APP_ORIGIN?.trim()) throw Error("MISSING_SETTING: APP_ORIGIN");
  return appOrigin();
}

// True only on the real site: hosted mode and an origin whose host is exactly
// jomcall.com. Staging, mock and local stay out of search engines. Robots,
// page metadata, the sitemap and llms.txt all read this one helper.
export function isIndexable(): boolean {
  const origin = siteOrigin();
  if (!origin) return false;
  try {
    return new URL(origin).hostname === "jomcall.com";
  } catch {
    return false;
  }
}
