// What the header and footer link to, per spec section 7. Plain data, so the
// server components render it and the tests can check it.
import { common } from "../../content/public/common.ts";
import { localePath, type PublicLocale, type PublicPageId } from "../../lib/site.ts";

export type NavLinkItem = { label: string; href: string; current?: boolean };
export type NavEntry =
  | ({ kind: "link" } & NavLinkItem)
  | {
      kind: "group";
      id: string;
      label: string;
      items: NavLinkItem[];
      foot?: NavLinkItem;
      wide?: boolean;
    };

export const INDUSTRIES = [
  "industries-clinics",
  "industries-salons",
  "industries-car-workshops",
  "industries-aircond-home-repair",
  "industries-restaurants",
  "industries-tuition-centres",
] as const satisfies readonly PublicPageId[];

export function pageLink(
  id: PublicPageId,
  locale: PublicLocale,
  page: PublicPageId,
): NavLinkItem {
  return {
    label: common[locale].pages[id],
    href: localePath(id, locale),
    current: id === page,
  };
}

// Header menus: Product, Industries, Pricing, Resources.
export function headerEntries(locale: PublicLocale, page: PublicPageId): NavEntry[] {
  const t = common[locale];
  const link = (id: PublicPageId) => pageLink(id, locale, page);
  return [
    {
      kind: "group",
      id: "product",
      label: t.groups.product,
      items: (["how-it-works", "languages", "call-forwarding", "trust"] as const).map(link),
    },
    {
      kind: "group",
      id: "industries",
      label: t.groups.industries,
      items: INDUSTRIES.map(link),
      foot: link("industries"),
      wide: true,
    },
    { kind: "link", ...link("pricing") },
    {
      kind: "group",
      id: "resources",
      label: t.groups.resources,
      items: (["faq", "guides", "compare"] as const).map(link),
    },
  ];
}

// The footer lists every public page, grouped. Home is the brand link.
export const FOOTER_GROUPS = [
  ["product", ["how-it-works", "languages", "call-forwarding", "pricing", "trust"]],
  ["industries", [...INDUSTRIES, "industries"]],
  [
    "resources",
    [
      "faq",
      "guides",
      "guides-what-is-an-ai-receptionist",
      "guides-missed-calls-cost",
      "guides-call-forwarding-malaysia",
    ],
  ],
  [
    "compare",
    [
      "compare",
      "compare-voicemail",
      "compare-receptionist",
      "compare-answering-service",
      "compare-whatsapp-bot",
    ],
  ],
  ["legal", ["privacy", "terms"]],
] as const satisfies readonly (readonly [
  keyof (typeof common)["en"]["groups"],
  readonly PublicPageId[],
])[];

export const FOOTER_PAGES: readonly PublicPageId[] = [
  "home",
  ...FOOTER_GROUPS.flatMap(([, ids]) => ids),
];

// The same page in the other language.
export function languageLink(locale: PublicLocale, page: PublicPageId) {
  const other: PublicLocale = locale === "en" ? "ms" : "en";
  return {
    href: localePath(page, other),
    label: common[locale].language,
    lang: other,
  };
}
