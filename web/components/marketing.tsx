"use client";
import { useState } from "react";
import Image from "next/image";

import {
  ArrowUpRight,
  ArrowRight,
  PhoneIncoming,
  CalendarBlank,
  BellSimple,
  Play,
  List,
  X,
  Check,
  ShieldCheck,
  Headphones,
  ArrowBendUpRight,
  Plus,
  ArrowDown,
} from "@phosphor-icons/react";
import { Brand, Controls, useExperience } from "./experience";
import { CallDemo, Wave } from "./call-demo";
import { MiniWorkspace } from "./workspace";
export function Marketing() {
  const { t, href } = useExperience();
  const [menu, setMenu] = useState(false);
  const [business, setBusiness] = useState<"salon" | "clinic" | "workshop">(
    "salon",
  );
  return (
    <>
      <a className="skip-link" href="#content">
        {t.skip}
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav
            aria-label={t.navProduct}
            className={menu ? "navigation menu-open" : "navigation"}
          >
            <a href="#how" onClick={() => setMenu(false)}>
              {t.navProduct}
            </a>
            <a href="#demo" onClick={() => setMenu(false)}>
              {t.navDemo}
            </a>
            <a href="#control" onClick={() => setMenu(false)}>
              {t.navControl}
            </a>
          </nav>
          <div className="header-actions">
            <Controls />
            <a className="button button-small button-dark" href={href("/app")}>
              {t.openApp}
              <ArrowUpRight size={16} />
            </a>
            <button
              className="menu-button icon-button"
              aria-label={menu ? t.closeMenu : t.menu}
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {menu ? <X size={21} /> : <List size={21} />}
            </button>
          </div>
        </div>
      </header>
      <main tabIndex={-1} id="content">
        <section className="hero section-width">
          <div className="hero-type">
            <div>
              <p className="eyebrow">
                <span className="status-dot" />
                {t.eyebrow}
              </p>
              <h1>
                {t.headline}
                <br />
                <span>{t.headlineEnd}</span>
              </h1>
            </div>
            <div className="hero-intro">
              <p>{t.intro}</p>
              <a className="button button-dark" href="#demo">
                {t.try}
                <ArrowUpRight size={20} />
              </a>
              <small>{t.heroNote}</small>
            </div>
          </div>
          <div className="hero-scene">
            <div className="hero-art">
              <Image
                src="/images/front-desk.png"
                alt={t.artAlt}
                fill
                priority
                sizes="(max-width: 760px) 100vw, 95vw"
                quality={85}
              />
            </div>
            <div className="scene-caption">
              <span className="scene-marker" />
              {t.heroChip}
            </div>
            <a href="#demo" className="incoming-call">
              <div className="incoming-top">
                <span>
                  <PhoneIncoming size={16} />
                  {t.sample}
                </span>
                <ArrowUpRight size={20} />
              </div>
              <h2>{t.heroCall}</h2>
              <div className="incoming-bottom">
                <Wave compact />
                <span className="play-circle">
                  <Play size={17} weight="fill" />
                </span>
              </div>
              <small>{t.sampleNotice}</small>
            </a>
            <div className="scene-label">
              <span>JomCall</span>
              <span>BM / EN / 中文</span>
            </div>
          </div>
          <div className="hero-foot">
            <span>{t.scrollHint}</span>
            <ArrowDown size={18} />
            <span>{t.sampleShort}</span>
          </div>
        </section>
        <section className="promise section-width" id="how">
          <div className="pillar-strip">
            <span>
              <PhoneIncoming size={22} />
              {t.pillar1}
            </span>
            <span>
              <CalendarBlank size={22} />
              {t.pillar2}
            </span>
            <span>
              <BellSimple size={22} />
              {t.pillar3}
            </span>
          </div>
          <div className="promise-copy">
            <h2>
              {t.promise}
              <br />
              <span>{t.promiseEnd}</span>
            </h2>
            <p>{t.promiseBody}</p>
          </div>
          <div className="business-story">
            <div className="business-select">
              <span className="eyebrow">{t.businesses}</span>
              <div role="group" aria-label={t.businesses}>
                {(["salon", "clinic", "workshop"] as const).map((b) => (
                  <button
                    key={b}
                    aria-pressed={business === b}
                    className={business === b ? "active" : ""}
                    onClick={() => setBusiness(b)}
                  >
                    {t[b]}
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </div>
            <div className="business-copy" aria-live="polite">
              <h3>{t[`${business}Text`]}</h3>
              <p>{t[`${business}Description`]}</p>
            </div>
            <div className="business-time">
              <div className="time-dial" aria-hidden="true">
                {Array.from({ length: 40 }, (_, i) => (
                  <i key={i} style={{ transform: `rotate(${i * 9}deg)` }} />
                ))}
                <span>
                  24<span>/</span>7
                </span>
              </div>
            </div>
          </div>
        </section>
        <section className="conversation-section" id="demo">
          <div className="section-width">
            <div className="demo-heading">
              <p className="eyebrow">{t.demoEyebrow}</p>
              <h2>{t.demoTitle}</h2>
              <p>{t.demoDescription}</p>
            </div>
            <CallDemo />
            <p className="voice-disclaimer">{t.voiceDisclaimer}</p>
          </div>
        </section>
        <section className="workflow section-width">
          <div className="workflow-intro">
            <h2>{t.workflowTitle}</h2>
            <p>{t.workflowBody}</p>
          </div>
          <div className="workflow-path">
            {[PhoneIncoming, CalendarBlank, ArrowBendUpRight].map((Icon, i) => (
              <article key={i}>
                <div className="workflow-node">
                  <span className="step-number">0{i + 1}</span>
                  <Icon size={29} weight="light" />
                </div>
                <h3>{t[`workflow${i + 1}` as "workflow1"]}</h3>
                <p>{t[`workflow${i + 1}Body` as "workflow1Body"]}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="product-section">
          <div className="section-width">
            <div className="product-heading">
              <div>
                <p className="eyebrow">{t.productEyebrow}</p>
                <h2>{t.productTitle}</h2>
              </div>
              <div>
                <p>{t.productBody}</p>
                <a className="text-link" href={href("/app/calls")}>
                  {t.viewCallLog}
                  <ArrowUpRight size={19} />
                </a>
              </div>
            </div>
            <div className="product-stage">
              <div className="stage-caption">
                <span>
                  <span className="status-dot" />
                  {t.appSample}
                </span>
                <span className="mono">Asia/Kuala_Lumpur</span>
              </div>
              <MiniWorkspace />
            </div>
          </div>
        </section>
        <section className="control-section section-width" id="control">
          <div className="control-title">
            <p className="eyebrow">
              <ShieldCheck size={17} />
              {t.controlEyebrow}
            </p>
            <h2>{t.controlTitle}</h2>
            <p>{t.controlBody}</p>
          </div>
          <div className="control-list">
            {[ShieldCheck, Headphones, Check].map((Icon, i) => (
              <article key={i}>
                <Icon size={25} weight="light" />
                <div>
                  <h3>{t[`control${i + 1}` as "control1"]}</h3>
                  <p>{t[`control${i + 1}Body` as "control1Body"]}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="faq section-width">
          <h2>{t.faqTitle}</h2>
          <div>
            {t.faqQ.map((q, i) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={20} />
                </summary>
                <p>{t.faqA[i]}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="closing">
          <div className="section-width">
            <span className="brand-symbol" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <h2>{t.closing}</h2>
            <p>{t.closingBody}</p>
            <a className="button button-lime" href="#demo">
              {t.try}
              <ArrowRight size={20} />
            </a>
          </div>
          <div className="closing-wordmark" aria-hidden="true">
            JomCall
          </div>
        </section>
      </main>
      <footer className="site-footer section-width">
        <div>
          <Brand />
          <p>{t.footerNote}</p>
        </div>
        <div>
          <a href={href("/privacy")}>{t.remaining.privacy}</a>
          <a href={href("/terms")}>{t.remaining.terms}</a>
          <a href={href("/pricing")}>{t.remaining.pricing}</a>
          <a href={href("/docs")}>{t.remaining.docs}</a>
          <a href={href("/login")}>{t.remaining.login}</a>
          <span>{t.footerPreview}</span>
        </div>
      </footer>
    </>
  );
}
