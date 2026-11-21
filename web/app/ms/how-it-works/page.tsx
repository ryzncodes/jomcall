import type { Metadata } from "next";
import { HowItWorksPage } from "@/components/public/pages/how-it-works";
import { howItWorks } from "@/content/public/how-it-works";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("how-it-works", "ms", howItWorks.ms.page);

export default function Page() {
  return <HowItWorksPage locale="ms" />;
}
