import type { Metadata } from "next";
import { GuidePage } from "@/components/public/pages/guide";
import { GUIDE_SLUGS, guides, type GuideSlug } from "@/content/public/guides";
import { pageMetadata } from "@/lib/public-meta";

// The three guides, all built at build time; any other slug is a 404. The
// forwarding guide's canonical is /call-forwarding (web/lib/site.ts).
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDE_SLUGS.map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug as GuideSlug;
  return pageMetadata(`guides-${slug}`, "ms", guides.ms[slug]);
}

export default async function Page({ params }: Props) {
  const slug = (await params).slug as GuideSlug;
  return <GuidePage locale="ms" slug={slug} />;
}
