import { trust } from "@/content/public/trust";
import { OPERATOR } from "@/lib/operator";
import { localePath, type PublicLocale } from "@/lib/site";
import { legalCopy } from "@/messages/legal";
import { Arrow } from "../icons";
import { fillOperator } from "../operator";
import { providersSection } from "../providers";
import { ArticlePage, MoreLink } from "./article";

// The trust page: the facts as plain rows (from spec section 3 and the
// operator facts), the privacy notice's provider list quoted word for word,
// and links to the privacy notice and the terms. No certification or
// compliance claim.
export function TrustPage({ locale }: { locale: PublicLocale }) {
  const t = trust[locale];
  const quote = providersSection(locale);
  const privacy = localePath("privacy", locale);
  const rows = [
    ...t.facts.rows.map((r) => ({ fact: r.fact, detail: <>{r.detail}</> })),
    { fact: t.operator.fact, detail: <>{fillOperator(t.operator.detail)}</> },
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
          id: "providers",
          heading: t.providers.heading,
          lead: t.providers.lead,
          children: (
            <figure className="trust-quote">
              <blockquote cite={`${privacy}#${quote.anchor}`}>
                {quote.paragraphs.map((p) => (
                  <p key={p}>{fillOperator(p)}</p>
                ))}
                {quote.list && (
                  <ul>
                    {quote.list.map((item) => (
                      <li key={item}>{fillOperator(item)}</li>
                    ))}
                  </ul>
                )}
              </blockquote>
              <figcaption className="t-small t-muted">
                <span>
                  {t.providers.from}: <cite>{quote.heading}</cite>
                </span>
                <MoreLink href={`${privacy}#${quote.anchor}`}>{t.providers.link}</MoreLink>
              </figcaption>
            </figure>
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
