import { legalCopy, type LegalSection } from "../../messages/legal.ts";
import type { PublicLocale } from "../../lib/site.ts";
import { legalAnchors } from "./legal-anchors.ts";

// The privacy notice's section on who receives data, for the trust page to
// quote word for word (spec section 3: quoted, not restated). Found by its
// list of providers, so it does not depend on the heading's wording; the
// anchor is the one the privacy page gives that heading.
export function providersSection(locale: PublicLocale): LegalSection & { anchor: string } {
  const doc = legalCopy[locale].privacy;
  const index = doc.sections.findIndex((s) => s.list?.some((item) => item.startsWith("Supabase")));
  if (index < 0) throw Error("PROVIDERS_SECTION_MISSING");
  return { ...doc.sections[index], anchor: legalAnchors(doc)[index].id };
}
