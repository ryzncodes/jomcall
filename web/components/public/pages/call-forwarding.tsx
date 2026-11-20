import { FORWARD_CODES, forwarding } from "@/content/public/call-forwarding";
import type { PublicLocale } from "@/lib/site";
import { ArticlePage, Points, Prose } from "./article";

// The call forwarding guide: the app's three code pairs as a code card, which
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
          children: (
            <>
              <ol className="codes-card">
                {FORWARD_CODES.map((code, i) => (
                  <li key={code.id} className="code-item">
                    <div className="code-text">
                      <h3 className="t-h3">{codes.rows[i].name}</h3>
                      <p className="t-small t-muted">{codes.rows[i].when}</p>
                    </div>
                    <dl className="code-keys">
                      <div>
                        <dt className="t-label t-muted">{codes.start}</dt>
                        <dd>
                          <code className="key t-data">{code.start}</code>
                          <var className="key-slot">{codes.number}</var>
                          <code className="key t-data">#</code>
                        </dd>
                      </div>
                      <div>
                        <dt className="t-label t-muted">{codes.stop}</dt>
                        <dd>
                          <code className="key t-data">{code.stop}</code>
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
              <p className="t-small t-muted codes-note">{codes.note}</p>
            </>
          ),
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
