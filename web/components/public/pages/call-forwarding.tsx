import { forwarding } from "@/content/public/call-forwarding";
import type { PublicLocale } from "@/lib/site";
import { CodesCard } from "../codes-card";
import { ArticlePage, Points, Prose } from "./article";

// The call forwarding guide: the app's four code pairs as a code card, which
// to pick, the steps on a mobile line, an office line, and the check call.
export function CallForwardingPage({ locale }: { locale: PublicLocale }) {
  const t = forwarding[locale];
  const codes = t.codes;
  return (
    <ArticlePage
      locale={locale}
      page="call-forwarding"
      copy={t.page}
      faqs={t.faq}
      related={[{ id: "how-it-works" }, { id: "faq" }, { id: "pricing" }]}
      sections={[
        {
          id: "codes",
          heading: codes.heading,
          lead: codes.lead,
          children: <CodesCard locale={locale} />,
        },
        { id: "choose", heading: t.choose.heading, children: <Points items={t.choose.items} /> },
        {
          id: "mobile",
          heading: t.mobile.heading,
          children: (
            <ol className="art-list">
              {t.mobile.steps.map((step, i) => (
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
        { id: "office", heading: t.office.heading, children: <Prose paras={t.office.body} /> },
        { id: "check", heading: t.check.heading, children: <Prose paras={t.check.body} /> },
      ]}
    />
  );
}
