import { common } from "@/content/public/common";
import type { PageCopy } from "@/content/public/types";
import { breadcrumbLd } from "@/lib/json-ld";
import { localePath, type PublicLocale, type PublicPageId } from "@/lib/site";
import { Arrow } from "../icons";
import { JsonLd } from "../json-ld";
import { PublicShell } from "../shell";
import { ClosingBand } from "./article";

// An index of a page family (the comparisons, the guides): a hero, the pages
// as large numbered rows with a one-line note each, an optional quiet line
// under the list, and the closing band. The industries index uses the same
// rows (`.index-list`).
export function IndexListPage({
  locale,
  page,
  copy,
  heading,
  items,
  note,
}: {
  locale: PublicLocale;
  page: PublicPageId;
  copy: PageCopy;
  heading: string;
  items: { id: PublicPageId; note: string }[];
  note?: string;
}) {
  const c = common[locale];
  return (
    <PublicShell locale={locale} page={page}>
      <JsonLd data={breadcrumbLd(page, locale)} />
      <section className="art-hero" aria-labelledby="index-title">
        <div className="frame">
          <h1 id="index-title" className="t-display">
            {copy.h1}
          </h1>
          <p className="t-lead t-muted art-lead">{copy.lead}</p>
        </div>
      </section>
      <section className="home-section index-section" aria-labelledby="index-list">
        <div className="frame">
          <h2 id="index-list" className="sr-only">
            {heading}
          </h2>
          <ol className="index-list">
            {items.map(({ id, note: line }, i) => (
              <li key={id}>
                <a href={localePath(id, locale)} className="index-row">
                  <span className="index-n t-data" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="index-name">{c.pages[id]}</span>
                  <span className="index-note t-muted">{line}</span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ol>
          {note && <p className="t-small t-muted index-foot">{note}</p>}
        </div>
      </section>
      <ClosingBand locale={locale} />
    </PublicShell>
  );
}
