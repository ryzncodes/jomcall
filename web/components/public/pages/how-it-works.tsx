import { howItWorks } from "@/content/public/how-it-works";
import { localePath, type PublicLocale } from "@/lib/site";
import { ArticlePage, MoreLink, Note, Points, Prose, Steps } from "./article";

// How it works: the six steps after sign-up (the app checklist's names), what
// the agent does on a call, and keeping your number.
export function HowItWorksPage({ locale }: { locale: PublicLocale }) {
  const t = howItWorks[locale];
  return (
    <ArticlePage
      locale={locale}
      page="how-it-works"
      copy={t.page}
      faqs={t.faq}
      related={[{ id: "call-forwarding" }, { id: "languages" }, { id: "pricing" }]}
      sections={[
        {
          id: "steps",
          heading: t.steps.heading,
          lead: t.steps.lead,
          children: (
            <Steps
              aside={t.steps.you}
              items={t.steps.items.map((s) => ({ name: s.name, extra: s.you, body: s.body }))}
            />
          ),
        },
        {
          id: "on-a-call",
          heading: t.call.heading,
          lead: t.call.lead,
          children: (
            <>
              <Points items={t.call.items} />
              <Note>{t.call.note}</Note>
            </>
          ),
        },
        {
          id: "your-number",
          heading: t.number.heading,
          children: (
            <>
              <Prose paras={t.number.body} />
              <MoreLink href={localePath("call-forwarding", locale)}>{t.number.link}</MoreLink>
            </>
          ),
        },
      ]}
    />
  );
}
