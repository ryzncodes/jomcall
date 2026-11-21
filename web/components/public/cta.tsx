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

// A label that also holds the other state's label, invisible, in the same
// grid cell: the button is as wide as the longer one in every state, so it
// never jumps when the session check answers.
function Label({ text, reserve }: { text: string; reserve: string }) {
  return (
    <span className="cta-label">
      <span>{text}</span>
      <span className="cta-reserve" aria-hidden="true">
        {reserve}
      </span>
    </span>
  );
}

// The primary call to action: sign-up for visitors, the workspace for a
// signed-in owner (hosted only). Until the session check answers it shows the
// visitor's sign-up link, which is also what the static HTML and a visitor
// without script get; both labels share one grid cell, so the button keeps
// its width when it switches to the workspace label. In the header, phones
// get the short workspace label so the row fits at 360 px.
export function Cta({
  locale,
  getStarted,
  openWorkspace,
  openWorkspaceShort,
  block = false,
}: {
  locale: PublicLocale;
  getStarted: string;
  openWorkspace: string;
  openWorkspaceShort?: string;
  block?: boolean;
}) {
  const email = useSignedIn(HOSTED);
  const className = `btn btn-primary${block ? " btn-block" : ""}`;
  const labels = (text: string, alt: string, short?: string, shortAlt?: string) =>
    short === undefined || shortAlt === undefined ? (
      <Label text={text} reserve={alt} />
    ) : (
      <>
        <span className="cta-full">
          <Label text={text} reserve={alt} />
        </span>
        <span className="cta-short">
          <Label text={short} reserve={shortAlt} />
        </span>
      </>
    );
  const short = openWorkspaceShort;
  return email ? (
    <AppLink path="/app" locale={locale} className={className}>
      {labels(openWorkspace, getStarted, short, short && getStarted)}
    </AppLink>
  ) : (
    <AppLink path="/signup" locale={locale} className={className}>
      {labels(getStarted, openWorkspace, short && getStarted, short)}
    </AppLink>
  );
}
