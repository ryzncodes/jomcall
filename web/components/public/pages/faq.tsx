import { faq, faqGroups, faqItems } from "@/content/public/faq";
import { faqLd } from "@/lib/json-ld";
import type { PublicLocale } from "@/lib/site";
import { FaqList } from "../faq-list";
import { ArticlePage } from "./article";

// The FAQ hub: six groups, each a heading and its questions, with the
// contents list naming the groups. Every question on the page is in the
// FAQPage structured data, because every one is shown.
export function FaqPage({ locale }: { locale: PublicLocale }) {
  return (
    <ArticlePage
      locale={locale}
      page="faq"
      copy={faq[locale].page}
      ld={[faqLd(faqItems(locale))]}
      related={[{ id: "pricing" }, { id: "call-forwarding" }, { id: "privacy" }]}
      sections={faqGroups(locale).map((group) => ({
        id: group.id,
        heading: group.heading,
        children: <FaqList items={group.items} />,
      }))}
    />
  );
}
