import type { Metadata } from "next";
import { CompareIndexPage } from "@/components/public/pages/compare";
import { compareIndex } from "@/content/public/compare";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("compare", "en", compareIndex.en.page);

export default function Page() {
  return <CompareIndexPage locale="en" />;
}
