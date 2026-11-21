import type { Metadata } from "next";
import { IndustriesIndexPage } from "@/components/public/pages/industries-index";
import { industriesIndex } from "@/content/public/industries";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("industries", "en", industriesIndex.en.page);

export default function Page() {
  return <IndustriesIndexPage locale="en" />;
}
