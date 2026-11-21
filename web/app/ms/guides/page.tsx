import type { Metadata } from "next";
import { GuidesIndexPage } from "@/components/public/pages/guide";
import { guidesIndex } from "@/content/public/guides";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("guides", "ms", guidesIndex.ms.page);

export default function Page() {
  return <GuidesIndexPage locale="ms" />;
}
