import type { Metadata } from "next";
import { PricingPage } from "@/components/public/pages/pricing";
import { pricing } from "@/content/public/pricing";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("pricing", "ms", pricing.ms.meta);

export default function Page() {
  return <PricingPage locale="ms" />;
}
