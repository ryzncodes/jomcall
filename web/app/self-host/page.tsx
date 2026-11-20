import { mode } from "@/lib/server/config";
import { Experience } from "@/components/experience";
import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/page-title";
export const generateMetadata = pageTitle("Self-host", "Hos sendiri");
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Preview-only page: it describes sample features, not the live product.
  if (mode() === "hosted") notFound();
  const p = await searchParams;
  return (
    <Experience
      mode={mode()}
      locale={p.lang === "ms" ? "ms" : "en"}
      initialTheme={p.theme === "dark" ? "dark" : "light"}
      screen="selfhost"
    />
  );
}
