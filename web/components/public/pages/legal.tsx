import { breadcrumbLd } from "@/lib/json-ld";
import type { PublicLocale } from "@/lib/site";
import { LegalBody } from "../legal-body";
import { JsonLd } from "../json-ld";
import { PublicShell } from "../shell";

// The privacy notice and the terms of use in the public shell.
export function LegalPage({ kind, locale }: { kind: "privacy" | "terms"; locale: PublicLocale }) {
  return (
    <PublicShell locale={locale} page={kind}>
      <JsonLd data={breadcrumbLd(kind, locale)} />
      <LegalBody kind={kind} locale={locale} />
    </PublicShell>
  );
}
