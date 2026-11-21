import type { Metadata } from "next";
import { LegalPage } from "@/components/public/pages/legal";
import { fillOperator } from "@/components/public/operator";
import { pageMetadata } from "@/lib/public-meta";
import { legalCopy } from "@/messages/legal";

export const metadata: Metadata = pageMetadata("privacy", "en", {
  title: legalCopy.en.privacy.title,
  description: fillOperator(legalCopy.en.privacy.intro),
});

export default function Page() {
  return <LegalPage kind="privacy" locale="en" />;
}
