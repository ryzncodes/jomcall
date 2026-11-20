import { notFound } from "next/navigation";
import { mode } from "@/lib/server/config";
import { Experience } from "@/components/experience";
import { pageTitle } from "@/lib/page-title";
export const generateMetadata = pageTitle("Follow-up", "Susulan");
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  // Follow-up (outbound) is not built for real workspaces: the hosted site has no such page.
  if (mode() === "hosted") notFound();
  return (
    <Experience
      mode={mode()}
      locale={p.lang === "ms" ? "ms" : "en"}
      initialTheme={p.theme === "dark" ? "dark" : "light"}
      screen="outbound"
    />
  );
}
