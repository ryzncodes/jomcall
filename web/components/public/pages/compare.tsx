import { common } from "@/content/public/common";
import {
  COMPARE_SLUGS,
  compare,
  compareIndex,
  compareLabels,
  jomcallFacts,
  type CompareRow,
  type CompareSlug,
} from "@/content/public/compare";
import type { PublicLocale } from "@/lib/site";
import { Dash } from "../icons";
import { Worksheet } from "../worksheet";
import { ArticlePage, Prose } from "./article";
import { IndexListPage } from "./index-list";

// One comparison page: the short answer, a factual table, when each option is
// the better choice (the other option first), the receptionist page's own
// cost sheet, and questions. Every JomCall cell is a line of `jomcallFacts`.
export function ComparePage({ locale, slug }: { locale: PublicLocale; slug: CompareSlug }) {
  const t = compare[locale][slug];
  const l = compareLabels[locale];
  const sections = [
    { id: "short", heading: t.short.heading, children: <Prose paras={t.short.body} /> },
    {
      id: "table",
      heading: t.table.heading,
      lead: t.table.lead,
      children: <CompareTable locale={locale} them={t.them} rows={t.table.rows} topic={l.topic} />,
    },
    {
      id: "better",
      heading: t.better.heading,
      children: (
        <div className="cmp-better">
          {[t.better.them, t.better.us].map((side, i) => (
            <div key={side.name} className="cmp-side" data-us={i === 1 ? "true" : undefined}>
              <h3 className="t-h3">{side.name}</h3>
              <ul>
                {side.points.map((point) => (
                  <li key={point}>
                    <Dash />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ),
    },
    ...(slug === "receptionist"
      ? [
          {
            id: "cost",
            heading: l.cost.heading,
            lead: l.cost.lead,
            children: <Worksheet locale={locale} mode="cost" />,
          },
        ]
      : []),
  ];
  return (
    <ArticlePage
      locale={locale}
      page={`compare-${slug}`}
      copy={t}
      heroExtra={
        slug === "whatsapp-bot" ? (
          <p className="cmp-waiting" role="note">
            <strong>{l.waiting.title}</strong> {l.waiting.body}
          </p>
        ) : undefined
      }
      sections={sections}
      faqs={{ heading: common[locale].article.questions, items: t.faqs }}
      relatedHeading={l.others}
      related={[
        ...COMPARE_SLUGS.filter((s) => s !== slug).map((s) => ({
          id: `compare-${s}` as const,
          note: compare[locale][s].summary,
        })),
        { id: "pricing" as const },
      ]}
    />
  );
}

// The table as rows of a description list: the topic, then the other option
// and JomCall, each cell with its own visible label on a phone. From 768 px
// the labels move into a header row and the three sit side by side.
function CompareTable({
  locale,
  them,
  rows,
  topic,
}: {
  locale: PublicLocale;
  them: string;
  rows: CompareRow[];
  topic: string;
}) {
  const us = compareLabels[locale].us;
  const facts = jomcallFacts[locale];
  return (
    <div className="cmp-table">
      <p className="cmp-row cmp-head t-label" aria-hidden="true">
        <span>{topic}</span>
        <span>{them}</span>
        <span>{us}</span>
      </p>
      <dl>
        {rows.map((row) => (
          <div key={row.topic} className="cmp-row">
            <dt>{row.topic}</dt>
            <dd className="cmp-them">
              <span className="cmp-who t-label">{them}</span>
              {row.them}
            </dd>
            <dd className="cmp-us">
              <span className="cmp-who t-label">{us}</span>
              {facts[row.us]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CompareIndexPage({ locale }: { locale: PublicLocale }) {
  const t = compareIndex[locale];
  return (
    <IndexListPage
      locale={locale}
      page="compare"
      copy={t.page}
      heading={t.heading}
      note={t.note}
      items={COMPARE_SLUGS.map((slug) => ({ id: `compare-${slug}` as const, note: compare[locale][slug].summary }))}
    />
  );
}
