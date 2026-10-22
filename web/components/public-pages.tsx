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
} from "@phosphor-icons/react";
import { Brand, Controls, useExperience } from "./experience";
import { money } from "@/lib/api/client";
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
          <a href={href("/privacy")}>{p.privacy}</a>
          <a href={href("/terms")}>{p.terms}</a>
          <a href={href("/self-host")}>{p.selfhost}</a>
          <a href={href("/admin")}>{p.platform}</a>
        </nav>
        <small>
          {mode === "local"
            ? locale === "ms"
              ? "Pembangunan setempat · tiada saluran disambungkan"
              : "Local development · no channels connected"
            : p.previewOnly}
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
  const { t, href } = useExperience(),
    p = t.remaining,
    [minutes, setMinutes] = useState(300),
    [messages, setMessages] = useState(500),
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
          <h1>{p[`${page}Title`]}</h1>
          <p>{legal ? p.legalIntro : p[`${page}Intro`]}</p>
        </div>
        {page === "pricing" ? (
          <>
            <div className="pricing-layout">
              <section className="pricing-story">
                <p className="eyebrow">{p.pricing}</p>
                <h2>{p.paygo}</h2>
                <p>{p.paygoBody}</p>
                <div className="pricing-rate">
                  <PhoneIncoming size={25} />
                  <strong>RM 0.32</strong>
                  <span>/ {p.minutes.toLowerCase()}</span>
                </div>
                <p>{p.rateHint}</p>
                <a className="button button-dark" href={href("/signup")}>
                  {p.signup}
                  <ArrowUpRight size={18} />
                </a>
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
                    max={5000}
                    step={50}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
                <label>
                  {p.messages}
                  <output>{messages.toLocaleString()}</output>
                  <input
                    type="range"
                    aria-label={p.messages}
                    min={0}
                    max={10000}
                    step={100}
                    value={messages}
                    onChange={(e) => setMessages(Number(e.target.value))}
                  />
                </label>
                <div className="estimate-total">
                  <span>{p.estimate}</span>
                  <strong>{money(minutes * 32 + messages * 5)}</strong>
                </div>
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
        ) : (
          <div className="legal-layout">
            <aside>
              <span className="remaining-chip">{p.legalDraft}</span>
              <nav aria-label={p[page]}>
                {p[`${page}Heads`].map((h, i) => (
                  <a href={`#section-${i}`} key={h}>
                    {h}
                  </a>
                ))}
              </nav>
              <a className="text-link" href={href("/app/contacts")}>
                {t.crm.contacts}
                <ArrowUpRight size={16} />
              </a>
            </aside>
            <div>
              {p[`${page}Heads`].map((h, i) => (
                <section key={h} id={`section-${i}`}>
                  <h2>{h}</h2>
                  <p>{p[`${page}Bodies`][i]}</p>
                </section>
              ))}
            </div>
          </div>
        )}
      </main>
    </PublicFrame>
  );
}
