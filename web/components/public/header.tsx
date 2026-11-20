import { common } from "@/content/public/common";
import { localePath, type PublicLocale, type PublicPageId } from "@/lib/site";
import { AppLink, Cta } from "./cta";
import { headerEntries, languageLink } from "./nav";
import { MobileMenu, NavMenus } from "./nav-menu";
import { ThemeToggle } from "./theme-toggle";

export function Brand({ locale }: { locale: PublicLocale }) {
  return (
    <a className="brand" href={localePath("home", locale)} aria-label={common[locale].home}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="var(--forest)" />
        <g
          fill="none"
          stroke="var(--on-forest)"
          strokeWidth="5"
          transform="rotate(-18 32 32)"
        >
          <rect x="16" y="23" width="7" height="25" rx="3.5" />
          <rect x="28.5" y="13" width="7" height="35" rx="3.5" />
          <rect x="41" y="24" width="7" height="17" rx="3.5" />
        </g>
      </svg>
      <span>JomCall</span>
    </a>
  );
}

export function Header({ locale, page }: { locale: PublicLocale; page: PublicPageId }) {
  const t = common[locale];
  const entries = headerEntries(locale, page);
  const language = languageLink(locale, page);
  return (
    <header className="site-header">
      <div className="frame site-header-row">
        <Brand locale={locale} />
        <NavMenus entries={entries} label={t.primaryNav} />
        <div className="header-actions">
          <div className="header-desktop">
            <a
              className="lang-link"
              href={language.href}
              hrefLang={language.lang}
              lang={language.lang}
            >
              {language.label}
            </a>
            <ThemeToggle label={t.darkTheme} />
            <AppLink path="/login" locale={locale} className="nav-link">
              {t.login}
            </AppLink>
          </div>
          <Cta locale={locale} getStarted={t.getStarted} openWorkspace={t.openWorkspace} />
          <div className="header-mobile">
            <MobileMenu
              entries={entries}
              brand={<Brand locale={locale} />}
              locale={locale}
              language={language}
              labels={{
                menu: t.menu,
                closeMenu: t.closeMenu,
                nav: t.primaryNav,
                login: t.login,
                getStarted: t.getStarted,
                openWorkspace: t.openWorkspace,
                darkTheme: t.darkTheme,
              }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
