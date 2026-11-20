import { common } from "@/content/public/common";
import { languages } from "@/content/public/languages";
import type { PublicLocale } from "@/lib/site";
import { Dash } from "../icons";
import { SampleCall } from "../sample-call";
import { ArticlePage, Prose } from "./article";

// The languages page: the four languages as specimens, how the agent follows
// the caller, a made-up call that switches language, and what it does not do.
export function LanguagesPage({ locale }: { locale: PublicLocale }) {
  const t = languages[locale];
  return (
    <ArticlePage
      locale={locale}
      page="languages"
      copy={t.page}
      faqs={t.faq}
      related={[{ id: "how-it-works" }, { id: "industries" }, { id: "faq" }]}
      sections={[
        {
          id: "four",
          heading: t.list.heading,
          lead: t.list.lead,
          children: (
            <ul className="lang-list">
              {t.list.items.map((item) => (
                <li key={item.name}>
                  <h3 className="t-label t-muted">{item.name}</h3>
                  <p className="lang-line" lang={item.lang === locale ? undefined : item.lang}>
                    {item.line}
                  </p>
                  <p className="t-small t-muted">{item.body}</p>
                </li>
              ))}
            </ul>
          ),
        },
        { id: "follow", heading: t.follow.heading, children: <Prose paras={t.follow.body} /> },
        {
          id: "sample",
          heading: t.sample.heading,
          lead: t.sample.lead,
          children: (
            <SampleCall locale={locale} business={t.sample.business} lines={t.sample.lines} outcome={t.sample.outcome} />
          ),
        },
        {
          id: "not-yet",
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
      ]}
      relatedHeading={common[locale].article.related}
    />
  );
}
