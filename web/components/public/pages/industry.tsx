import { common } from "@/content/public/common";
import { INDUSTRY_SLUGS, industries, industryLabels, type IndustrySlug } from "@/content/public/industries";
import { localePath, type PublicLocale } from "@/lib/site";
import { SampleCall } from "../sample-call";
import { ArticlePage, CallTable, MoreLink, Prose } from "./article";

// One industry page: the calls this business gets and what JomCall does with
// each, a made-up sample call, how setup fits (the setup business type), the
// questions, and the other five industries.
export function IndustryPage({ locale, slug }: { locale: PublicLocale; slug: IndustrySlug }) {
  const t = industries[locale][slug];
  const l = industryLabels[locale];
  return (
    <ArticlePage
      locale={locale}
      page={`industries-${slug}`}
      copy={t}
      faqs={{ heading: common[locale].article.questions, items: t.faqs }}
      relatedHeading={l.others}
      related={INDUSTRY_SLUGS.filter((s) => s !== slug).map((s) => ({
        id: `industries-${s}` as const,
        note: industries[locale][s].summary,
      }))}
      sections={[
        {
          id: "calls",
          heading: t.calls.heading,
          lead: t.calls.body[0],
          children: <CallTable head={[l.callHead, l.doesHead]} rows={t.calls.rows} />,
        },
        {
          id: "sample",
          heading: l.sampleHeading,
          children: (
            <SampleCall locale={locale} business={t.sampleBusiness} lines={t.sample} outcome={t.sampleOutcome} />
          ),
        },
        {
          id: "setup",
          heading: t.setup.heading,
          children: (
            <>
              <p className="setup-type">
                <span className="t-label t-muted">{l.setupLabel}</span>
                <span className="setup-type-name">{t.setupType}</span>
              </p>
              <Prose paras={t.setup.body} />
              <MoreLink href={localePath("how-it-works", locale)}>{l.setupLink}</MoreLink>
            </>
          ),
        },
      ]}
    />
  );
}
