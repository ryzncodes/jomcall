import { legalCopy } from "@/messages/legal";
import type { PublicLocale } from "@/lib/site";
import { legalAnchors } from "../legal-anchors";
import { fillOperator } from "../operator";
import { PublicShell } from "../shell";

// The privacy notice and the terms of use in the public shell. The text is
// rendered exactly as written in web/messages/legal.ts, with operator facts
// filled in; each heading has an anchor and the page keeps a readable measure.
export function LegalPage({ kind, locale }: { kind: "privacy" | "terms"; locale: PublicLocale }) {
  const doc = legalCopy[locale][kind];
  const anchors = legalAnchors(doc);
  return (
    <PublicShell locale={locale} page={kind}>
      <article className="home-section legal" aria-labelledby="legal-title">
        <div className="frame legal-grid">
          <header className="legal-head">
            <h1 id="legal-title" className="t-display">
              {doc.title}
            </h1>
            <p className="t-lead t-muted">{fillOperator(doc.intro)}</p>
            <p className="t-label t-muted">{fillOperator(doc.effective)}</p>
          </header>
          <nav className="legal-toc" aria-label={legalCopy[locale].footer.contents}>
            <p className="t-label t-muted">{legalCopy[locale].footer.contents}</p>
            <ol>
              {anchors.map((a) => (
                <li key={a.id}>
                  <a href={`#${a.id}`}>{a.heading}</a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="legal-body">
            {doc.sections.map((sec, i) => (
              <section key={anchors[i].id} className="legal-section" aria-labelledby={anchors[i].id}>
                <h2 id={anchors[i].id} className="t-h3">
                  <a href={`#${anchors[i].id}`}>{sec.heading}</a>
                </h2>
                {sec.paragraphs.map((x) => (
                  <p key={x}>{fillOperator(x)}</p>
                ))}
                {sec.list && (
                  <ul className="legal-list">
                    {sec.list.map((x) => (
                      <li key={x}>{fillOperator(x)}</li>
                    ))}
                  </ul>
                )}
                {sec.after?.map((x) => (
                  <p key={x}>{fillOperator(x)}</p>
                ))}
              </section>
            ))}
          </div>
        </div>
      </article>
    </PublicShell>
  );
}
