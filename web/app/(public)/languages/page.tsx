import type { Metadata } from "next";
import { LanguagesPage } from "@/components/public/pages/languages";
import { languages } from "@/content/public/languages";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("languages", "en", languages.en.page);

export default function Page() {
  return <LanguagesPage locale="en" />;
}
