"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { usePathname, useSearchParams } from "next/navigation";
import { Moon, Sun } from "@phosphor-icons/react";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import type { Locale } from "@/lib/api/types";
import { lazy, Suspense } from "react";
import { Marketing } from "./marketing";
import { PublicPages } from "./public-pages";
import { LocalApp } from "./core/local-app";
const MockExperience = lazy(() => import("./mock-experience"));
type Theme = "light" | "dark";
const Context = createContext<{
  mode: "mock" | "local";
  t: typeof en;
  locale: Locale;
  theme: Theme;
  href: (path: string) => string;
  setTheme: (theme: Theme) => void;
}>({
  mode: "mock",
  t: en,
  locale: "en",
  theme: "light",
  href: (p) => p,
  setTheme: () => {},
});
export const useExperience = () => useContext(Context);
export function Controls() {
  const { t, locale, theme, href, setTheme } = useExperience();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="site-controls">
      <a
        className="locale-switch"
        aria-label={`${locale === "en" ? "BM" : "EN"} — ${t.language}`}
        href={href(`${pathname}?${params}`).replace(
          `lang=${locale}`,
          `lang=${locale === "en" ? "ms" : "en"}`,
        )}
      >
        {locale === "en" ? "BM" : "EN"}
      </a>
      <button
        className="icon-button"
        aria-label={theme === "light" ? t.dark : t.light}
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
      </button>
    </div>
  );
}
export function Brand() {
  const { href } = useExperience();
  return (
    <a href={href("/")} className="brand" aria-label="JomCall">
      <span className="brand-symbol" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>JomCall</span>
    </a>
  );
}
export function Experience({
  locale,
  initialTheme,
  screen,
  mode = "mock",
}: {
  mode?: "mock" | "local";
  locale: Locale;
  initialTheme: Theme;
  screen:
    | "home"
    | "settings"
    | "marketing"
    | "app"
    | "setup"
    | "test"
    | "builder"
    | "inbox"
    | "contacts"
    | "bookings"
    | "integrations"
    | "phones"
    | "whatsapp"
    | "billing"
    | "outbound"
    | "platform"
    | "selfhost"
    | "hours"
    | "pricing"
    | "docs"
    | "privacy"
    | "terms"
    | "login"
    | "signup"
    | "forgot"
    | "invite";
}) {
  const routeParams = useSearchParams();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const t = locale === "ms" ? ms : en;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme, locale]);
  const href = (path: string) => {
    const [url, hash] = path.split("#");
    const [pathname, query] = url.split("?");
    const params = new URLSearchParams(query);
    if (
      mode === "local" &&
      routeParams.get("workspace") &&
      !params.has("workspace")
    )
      params.set("workspace", routeParams.get("workspace")!);
    params.set("lang", locale);
    params.set("theme", theme);
    return `${pathname}?${params}${hash ? `#${hash}` : ""}`;
  };
  const updateTheme = (value: Theme) => {
    setTheme(value);
    const url = new URL(window.location.href);
    url.searchParams.set("theme", value);
    history.replaceState(null, "", url);
  };
  return (
    <Context.Provider
      value={{ mode, t, locale, theme, href, setTheme: updateTheme }}
    >
      <MotionConfig reducedMotion="user">
        <div
          className={`experience ${screen !== "marketing" ? "app-experience" : ""}`}
          data-theme={theme}
        >
          {screen === "marketing" ? (
            <Marketing />
          ) : ["pricing", "docs", "privacy", "terms"].includes(screen) ? (
            <PublicPages
              page={screen as "pricing" | "docs" | "privacy" | "terms"}
            />
          ) : mode === "local" ? (
            <LocalApp screen={screen} />
          ) : (
            <Suspense fallback={<p role="status">{t.product.loading}</p>}>
              <MockExperience screen={screen} locale={locale} />
            </Suspense>
          )}
        </div>
      </MotionConfig>
    </Context.Provider>
  );
}
