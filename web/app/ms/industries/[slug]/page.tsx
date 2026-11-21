import type { Metadata } from "next";
import { IndustryPage } from "@/components/public/pages/industry";
import { INDUSTRY_SLUGS, industries, type IndustrySlug } from "@/content/public/industries";
import { pageMetadata } from "@/lib/public-meta";

// The six industry pages, all built at build time; any other slug is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return INDUSTRY_SLUGS.map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug as IndustrySlug;
  return pageMetadata(`industries-${slug}`, "ms", industries.ms[slug]);
}

export default async function Page({ params }: Props) {
  const slug = (await params).slug as IndustrySlug;
  return <IndustryPage locale="ms" slug={slug} />;
}
