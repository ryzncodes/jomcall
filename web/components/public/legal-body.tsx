import { legalCopy } from "../../messages/legal";
import type { PublicLocale } from "../../lib/site";
import { legalAnchors } from "./legal-anchors";
import { fillOperator } from "./operator";

// The privacy notice or the terms of use, exactly as written in
// web/messages/legal.ts, with operator facts filled in. Each heading has an
// anchor. Kept apart from the shell so a test can render it.
export function LegalBody({ kind, locale }: { kind: "privacy" | "terms"; locale: PublicLocale }) {
  const doc = legalCopy[locale][kind];
  const anchors = legalAnchors(doc);
  return (
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
  );
}
