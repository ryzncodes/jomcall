import { trust } from "@/content/public/trust";
import { OPERATOR } from "@/lib/operator";
import { localePath, type PublicLocale } from "@/lib/site";
import { legalCopy } from "@/messages/legal";
import { Arrow } from "../icons";
import { fillOperator } from "../operator";
import { ArticlePage } from "./article";

// The trust page: the facts as plain rows (from spec section 3 and the
// operator facts) and links to the privacy notice and the terms. No
// certification or compliance claim.
export function TrustPage({ locale }: { locale: PublicLocale }) {
  const t = trust[locale];
  const privacy = localePath("privacy", locale);
  const rows = [
    ...t.facts.rows.map((r) => ({ fact: r.fact, detail: <>{r.detail}</> })),
    { fact: t.operator.fact, detail: <>{fillOperator(t.operator.detail)}</> },
    {
      fact: t.providers.fact,
      detail: (
        <>
          {t.providers.detail} <a href={privacy}>{t.providers.link}</a>
        </>
      ),
    },
    {
      fact: t.source.fact,
      detail: (
        <>
          {t.source.detail}{" "}
          <a href={OPERATOR.repositoryUrl} rel="noopener noreferrer">
            {t.source.link}
          </a>
        </>
      ),
    },
  ];
  return (
    <ArticlePage
      locale={locale}
      page="trust"
      copy={t.page}
      faqs={t.faq}
      sections={[
        {
          id: "facts",
          heading: t.facts.heading,
          lead: t.facts.lead,
          children: (
            <div className="calls-table trust-facts">
              <p className="calls-row calls-head t-label t-muted" aria-hidden="true">
                <span>{t.facts.factHead}</span>
                <span>{t.facts.detailHead}</span>
              </p>
              <dl>
                {rows.map((row) => (
                  <div key={row.fact} className="calls-row">
                    <dt>{row.fact}</dt>
                    <dd>
                      <span className="sr-only">{t.facts.detailHead}: </span>
                      {row.detail}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ),
        },
        {
          id: "documents",
          heading: t.documents.heading,
          lead: t.documents.lead,
          children: (
            <ul className="trust-docs">
              {(["privacy", "terms"] as const).map((id) => (
                <li key={id}>
                  <a href={localePath(id, locale)} className="trust-doc">
                    <span className="trust-doc-name">{legalCopy[locale][id].title}</span>
                    <span className="t-small t-muted">{t.documents[id]}</span>
                    <Arrow />
                  </a>
                </li>
              ))}
            </ul>
          ),
        },
      ]}
      related={[{ id: "faq" }, { id: "how-it-works" }, { id: "pricing" }]}
    />
  );
}
