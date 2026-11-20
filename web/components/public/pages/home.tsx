import { common } from "@/content/public/common";
import { rm } from "@/content/public/format";
import { home, sampleCall } from "@/content/public/home";
import { publicPlans } from "@/lib/pricing";
import { localePath, type PublicLocale } from "@/lib/site";
import { Bento } from "../bento";
import { CallCard, HearSample } from "../call-card";
import { Cta } from "../cta";
import { INDUSTRIES, pageLink } from "../nav";
import { PublicShell } from "../shell";

// The home page, in the order of spec section 7: hero, bento, the problem,
// how it works, languages, industries, pricing at a glance, FAQ, closing band.
// Server-rendered; the call card and the call to action are the only islands.

function Tick() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8h9.5M8.5 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A sentence with the amount set in the data face.
function WithAmount({ text, amount }: { text: string; amount: string }) {
  const [before, after] = text.split(amount);
  if (after === undefined) return <>{text}</>;
  return (
    <>
      {before}
      <span className="t-data">{amount}</span>
      {after}
    </>
  );
}

export function HomePage({ locale }: { locale: PublicLocale }) {
  const t = home[locale];
  const c = common[locale];
  const fee = rm(publicPlans[0].monthlyFeeSen);
  const voiceIds = sampleCall.map((v) => v.id);
  return (
    <PublicShell locale={locale} page="home">
      <section className="home-hero" data-section="hero" aria-labelledby="home-title">
        <div className="frame hero-grid">
          <div className="hero-copy">
            <h1 id="home-title" className="t-display">
              {t.hero.h1}
            </h1>
            <p className="t-lead hero-lead">{t.hero.lead}</p>
            <p className="hero-from">
              <WithAmount text={t.hero.from} amount={fee} />
            </p>
            <ul className="ticks">
              {t.hero.ticks.map((tick) => (
                <li key={tick}>
                  <Tick />
                  {tick}
                </li>
              ))}
            </ul>
            <div className="hero-actions">
              <Cta locale={locale} getStarted={c.getStarted} openWorkspace={c.openWorkspace} />
              <HearSample voices={voiceIds} hear={t.hero.hear} stop={t.hero.stop} />
            </div>
            <p className="t-small t-muted hero-note">{t.hero.reassurance}</p>
          </div>
          <div className="hero-card">
            <CallCard locale={locale} lines={sampleCall} labels={t.card} />
          </div>
        </div>
      </section>

      <section className="home-section" data-section="bento" aria-labelledby="home-bento">
        <div className="frame">
          <header className="section-head">
            <h2 id="home-bento" className="t-h2">
              {t.bento.heading}
            </h2>
            <p className="t-lead t-muted">{t.bento.lead}</p>
          </header>
          <Bento copy={t.bento} voices={sampleCall} />
        </div>
      </section>

      <section className="band band-surface" data-section="problem" aria-labelledby="home-problem">
        <div className="frame">
          <div className="problem-head">
            <h2 id="home-problem" className="t-h2">
              {t.problem.heading}
            </h2>
            <p className="t-lead t-muted">{t.problem.body}</p>
          </div>
          <ol className="problem-points">
            {t.problem.points.map((point, i) => (
              <li key={point.title}>
                <span className="point-n t-data">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="t-h3">{point.title}</h3>
                <p className="t-muted">{point.body}</p>
              </li>
            ))}
          </ol>
          <p className="problem-close t-lead">{t.problem.close}</p>
        </div>
      </section>

      <section className="home-section" data-section="how" aria-labelledby="home-how">
        <div className="frame split">
          <div className="split-side">
            <h2 id="home-how" className="t-h2">
              {t.how.heading}
            </h2>
            <p className="t-lead t-muted">{t.how.lead}</p>
            <a className="link-arrow" href={localePath("how-it-works", locale)}>
              {t.how.more}
              <Arrow />
            </a>
          </div>
          <ol className="steps">
            {t.how.steps.map((step, i) => (
              <li key={step.name} className="step">
                <span className="step-n t-data">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="t-h3">{step.name}</h3>
                  <p className="t-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="home-section" data-section="languages" aria-labelledby="home-languages">
        <div className="frame">
          <header className="section-head">
            <h2 id="home-languages" className="t-h2">
              {t.languages.heading}
            </h2>
            <p className="t-lead t-muted">{t.languages.body}</p>
          </header>
          <ul className="specimens">
            {sampleCall.map((v) => (
              <li key={v.id} className="specimen">
                <span className="t-label t-muted">{t.languages.samples[v.id]}</span>
                <p className="specimen-line" lang={v.lang}>
                  {v.id === "manglish" ? v.lines[2] : v.lines[1]}
                </p>
                <span className="specimen-chip t-label" lang={v.lang}>
                  {v.chip}
                </span>
              </li>
            ))}
          </ul>
          <p className="t-small t-muted specimen-note">{t.languages.note}</p>
        </div>
      </section>

      <section className="home-section" data-section="industries" aria-labelledby="home-industries">
        <div className="frame">
          <header className="section-head section-head-row">
            <h2 id="home-industries" className="t-h2">
              {t.industries.heading}
            </h2>
            <a className="link-arrow" href={localePath("industries", locale)}>
              {t.industries.all}
              <Arrow />
            </a>
          </header>
          <ul className="industry-strip">
            {INDUSTRIES.map((id) => {
              const link = pageLink(id, locale, "home");
              return (
                <li key={id}>
                  <a href={link.href} className="industry">
                    <span className="industry-name">{link.label}</span>
                    <span className="t-small t-muted">{t.industries.items[id]}</span>
                    <Arrow />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="home-section" data-section="pricing" aria-labelledby="home-pricing">
        <div className="frame">
          <header className="section-head section-head-row">
            <div>
              <h2 id="home-pricing" className="t-h2">
                {t.pricing.heading}
              </h2>
              <p className="t-lead t-muted">{t.pricing.lead}</p>
            </div>
            <a className="link-arrow" href={localePath("pricing", locale)}>
              {t.pricing.link}
              <Arrow />
            </a>
          </header>
          <ul className="plans">
            {publicPlans.map(({ code }) => {
              const plan = t.pricing.plans[code];
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
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="home-section" data-section="faq" aria-labelledby="home-faq">
        <div className="frame split">
          <div className="split-side">
            <h2 id="home-faq" className="t-h2">
              {t.faq.heading}
            </h2>
            <a className="link-arrow" href={localePath("faq", locale)}>
              {t.faq.more}
              <Arrow />
            </a>
          </div>
          <div className="faq-list">
            {t.faq.items.map((item) => (
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

      <section className="band band-forest" data-section="closing" aria-labelledby="home-closing">
        <div className="frame home-closing">
          <h2 id="home-closing" className="t-h2">
            {t.closing.heading}
          </h2>
          <p className="t-lead">{t.closing.body}</p>
          <div className="closing-actions">
            <Cta locale={locale} getStarted={c.getStarted} openWorkspace={c.openWorkspace} />
          </div>
          <p className="t-small closing-note">{t.hero.reassurance}</p>
        </div>
      </section>
    </PublicShell>
  );
}
