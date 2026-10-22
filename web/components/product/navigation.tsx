"use client";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CaretDown, CheckCircle, GearSix, List, Robot, X, type Icon } from "@phosphor-icons/react";
import { useExperience } from "../experience";

interface Entry { key: string; href: string; label: string; Icon: Icon }

export function WorkspaceNavigation({ active, entries, setupComplete }: {
  active: string;
  entries: Entry[];
  setupComplete: boolean;
}) {
  const { t, href, theme } = useExperience();
  const [open, setOpen] = useState(false);
  const desktop = useRef<HTMLElement>(null);
  const mobileCurrent = useRef<HTMLAnchorElement>(null);
  const select = (keys: string[]) => keys.flatMap(key => entries.filter(item => item.key === key));
  const daily = select(["home", "inbox", "calls", "contacts", "bookings", "outbound"]);
  const quick = daily.slice(0, 3);
  const groups = [
    { id: "agent", label: t.navigation.agent, Icon: Robot, entries: select(["builder", "test", "setup"]) },
    { id: "workspace", label: t.navigation.workspace, Icon: GearSix, entries: select(["hours", "phones", "whatsapp", "integrations", "billing", "settings"]) },
  ];
  const inMenu = !quick.some(item => item.key === active);

  useEffect(() => {
    const element = desktop.current;
    if (!element) return;
    let alive = true;
    const reveal = () => {
      if (!alive || !element.clientHeight) return;
      const link = element.querySelector<HTMLElement>('[aria-current="page"]');
      if (!link || !link.getClientRects().length) return;
      const item = link.getBoundingClientRect(), box = element.getBoundingClientRect();
      if (item.bottom > box.bottom) element.scrollTop += item.bottom - box.bottom + 8;
      if (item.top < box.top) element.scrollTop -= box.top - item.top;
    };
    reveal();
    void document.fonts.ready.then(() => requestAnimationFrame(reveal));
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => { alive = false; observer.disconnect(); };
  }, [active]);

  useEffect(() => {
    const query = matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => { if (query.matches) setOpen(false); };
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);

  const link = ({ key, href: url, label, Icon }: Entry, inDialog = false) => (
    <a key={key} className={`navigation-link${active === key ? " active" : ""}`}
      ref={inDialog && active === key ? mobileCurrent : undefined}
      href={href(url)} aria-current={active === key ? "page" : undefined}
      onClick={() => setOpen(false)}>
      <Icon size={19} aria-hidden="true" />
      <span>{label}</span>
      {key === "setup" && setupComplete && <CheckCircle className="navigation-complete" size={15} aria-hidden="true" />}
    </a>
  );

  return <>
    <nav className="app-navigation" aria-label={t.navigation.label} ref={desktop}>
      <div className="navigation-daily">{daily.map(item => link(item))}</div>
      <div className="navigation-groups">
        {groups.map(group => <details key={`${group.id}-${active}`} open={group.entries.some(item => item.key === active)}>
          <summary>
            <group.Icon size={19} aria-hidden="true" />
            <span>{group.label}</span>
            <CaretDown className="navigation-caret" size={14} aria-hidden="true" />
          </summary>
          <div className="navigation-children">{group.entries.map(item => link(item))}</div>
        </details>)}
      </div>
    </nav>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <nav className="app-quick-navigation" aria-label={t.navigation.label}>
        {quick.map(item => link(item))}
        <Dialog.Trigger className={`navigation-menu-trigger${inMenu ? " active" : ""}`}>
          <List size={20} aria-hidden="true" /><span>{t.navigation.menu}</span>
          {inMenu && <span className="navigation-current-dot" aria-hidden="true" />}
        </Dialog.Trigger>
      </nav>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="navigation-dialog" data-theme={theme}
          onOpenAutoFocus={event => {
            if (mobileCurrent.current) { event.preventDefault(); mobileCurrent.current.focus(); }
          }}>
          <header>
            <div><Dialog.Title>{t.navigation.menu}</Dialog.Title>
              <Dialog.Description>{t.navigation.description}</Dialog.Description></div>
            <Dialog.Close className="icon-button" aria-label={t.closeMenu}><X size={22} /></Dialog.Close>
          </header>
          <nav aria-label={t.navigation.label} className="navigation-dialog-links">
            {[{ id: "daily", label: t.navigation.daily, entries: daily }, ...groups].map(group =>
              <section key={group.id} aria-labelledby={`mobile-nav-${group.id}`}>
                <h3 id={`mobile-nav-${group.id}`}>{group.label}</h3>
                {group.entries.map(item => link(item, true))}
              </section>)}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
