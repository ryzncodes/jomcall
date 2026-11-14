"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  PhoneIncoming,
  ShieldCheck,
  BookOpen,
  Wallet,
  CheckCircle,
  GithubLogo,
} from "@phosphor-icons/react";
import { Brand, Controls, useExperience } from "./experience";
import { money } from "@/lib/api/client";
import {
  monthlyEstimateSen,
  publicPlans,
  publicPrices,
  sourceUrl,
} from "@/lib/pricing";
import {
  OPERATOR,
  PRIVACY_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
} from "@/lib/operator";
import { legalCopy } from "@/messages/legal";

// Fills operator facts into legal text. Facts live only in lib/operator.ts.
export function fillOperator(text: string): string {
  return text
    .replaceAll("{name}", OPERATOR.legalName)
    .replaceAll("{reg}", OPERATOR.registrationNumber)
    .replaceAll("{address}", OPERATOR.address)
    .replaceAll("{email}", PRIVACY_CONTACT_EMAIL)
    .replaceAll("{date}", LEGAL_EFFECTIVE_DATE);
}

// Operator identity shown in every public footer.
export function OperatorDetails() {
  const { t, href, locale } = useExperience(),
    f = legalCopy[locale].footer;
  return (
    <div className="operator-details">
      <p>
        <strong>{fillOperator(f.product)}</strong>
        <span>{fillOperator(f.registration)}</span>
        <span>{OPERATOR.address}</span>
      </p>
      <p>
        <a href={href("/privacy")}>{t.remaining.privacy}</a>
        <a href={href("/terms")}>{t.remaining.terms}</a>
        <a href={OPERATOR.repositoryUrl} rel="noopener noreferrer">
          {f.source}
        </a>
        <span>{f.licence}</span>
      </p>
    </div>
  );
}
// "{n}" and "{rate}" placeholders in the price copy.
const fill = (text: string, value: string | number) =>
  text.replace(/\{(n|rate)\}/g, String(value));
const rate = (sen: number) => (sen / 100).toFixed(2);
export function PublicFrame({ children }: { children: React.ReactNode }) {
  const { t, href, mode, locale } = useExperience(),
    p = t.remaining;
  return (
    <>
      <a className="skip-link" href="#content">
        {t.skip}
      </a>
      <header className="public-header">
        <Brand />
        <nav aria-label={p.docs}>
          <a href={href("/pricing")}>{p.pricing}</a>
          <a href={href("/docs")}>{p.docs}</a>
          <a href={href("/login")}>{p.login}</a>
        </nav>
        <Controls />
      </header>
      {children}
      <footer className="public-footer">
        <Brand />
        <nav aria-label={t.footerNote}>
          <a href={href("/pricing")}>{p.pricing}</a>
          <a href={href("/docs")}>{p.docs}</a>
          <a href={href("/self-host")}>{p.selfhost}</a>
          <a href={href("/admin")}>{p.platform}</a>
        </nav>
        <OperatorDetails />
        <small>
          {mode === "hosted"
            ? locale === "ms"
              ? "Beta tertutup · panggilan dan WhatsApp belum disambungkan"
              : "Closed beta · calls and WhatsApp not connected yet"
            : mode === "local"
              ? locale === "ms"
                ? "Pembangunan setempat · tiada saluran disambungkan"
                : "Local development · no channels connected"
              : legalCopy[locale].footer.preview}
        </small>
      </footer>
    </>
  );
}
export function PublicPages({
  page,
}: {
  page: "pricing" | "docs" | "privacy" | "terms";
}) {
  const { t, href, locale } = useExperience(),
    p = t.remaining,
    [minutes, setMinutes] = useState(300),
    [guide, setGuide] = useState<number | null>(null);
  const routes = [
    "/app/setup",
    "/app/phone-numbers",
    "/app/bookings",
    "/app/outbound",
    "/app/settings",
    "/self-host",
  ];
  const legal = page === "privacy" || page === "terms";
  const doc = legal ? legalCopy[locale][page] : null;
  return (
    <PublicFrame>
      <main tabIndex={-1} id="content" className="public-content">
        <a className="text-link" href={href("/")}>
          <ArrowLeft size={17} />
          {p.publicBack}
        </a>
        <div className="public-title">
          <span className="public-symbol">
            {page === "pricing" ? (
              <Wallet size={38} />
            ) : legal ? (
              <ShieldCheck size={38} />
            ) : (
              <BookOpen size={38} />
            )}
          </span>
          <h1>{doc ? doc.title : p[`${page}Title`]}</h1>
          <p>
            {doc ? doc.intro : page === "docs" ? p.docsIntro : p.pricingIntro}
          </p>
        </div>
        {page === "pricing" ? (
          <>
            <div className="plan-grid">
              {publicPlans.map((plan) => (
                <section
                  key={plan.code}
                  className={`plan-card${plan.code === "growth" ? " plan-card-featured" : ""}`}
                >
                  <h2>{p.planNames[plan.code]}</h2>
                  <p>{p.planBodies[plan.code]}</p>
                  <div className="pricing-rate">
                    {plan.monthlyFeeSen ? (
                      <>
                        <strong>{money(plan.monthlyFeeSen)}</strong>
                        <span>{p.planMonth}</span>
                      </>
                    ) : (
                      <strong className="plan-free">{p.planNoFee}</strong>
                    )}
                  </div>
                  <ul>
                    <li>
                      {plan.phoneNumbers
                        ? fill(p.planNumber, plan.phoneNumbers)
                        : p.planNoNumber}
                    </li>
                    {plan.includedVoiceSeconds > 0 && (
                      <li>
                        {fill(p.planMinutes, plan.includedVoiceSeconds / 60)}
                      </li>
                    )}
                    <li>
                      {fill(
                        plan.includedVoiceSeconds
                          ? p.planOverage
                          : p.planPaygRate,
                        rate(publicPrices.voiceSenPerMinute),
                      )}
                    </li>
                    <li>
                      {plan.whatsappAgent
                        ? fill(
                            p.planWhatsapp,
                            rate(publicPrices.whatsappAgentSenPerConversation),
                          )
                        : p.planNoWhatsapp}
                    </li>
                  </ul>
                  <a className="button button-dark" href={href("/signup")}>
                    {p.signup}
                    <ArrowUpRight size={18} />
                  </a>
                </section>
              ))}
              <section className="plan-card plan-card-self">
                <h2>{p.selfTitle}</h2>
                <p>{p.selfBody}</p>
                <div className="pricing-rate">
                  <strong className="plan-free">{p.selfPrice}</strong>
                </div>
                <p className="plan-costs-title">{p.selfCostsTitle}</p>
                <ul>
                  {p.selfCosts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p>{p.selfSupport}</p>
                <a
                  className="button"
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GithubLogo size={18} />
                  {p.selfLink}
                  <ArrowUpRight size={18} />
                </a>
              </section>
            </div>
            <p className="plan-note">{p.rateHint}</p>
            <div className="pricing-layout">
              <section className="pricing-story">
                <p className="eyebrow">{p.pricing}</p>
                <h2>{p.paygo}</h2>
                <p>{p.paygoBody}</p>
                <div className="pricing-rate">
                  <PhoneIncoming size={25} />
                  <strong>{money(publicPrices.voiceSenPerMinute)}</strong>
                  <span>/ {p.minutes.toLowerCase()}</span>
                </div>
              </section>
              <section className="pricing-calculator">
                <h2>{p.estimate}</h2>
                <label>
                  {p.voiceMinutes}
                  <output>{minutes.toLocaleString()}</output>
                  <input
                    type="range"
                    aria-label={p.voiceMinutes}
                    min={0}
                    max={2000}
                    step={25}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
                <p className="plan-note">{p.planEstimateHint}</p>
                <dl className="estimate-plans">
                  {publicPlans.map((plan) => (
                    <div key={plan.code}>
                      <dt>{p.planNames[plan.code]}</dt>
                      <dd>{money(monthlyEstimateSen(plan, minutes))}</dd>
                    </div>
                  ))}
                </dl>
                <a className="text-link" href={href("/app/billing")}>
                  {p.walletLink}
                  <ArrowRight size={18} />
                </a>
              </section>
            </div>
          </>
        ) : page === "docs" ? (
          <div className="guides-grid">
            {p.guideTitles.map((title, i) => (
              <article
                key={title}
                className={guide === i ? "guide-expanded" : ""}
              >
                <span className="guide-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2>{title}</h2>
                <p>{p.guideBodies[i]}</p>
                <button
                  className="text-link"
                  aria-expanded={guide === i}
                  onClick={() => setGuide(guide === i ? null : i)}
                >
                  {p.readGuide}
                  <ArrowUpRight size={17} />
                </button>
                {guide === i && (
                  <div className="guide-detail">
                    <CheckCircle size={22} />
                    <p>{p.previewOnly}</p>
                    <a className="button button-dark" href={href(routes[i])}>
                      {p.tryScreen}
                      <ArrowRight size={17} />
                    </a>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : doc ? (
          <div className="legal-layout">
            <aside>
              <span className="remaining-chip">
                {fillOperator(doc.effective)}
              </span>
              <nav aria-label={legalCopy[locale].footer.contents}>
                {doc.sections.map((sec, i) => (
                  <a href={`#section-${i}`} key={sec.heading}>
                    {sec.heading}
                  </a>
                ))}
              </nav>
            </aside>
            <div>
              {doc.sections.map((sec, i) => (
                <section key={sec.heading} id={`section-${i}`}>
                  <h2>{sec.heading}</h2>
                  {sec.paragraphs.map((x) => (
                    <p key={x}>{fillOperator(x)}</p>
                  ))}
                  {sec.list && (
                    <ul>
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
        ) : null}
      </main>
    </PublicFrame>
  );
}
