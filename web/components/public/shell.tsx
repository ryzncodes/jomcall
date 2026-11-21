import type { ReactNode } from "react";
import { common } from "@/content/public/common";
import { fontVariables } from "@/lib/fonts";
import { organizationLd, websiteLd } from "@/lib/json-ld";
import type { PublicLocale, PublicPageId } from "@/lib/site";
import { Footer } from "./footer";
import { Header } from "./header";
import { JsonLd } from "./json-ld";

// The frame of every public page: header, the page in a <main> marked with
// its language (so a BM page reads as BM before any script runs), and the
// footer, which outside the hosted site says this is a preview build.
export function PublicShell({
  locale,
  page,
  children,
}: {
  locale: PublicLocale;
  page: PublicPageId;
  children: ReactNode;
}) {
  return (
    <div className={`public ${fontVariables}`} id="public-root" lang={locale}>
      <JsonLd data={organizationLd()} />
      <JsonLd data={websiteLd()} />
      <a className="skip" href="#main">
        {common[locale].skip}
      </a>
      <Header locale={locale} page={page} />
      <main id="main" lang={locale} tabIndex={-1}>
        {children}
      </main>
      <Footer locale={locale} page={page} />
    </div>
  );
}
