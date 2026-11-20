"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle,
} from "@phosphor-icons/react";
import { Brand, Controls, useExperience } from "./experience";
import { OPERATOR } from "@/lib/operator";
import { useSignedIn } from "./signed-in";
import { launchCopy } from "@/lib/launch";
import { legalCopy } from "@/messages/legal";
import { fillOperator } from "./public/operator";

// Operator facts are filled in one place; re-exported for the app's own pages.
export { fillOperator } from "./public/operator";

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
export function PublicFrame({ children }: { children: React.ReactNode }) {
  const { t, href, mode, locale } = useExperience(),
    p = t.remaining;
  // A signed-in visitor gets a link back to the app instead of Log in.
  const signedIn = Boolean(useSignedIn(mode !== "mock"));
  const account = signedIn ? (
    <a href={href("/app")}>
      {locale === "ms" ? "Buka ruang kerja" : "Open your workspace"}
    </a>
  ) : (
    <a href={href("/login")}>{p.login}</a>
  );
  return (
    <>
      <a className="skip-link" href="#content">
        {t.skip}
      </a>
      <header className="public-header">
        <Brand />
        <nav aria-label={p.docs}>
          <a href={href("/pricing")}>{p.pricing}</a>
          {/* The guides describe the mock preview's sample screens. */}
          {mode !== "hosted" && <a href={href("/docs")}>{p.docs}</a>}
          {account}
        </nav>
        <Controls />
      </header>
      {children}
      <footer className="public-footer">
        <Brand />
        <nav aria-label={t.footerNote}>
          <a href={href("/pricing")}>{p.pricing}</a>
          {mode !== "hosted" && (
            <>
              <a href={href("/docs")}>{p.docs}</a>
              <a href={href("/self-host")}>{p.selfhost}</a>
              <a href={href("/admin")}>{p.platform}</a>
            </>
          )}
          {mode === "hosted" && account}
        </nav>
        <OperatorDetails />
        <small>
          {mode === "hosted"
            ? launchCopy.footer[locale === "ms" ? 1 : 0]
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
export function PublicPages({ page }: { page: "docs" }) {
  const { t, href } = useExperience(),
    p = t.remaining,
    [guide, setGuide] = useState<number | null>(null);
  const routes = [
    "/app/setup",
    "/app/phone-numbers",
    "/app/bookings",
    "/app/outbound",
    "/app/settings",
    "/self-host",
  ];
  void page;
  return (
    <PublicFrame>
      <main tabIndex={-1} id="content" className="public-content">
        <a className="text-link" href={href("/")}>
          <ArrowLeft size={17} />
          {p.publicBack}
        </a>
        <div className="public-title">
          <span className="public-symbol">
            <BookOpen size={38} />
          </span>
          <h1>{p.docsTitle}</h1>
          <p>{p.docsIntro}</p>
        </div>
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
      </main>
    </PublicFrame>
  );
}
