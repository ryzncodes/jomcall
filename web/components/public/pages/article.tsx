import type { ReactNode } from "react";
import { common } from "@/content/public/common";
import { home } from "@/content/public/home";
import type { FaqItem, PageCopy } from "@/content/public/types";
import { breadcrumbLd, faqLd, type LdNode } from "@/lib/json-ld";
import { PUBLIC_PAGES, localePath, type PublicLocale, type PublicPageId } from "@/lib/site";
import { Cta } from "../cta";
import { FaqList } from "../faq-list";
import { Arrow } from "../icons";
import { JsonLd } from "../json-ld";
import { PublicShell } from "../shell";
import { Toc } from "../toc";

// The reading layout shared by the content pages: a hero, then a 640 px text
// column with a sticky contents list beside it on desktop (a disclosure on
// phones), sections that change shape as the page goes (prose, numbered
// steps, a two-column table, a sample call, a tinted note), the page's
// questions, a full-width band of related pages and the closing band.
// Server-rendered; the call to action is the only island.

export type ArticleSection = {
  id: string;
  heading: string;
  // A short line under the heading.
  lead?: string;
  children: ReactNode;
};

export type RelatedLink = { id: PublicPageId; note?: string };

export function ArticlePage({
  locale,
  page,
  copy,
  sections,
  faqs,
  related,
  relatedHeading,
  heroExtra,
  ld = [],
}: {
  locale: PublicLocale;
  page: PublicPageId;
  copy: PageCopy;
  sections: ArticleSection[];
  faqs?: { heading: string; items: FaqItem[] };
  related?: RelatedLink[];
  relatedHeading?: string;
  heroExtra?: ReactNode;
  ld?: (LdNode | null)[];
}) {
  const c = common[locale];
  const parent = PUBLIC_PAGES.find((p) => p.id === page)?.parent;
  const toc = [
    ...sections.map((s) => ({ id: s.id, heading: s.heading })),
    ...(faqs ? [{ id: "questions", heading: faqs.heading }] : []),
  ];
  return (
    <PublicShell locale={locale} page={page}>
      <JsonLd data={breadcrumbLd(page, locale)} />
      {faqs && <JsonLd data={faqLd(faqs.items)} />}
      {ld.map((node, i) => (
        <JsonLd key={i} data={node} />
      ))}
      <article aria-labelledby="article-title">
        <header className="art-hero">
          <div className="frame">
            {parent && (
              <p className="crumb t-small">
                <a href={localePath(parent, locale)}>{c.pages[parent]}</a>
              </p>
            )}
            <h1 id="article-title" className="t-display">
              {copy.h1}
            </h1>
            <p className="t-lead t-muted art-lead">{copy.lead}</p>
            {heroExtra}
          </div>
        </header>
        <div className="frame art">
          <Toc label={c.article.contents} items={toc} />
          <div className="art-main">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="art-section" aria-labelledby={`${s.id}-title`}>
                <header className="art-head">
                  <h2 id={`${s.id}-title`} className="t-h2">
                    {s.heading}
                  </h2>
                  {s.lead && <p className="t-lead t-muted">{s.lead}</p>}
                </header>
                {s.children}
              </section>
            ))}
            {faqs && (
              <section id="questions" className="art-section" aria-labelledby="questions-title">
                <header className="art-head">
                  <h2 id="questions-title" className="t-h2">
                    {faqs.heading}
                  </h2>
                </header>
                <FaqList items={faqs.items} />
              </section>
            )}
          </div>
        </div>
      </article>
      {related && related.length > 0 && (
        <RelatedBand locale={locale} heading={relatedHeading ?? c.article.related} links={related} />
      )}
      <ClosingBand locale={locale} />
    </PublicShell>
  );
}

// ------------------------------------------------------------ section views

// Plain paragraphs in the text column.
export function Prose({ paras }: { paras: string[] }) {
  return (
    <div className="prose">
      {paras.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </div>
  );
}

// Numbered steps, each with an optional line set apart ("What you do").
export function Steps({
  items,
  aside,
}: {
  items: { name: string; body: string; extra?: string }[];
  aside?: string;
}) {
  return (
    <ol className="art-steps">
      {items.map((step, i) => (
        <li key={step.name} className="art-step">
          <span className="step-n t-data" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="art-step-body">
            <h3 className="t-h3">{step.name}</h3>
            {step.extra && (
              <p className="art-you">
                {aside && <span className="t-label">{aside}</span>}
                {step.extra}
              </p>
            )}
            <p className="t-muted">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Short named points in a grid: two columns from tablet width.
export function Points({ items }: { items: { name: string; body: string }[] }) {
  return (
    <ul className="art-points">
      {items.map((item) => (
        <li key={item.name}>
          <h3 className="t-h3">{item.name}</h3>
          <p className="t-muted">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

// What a caller asks, and what JomCall does with it: two columns on a wide
// screen, one stacked pair per row on a phone.
export function CallTable({
  head,
  rows,
}: {
  head: [string, string];
  rows: { call: string; does: string }[];
}) {
  return (
    <div className="calls-table">
      <p className="calls-row calls-head t-label t-muted" aria-hidden="true">
        <span>{head[0]}</span>
        <span>{head[1]}</span>
      </p>
      <dl>
        {rows.map((row) => (
          <div key={row.call} className="calls-row">
            <dt>
              <span className="sr-only">{head[0]}: </span>“{row.call}”
            </dt>
            <dd>
              <span className="sr-only">{head[1]}: </span>
              {row.does}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// A tinted note: one or two short lines that matter.
export function Note({ children }: { children: ReactNode }) {
  return <p className="art-note">{children}</p>;
}

// A link with an arrow, for "read more" lines inside a section.
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="link-arrow" href={href}>
      {children}
      <Arrow />
    </a>
  );
}

// ------------------------------------------------------------------ bands

export function RelatedBand({
  locale,
  heading,
  links,
}: {
  locale: PublicLocale;
  heading: string;
  links: RelatedLink[];
}) {
  const c = common[locale];
  return (
    <section className="band band-surface" aria-labelledby="related-title">
      <div className="frame">
        <h2 id="related-title" className="t-h2 related-title">
          {heading}
        </h2>
        <ul className="industry-strip">
          {links.map(({ id, note }) => (
            <li key={id}>
              <a href={localePath(id, locale)} className="industry">
                <span className="industry-name">{c.pages[id]}</span>
                {note && <span className="t-small t-muted">{note}</span>}
                <Arrow />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ClosingBand({ locale }: { locale: PublicLocale }) {
  const c = common[locale];
  const t = home[locale];
  return (
    <section className="band band-forest" aria-labelledby="closing-title">
      <div className="frame home-closing">
        <h2 id="closing-title" className="t-h2">
          {t.closing.heading}
        </h2>
        <p className="t-lead">{t.closing.body}</p>
        <div className="closing-actions">
          <Cta locale={locale} getStarted={c.getStarted} openWorkspace={c.openWorkspace} />
        </div>
        <p className="t-small closing-note">{t.hero.reassurance}</p>
      </div>
    </section>
  );
}
