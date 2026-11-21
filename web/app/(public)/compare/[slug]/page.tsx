import type { Metadata } from "next";
import { ComparePage } from "@/components/public/pages/compare";
import { COMPARE_SLUGS, compare, type CompareSlug } from "@/content/public/compare";
import { pageMetadata } from "@/lib/public-meta";

// The four comparison pages, all built at build time; any other slug is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARE_SLUGS.map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug as CompareSlug;
  return pageMetadata(`compare-${slug}`, "en", compare.en[slug]);
}

export default async function Page({ params }: Props) {
  const slug = (await params).slug as CompareSlug;
  return <ComparePage locale="en" slug={slug} />;
}
