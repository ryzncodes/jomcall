import { common } from "@/content/public/common";
import { isHostedSite, type PublicLocale, type PublicPageId } from "@/lib/site";
import { Brand } from "./header";
import { FOOTER_GROUPS, languageLink, pageLink } from "./nav";
import { OperatorDetails } from "./operator";

export function Footer({ locale, page }: { locale: PublicLocale; page: PublicPageId }) {
  const t = common[locale];
  const language = languageLink(locale, page);
  return (
    <footer className="site-footer">
      <div className="frame">
        <nav className="footer-grid" aria-label={t.footerNav}>
          <div className="footer-intro">
            <Brand locale={locale} />
            <p className="t-small">{t.tagline}</p>
          </div>
          {FOOTER_GROUPS.map(([group, ids]) => (
            <div key={group} className="footer-group">
              <h2 className="t-label">{t.groups[group]}</h2>
              <ul>
                {ids.map((id) => {
                  const item = pageLink(id, locale, page);
                  return (
                    <li key={id}>
                      <a
                        href={item.href}
                        aria-current={item.current ? "page" : undefined}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="footer-base">
          <OperatorDetails locale={locale} />
          <p className="t-small">
            <a href={language.href} hrefLang={language.lang} lang={language.lang}>
              {language.label}
            </a>
          </p>
          {!isHostedSite() && <p className="footer-preview t-label">{t.preview}</p>}
        </div>
      </div>
    </footer>
  );
}
