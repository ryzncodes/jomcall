import type { Metadata } from "next";
import { HomePage } from "@/components/public/pages/home";
import { home } from "@/content/public/home";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("home", "ms", home.ms.meta);

export default function Page() {
  return <HomePage locale="ms" />;
}
