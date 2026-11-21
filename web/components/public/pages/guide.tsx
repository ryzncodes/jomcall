import { common } from "@/content/public/common";
import { GUIDE_SLUGS, guides, guidesIndex, type GuideSlug } from "@/content/public/guides";
import { localePath, type PublicLocale } from "@/lib/site";
import { CodesCard } from "../codes-card";
import { Dash } from "../icons";
import { Worksheet } from "../worksheet";
import { ArticlePage, CallTable, MoreLink, Points, Prose, type ArticleSection } from "./article";
import { IndexListPage } from "./index-list";

// The three guides on the shared reading layout. Each has its own sections;
// the missed-calls guide is built around the worksheet, its one bold moment.
export function GuidePage({ locale, slug }: { locale: PublicLocale; slug: GuideSlug }) {
  const t = guides[locale][slug];
  const others = GUIDE_SLUGS.filter((s) => s !== slug).map((s) => ({
    id: `guides-${s}` as const,
    note: guides[locale][s].summary,
  }));
  return (
    <ArticlePage
      locale={locale}
      page={`guides-${slug}`}
      copy={t}
      sections={sections(locale, slug)}
      faqs={{ heading: common[locale].article.questions, items: t.faqs }}
      related={[...others, { id: "compare" }]}
    />
  );
}

function sections(locale: PublicLocale, slug: GuideSlug): ArticleSection[] {
  if (slug === "what-is-an-ai-receptionist") {
    const t = guides[locale][slug];
    return [
      { id: "what", heading: t.what.heading, children: <Prose paras={t.what.body} /> },
      { id: "does", heading: t.does.heading, lead: t.does.lead, children: <Points items={t.does.items} /> },
      { id: "differs", heading: t.differs.heading, children: <Prose paras={t.differs.body} /> },
      {
        id: "not",
        heading: t.not.heading,
        children: (
          <ul className="art-not">
            {t.not.items.map((item) => (
              <li key={item}>
                <Dash />
                {item}
              </li>
            ))}
          </ul>
        ),
      },
      {
        id: "ask",
        heading: t.ask.heading,
        lead: t.ask.lead,
        children: <CallTable head={t.ask.head} rows={t.ask.rows} />,
      },
    ];
  }
  if (slug === "missed-calls-cost") {
    const t = guides[locale][slug];
    return [
      {
        id: "sheet",
        heading: t.sheet.heading,
        lead: t.sheet.lead,
        children: <Worksheet locale={locale} mode="missed" />,
      },
      { id: "find", heading: t.find.heading, children: <Points items={t.find.items} /> },
      { id: "leaves", heading: t.leaves.heading, children: <Prose paras={t.leaves.body} /> },
      {
        id: "next",
        heading: t.next.heading,
        children: (
          <>
            <Prose paras={t.next.body} />
            <p className="guide-links">
              <MoreLink href={localePath("call-forwarding", locale)}>{t.next.forwarding}</MoreLink>
              <MoreLink href={localePath("pricing", locale)}>{t.next.pricing}</MoreLink>
            </p>
          </>
        ),
      },
    ];
  }
  const t = guides[locale][slug];
  return [
    { id: "what", heading: t.what.heading, children: <Prose paras={t.what.body} /> },
    { id: "codes", heading: t.codes.heading, lead: t.codes.lead, children: <CodesCard locale={locale} /> },
    {
      id: "before",
      heading: t.before.heading,
      children: (
        <ol className="art-list">
          {t.before.steps.map((step, i) => (
            <li key={step}>
              <span className="t-data" aria-hidden="true">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ),
    },
    {
      id: "full",
      heading: t.full.heading,
      children: (
        <>
          <Prose paras={t.full.body} />
          <MoreLink href={localePath("call-forwarding", locale)}>{t.full.link}</MoreLink>
        </>
      ),
    },
  ];
}

export function GuidesIndexPage({ locale }: { locale: PublicLocale }) {
  const t = guidesIndex[locale];
  return (
    <IndexListPage
      locale={locale}
      page="guides"
      copy={t.page}
      heading={t.heading}
      items={GUIDE_SLUGS.map((slug) => ({ id: `guides-${slug}` as const, note: guides[locale][slug].summary }))}
    />
  );
}
