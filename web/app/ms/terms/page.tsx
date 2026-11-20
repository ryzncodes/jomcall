import type { Metadata } from "next";
import { LegalPage } from "@/components/public/pages/legal";
import { pageMetadata } from "@/lib/public-meta";
import { legalCopy } from "@/messages/legal";

export const metadata: Metadata = pageMetadata("terms", "ms", {
  title: legalCopy.ms.terms.title,
  description: legalCopy.ms.terms.intro,
});

export default function Page() {
  return <LegalPage kind="terms" locale="ms" />;
}
