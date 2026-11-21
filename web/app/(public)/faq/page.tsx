import type { Metadata } from "next";
import { FaqPage } from "@/components/public/pages/faq";
import { faq } from "@/content/public/faq";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("faq", "en", faq.en.page);

export default function Page() {
  return <FaqPage locale="en" />;
}
