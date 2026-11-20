import type { Metadata } from "next";
import { LegalPage } from "@/components/public/pages/legal";
import { pageMetadata } from "@/lib/public-meta";
import { legalCopy } from "@/messages/legal";

export const metadata: Metadata = pageMetadata("privacy", "ms", {
  title: legalCopy.ms.privacy.title,
  description: legalCopy.ms.privacy.intro,
});

export default function Page() {
  return <LegalPage kind="privacy" locale="ms" />;
}
