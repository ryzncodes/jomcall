import { common } from "@/content/public/common";
import { pricing, pricingFaq } from "@/content/public/pricing";
import { publicPlans, sourceUrl } from "@/lib/pricing";
import type { PublicLocale } from "@/lib/site";
import { AppLink, Cta } from "../cta";
import { Estimator } from "../estimator";
import { Arrow, Dash, Tick } from "../icons";
import { PlanButton } from "../plan-button";
import { PublicShell } from "../shell";

// The pricing page: the three plans, the estimator (the only island besides
// the buttons), the rates, a quiet note for self-hosters, the questions and
// a closing band. Server-rendered and static.
export function PricingPage({ locale }: { locale: PublicLocale }) {
  const t = pricing[locale];
  const c = common[locale];
  return (
    <PublicShell locale={locale} page="pricing">
      <section className="home-section pricing-hero" data-section="hero" aria-labelledby="pricing-title">
        <div className="frame">
          <h1 id="pricing-title" className="t-display">
            {t.hero.h1}
          </h1>
          <p className="t-lead t-muted pricing-lead">{t.hero.lead}</p>
        </div>
      </section>

      <section className="home-section" data-section="plans" aria-labelledby="pricing-plans">
        <div className="frame">
          <h2 id="pricing-plans" className="sr-only">
            {t.plans.heading}
          </h2>
          <ul className="plans">
            {publicPlans.map(({ code }) => {
              const plan = t.plans.plans[code];
              return (
                <li key={code} className="plan">
                  <h3 className="t-h3">{plan.name}</h3>
                  <p className="plan-price">
                    <span className="t-data">{plan.price}</span>
                    <span className="t-small t-muted">{plan.per}</span>
                  </p>
                  <p className="t-small t-muted">{plan.body}</p>
                  <ul className="plan-features">
                    {plan.features.map((f) => (
                      <li key={f} className="t-small">
                        <Tick />
                        {f}
                      </li>
                    ))}
                    {plan.missing.map((f) => (
                      <li key={f} className="t-small plan-missing">
                        <Dash />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="plan-foot">
                    <PlanButton
                      locale={locale}
                      getStarted={c.getStarted}
                      choose={t.plans.choose}
                      primary={code !== "payg"}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="t-small t-muted plans-note">{t.plans.note}</p>
        </div>
      </section>

      <section className="band band-surface" data-section="estimator" aria-labelledby="pricing-estimator">
        <div className="frame">
          <header className="section-head">
            <h2 id="pricing-estimator" className="t-h2">
              {t.estimator.heading}
            </h2>
            <p className="t-lead t-muted">{t.estimator.lead}</p>
          </header>
          <Estimator locale={locale} />
        </div>
      </section>

      <section className="home-section" data-section="rates" aria-labelledby="pricing-rates">
        <div className="frame split">
          <div className="split-side">
            <h2 id="pricing-rates" className="t-h2">
              {t.rates.heading}
            </h2>
          </div>
          <div>
            <dl className="rates">
              {t.rates.rows.map((row) => (
                <div key={row.label} className="rate">
                  <dt>{row.label}</dt>
                  <dd className="t-data rate-value">{row.value}</dd>
                  <dd className="t-small t-muted rate-note">{row.note}</dd>
                </div>
              ))}
            </dl>
            <div className="self-note">
              <h3 className="t-h3">{t.self.heading}</h3>
              <p className="t-muted">{t.self.body}</p>
              <p className="self-links">
                <AppLink path="/self-host" locale={locale} className="link-arrow">
                  {t.self.link}
                  <Arrow />
                </AppLink>
                <a className="link-arrow" href={sourceUrl} rel="noopener noreferrer">
                  {t.self.source}
                  <Arrow />
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" data-section="faq" aria-labelledby="pricing-faq">
        <div className="frame split">
          <div className="split-side">
            <h2 id="pricing-faq" className="t-h2">
              {t.faq.heading}
            </h2>
          </div>
          <div className="faq-list">
            {pricingFaq(locale).map((item) => (
              <details key={item.q} className="faq-item">
                <summary>
                  <h3 className="t-h3">{item.q}</h3>
                  <span className="faq-sign" aria-hidden="true" />
                </summary>
                <p className="t-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-forest" data-section="closing" aria-labelledby="pricing-closing">
        <div className="frame home-closing">
          <h2 id="pricing-closing" className="t-h2">
            {t.closing.heading}
          </h2>
          <p className="t-lead">{t.closing.body}</p>
          <div className="closing-actions">
            <Cta locale={locale} getStarted={c.getStarted} openWorkspace={c.openWorkspace} />
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
