"use client";
import type { ReactNode } from "react";
import { useSignedIn } from "@/components/signed-in";
import { HOSTED } from "@/lib/hosted";
import type { PublicLocale } from "@/lib/site";
import { appHref } from "./links";
import { useTheme } from "./theme-toggle";

// A link into the app (`/login`, `/signup`, `/app/*`) that carries the
// visitor's language and theme. The static HTML says "light"; the real theme
// is filled in after hydration.
export function AppLink({
  path,
  locale,
  className,
  children,
}: {
  path: string;
  locale: PublicLocale;
  className?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <a href={appHref(path, locale, theme)} className={className}>
      {children}
    </a>
  );
}

// The primary call to action: sign-up for visitors, the workspace for a
// signed-in owner (hosted only). While the session check runs it keeps the
// button's place with an empty box of the same size.
export function Cta({
  locale,
  getStarted,
  openWorkspace,
  block = false,
}: {
  locale: PublicLocale;
  getStarted: string;
  openWorkspace: string;
  block?: boolean;
}) {
  const email = useSignedIn(HOSTED);
  const className = `btn btn-primary${block ? " btn-block" : ""}`;
  if (email === undefined)
    return (
      <span className={`${className} btn-wait`} aria-hidden="true">
        {getStarted}
      </span>
    );
  return email ? (
    <AppLink path="/app" locale={locale} className={className}>
      {openWorkspace}
    </AppLink>
  ) : (
    <AppLink path="/signup" locale={locale} className={className}>
      {getStarted}
    </AppLink>
  );
}
