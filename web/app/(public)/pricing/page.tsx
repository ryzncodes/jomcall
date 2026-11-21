import type { Metadata } from "next";
import { PricingPage } from "@/components/public/pages/pricing";
import { pricing } from "@/content/public/pricing";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("pricing", "en", pricing.en.meta);

export default function Page() {
  return <PricingPage locale="en" />;
}
