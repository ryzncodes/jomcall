import { common } from "../content/public/common.ts";
import { rm } from "../content/public/format.ts";
import type { FaqItem } from "../content/public/types.ts";
import { publicPlans } from "./pricing.ts";
import { OPERATOR } from "./operator.ts";
import { PUBLIC_PAGES, localePath, siteOrigin, type PublicLocale, type PublicPageId } from "./site.ts";

// Structured data for the public pages (spec section 3: only true facts, no
// reviews or ratings). Builders that need an absolute URL return null when
// there is no origin (mock and local mode); <JsonLd> renders nothing for null.
export type LdNode = Record<string, unknown>;

const SITE_NAME = "JomCall";

const PLAN_NAMES = { starter: "Starter", growth: "Growth", payg: "Pay as you go" } as const;
const plainPrice = (sen: number) => (sen / 100).toFixed(2);

export function organizationLd(): LdNode | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    legalName: OPERATOR.legalName,
    identifier: OPERATOR.registrationNumber,
    url: `${origin}/`,
    address: OPERATOR.address,
    sameAs: [OPERATOR.repositoryUrl],
  };
}

export function websiteLd(): LdNode | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: SITE_NAME,
    url: `${origin}/`,
    inLanguage: ["en", "ms"],
    publisher: { "@id": `${origin}/#organization` },
  };
}

export function softwareAppLd(locale: PublicLocale): LdNode | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: common[locale].tagline,
    url: origin + localePath("home", locale),
    inLanguage: locale,
    publisher: { "@id": `${origin}/#organization` },
    offers: publicPlans.map((plan) => ({
      "@type": "Offer",
      name: PLAN_NAMES[plan.code],
      price: plainPrice(plan.monthlyFeeSen),
      priceCurrency: "MYR",
      url: origin + localePath("pricing", locale),
    })),
  };
}

// Only for a page that shows these questions and answers to the visitor.
export function faqLd(items: FaqItem[]): LdNode {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

// Home, then each parent, then the page itself.
export function breadcrumbLd(id: PublicPageId, locale: PublicLocale): LdNode | null {
  const origin = siteOrigin();
  if (!origin) return null;
  const chain: PublicPageId[] = [];
  for (let cur: PublicPageId | undefined = id; cur; ) {
    chain.unshift(cur);
    cur = PUBLIC_PAGES.find((p) => p.id === cur)?.parent;
  }
  if (chain[0] !== "home") chain.unshift("home");
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: chain.map((pageId, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: common[locale].pages[pageId],
      item: origin + localePath(pageId, locale),
    })),
  };
}

// A string safe to place inside <script type="application/ld+json">.
export function ldScriptText(data: LdNode): string {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}
