import { common } from "../content/public/common.ts";
import { home } from "../content/public/home.ts";
import { pricing } from "../content/public/pricing.ts";
import { legalCopy } from "../messages/legal.ts";
import { whatsappWaiting } from "./launch.ts";
import { rm } from "../content/public/format.ts";
import { publicPlans } from "./pricing.ts";
import { PUBLIC_PAGES, localePath, siteOrigin, type PublicLocale, type PublicPageId } from "./site.ts";

// The text served at /llms.txt. Every line is a fact from spec section 3;
// prices come from web/lib/pricing.ts. Nothing here states a wait time, and
// WhatsApp is described as waiting for Meta.
function describe(id: PublicPageId, locale: PublicLocale): string {
  if (id === "home") return home[locale].meta.description;
  if (id === "pricing") return pricing[locale].meta.description;
  if (id === "privacy" || id === "terms") return legalCopy[locale][id].title;
  return common[locale].pages[id];
}

export function llmsText(): string {
  const origin = siteOrigin() ?? "";
  const [starter, growth, payg] = publicPlans;
  const minutes = (s: number) => s / 60;
  const list = (locale: PublicLocale) =>
    PUBLIC_PAGES.map(
      ({ id }) => `- [${common[locale].pages[id]}](${origin}${localePath(id, locale)}): ${describe(id, locale)}`,
    ).join("\n");

  return `# JomCall

> ${common.en.tagline} JomCall answers a business's phone calls day and night with an AI that says it is an AI, and speaks the caller's language.

## Facts

- Answers phone calls on a JomCall number, day and night. The AI introduces itself as an AI, and an agent cannot be published without that introduction.
- Speaks BM, English, Manglish and Mandarin, following the caller.
- Answers questions from the business's own facts and price list.
- Books appointments into JomCall's bookings, with the time read back to the caller.
- Takes messages for the team.
- Passes the caller to the business's staff during opening hours (a blind transfer).
- Keep your number: forward its calls to your JomCall number. You request a JomCall number in the app and a person sets it up.
- Plans: Starter ${rm(starter.monthlyFeeSen)} a month (one phone number, ${minutes(starter.includedVoiceSeconds)} minutes); Growth ${rm(growth.monthlyFeeSen)} a month (one phone number, ${minutes(growth.includedVoiceSeconds)} minutes); pay as you go with no monthly fee (${rm(payg.monthlyFeeSen)}) and no phone number.
- Prepaid wallet in MYR. No card is charged automatically.
- Calls are not recorded.
- A contact's data can be exported and deleted.
- Setup is self-serve: pick a business type, answer up to 8 questions or bring a price list as a photo, PDF, CSV file or pasted text, then review, test in the browser and publish.
- The source code is public under FSL-1.1-ALv2.
- WhatsApp: ${whatsappWaiting.short[0]}.

## Pages (English)

${list("en")}

## Halaman (Bahasa Melayu)

${list("ms")}
`;
}
