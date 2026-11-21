"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { PublicLocale } from "@/lib/site";
import { AppLink, Cta } from "./cta";
import type { NavEntry, NavLinkItem } from "./nav";
import { ThemeToggle } from "./theme-toggle";

const current = (item: NavLinkItem) =>
  item.current ? ("page" as const) : undefined;

function Chevron() {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="m3.5 5.25 3.5 3.5 3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Desktop menus: each group is a disclosure button with a panel of links.
// One panel is open at a time; Escape, a click outside or moving focus out
// closes it, and Escape returns focus to its button.
export function NavMenus({
  entries,
  label,
}: {
  entries: NavEntry[];
  label: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const base = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!nav.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      buttons.current[open]?.focus();
      setOpen(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <nav
      ref={nav}
      className="site-nav header-desktop"
      aria-label={label}
      onBlur={(e) => {
        if (!nav.current?.contains(e.relatedTarget as Node | null)) setOpen(null);
      }}
    >
      <ul>
        {entries.map((entry) =>
          entry.kind === "link" ? (
            <li key={entry.href}>
              <a className="nav-link" href={entry.href} aria-current={current(entry)}>
                {entry.label}
              </a>
            </li>
          ) : (
            <li key={entry.id} className="nav-item">
              <button
                ref={(el) => {
                  buttons.current[entry.id] = el;
                }}
                type="button"
                className="nav-link"
                aria-expanded={open === entry.id}
                aria-controls={`${base}-${entry.id}`}
                onClick={() => setOpen((o) => (o === entry.id ? null : entry.id))}
              >
                {entry.label}
                <Chevron />
              </button>
              <div
                id={`${base}-${entry.id}`}
                className={`nav-panel${entry.wide ? " nav-panel-wide" : ""}`}
                hidden={open !== entry.id}
              >
                <ul>
                  {entry.items.map((item) => (
                    <li key={item.href}>
                      <a href={item.href} aria-current={current(item)}>
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
                {entry.foot && (
                  <div className="nav-panel-foot">
                    <a href={entry.foot.href} aria-current={current(entry.foot)}>
                      {entry.foot.label}
                    </a>
                  </div>
                )}
              </div>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

// Phones and tablets: one menu button opens a full-height sheet. Radix keeps
// focus inside it, closes it on Escape and returns focus to the button. The
// sheet is placed inside the shell root so the Kaunter tokens apply.
export function MobileMenu({
  entries,
  brand,
  locale,
  language,
  labels,
}: {
  entries: NavEntry[];
  brand: ReactNode;
  locale: PublicLocale;
  language: { href: string; label: string; lang: PublicLocale };
  labels: {
    menu: string;
    closeMenu: string;
    nav: string;
    login: string;
    getStarted: string;
    openWorkspace: string;
    darkTheme: string;
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="icon-btn" aria-label={labels.menu}>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3 6.5h14M3 13.5h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </Dialog.Trigger>
      <Dialog.Portal
        container={open ? document.getElementById("public-root") : undefined}
      >
        <Dialog.Content className="sheet" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{labels.menu}</Dialog.Title>
          <div className="sheet-top">
            <div className="frame site-header-row">
              {brand}
              <Dialog.Close className="icon-btn" aria-label={labels.closeMenu}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="m5 5 10 10M15 5 5 15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </Dialog.Close>
            </div>
          </div>
          <nav className="frame sheet-body" aria-label={labels.nav}>
            {entries.map((entry) =>
              entry.kind === "link" ? (
                <div key={entry.href} className="sheet-group">
                  <a href={entry.href} aria-current={current(entry)}>
                    {entry.label}
                  </a>
                </div>
              ) : (
                <div key={entry.id} className="sheet-group">
                  <h2 className="t-label">{entry.label}</h2>
                  <ul>
                    {[...entry.items, ...(entry.foot ? [entry.foot] : [])].map(
                      (item) => (
                        <li key={item.href}>
                          <a href={item.href} aria-current={current(item)}>
                            {item.label}
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ),
            )}
            <div className="sheet-row">
              <a
                className="lang-link"
                href={language.href}
                hrefLang={language.lang}
                lang={language.lang}
              >
                {language.label}
              </a>
              <ThemeToggle label={labels.darkTheme} />
            </div>
            <div className="sheet-actions">
              <AppLink path="/login" locale={locale} className="btn btn-secondary btn-block">
                {labels.login}
              </AppLink>
              <Cta
                locale={locale}
                getStarted={labels.getStarted}
                openWorkspace={labels.openWorkspace}
                block
              />
            </div>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
