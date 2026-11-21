import { common } from "@/content/public/common";
import { INDUSTRY_SLUGS, industries, industriesIndex } from "@/content/public/industries";
import { breadcrumbLd } from "@/lib/json-ld";
import { localePath, type PublicLocale } from "@/lib/site";
import { Arrow } from "../icons";
import { JsonLd } from "../json-ld";
import { PublicShell } from "../shell";
import { ClosingBand } from "./article";

// The industries index: the six industry pages as large rows, then the other
// setup business types in a quiet band.
export function IndustriesIndexPage({ locale }: { locale: PublicLocale }) {
  const t = industriesIndex[locale];
  const c = common[locale];
  return (
    <PublicShell locale={locale} page="industries">
      <JsonLd data={breadcrumbLd("industries", locale)} />
      <section className="art-hero" aria-labelledby="industries-title">
        <div className="frame">
          <h1 id="industries-title" className="t-display">
            {t.page.h1}
          </h1>
          <p className="t-lead t-muted art-lead">{t.page.lead}</p>
        </div>
      </section>
      <section className="home-section index-section" aria-labelledby="industries-list">
        <div className="frame">
          <h2 id="industries-list" className="sr-only">
            {t.heading}
          </h2>
          <ol className="index-list">
            {INDUSTRY_SLUGS.map((slug, i) => {
              const id = `industries-${slug}` as const;
              const page = industries[locale][slug];
              return (
                <li key={slug}>
                  <a href={localePath(id, locale)} className="index-row">
                    <span className="index-n t-data" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="index-name">{c.pages[id]}</span>
                    <span className="index-note t-muted">{page.summary}</span>
                    <Arrow />
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
      <section className="band band-surface" aria-labelledby="industries-other">
        <div className="frame index-other">
          <h2 id="industries-other" className="t-h2">
            {t.other.heading}
          </h2>
          <div className="prose">
            {t.other.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
      </section>
      <ClosingBand locale={locale} />
    </PublicShell>
  );
}
