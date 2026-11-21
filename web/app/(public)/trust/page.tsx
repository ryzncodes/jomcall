import type { Metadata } from "next";
import { TrustPage } from "@/components/public/pages/trust";
import { trust } from "@/content/public/trust";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("trust", "en", trust.en.page);

export default function Page() {
  return <TrustPage locale="en" />;
}
