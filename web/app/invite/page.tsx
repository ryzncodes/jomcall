import { mode } from "@/lib/server/config";
import { Experience } from "@/components/experience";
import { pageTitle } from "@/lib/page-title";
export const generateMetadata = pageTitle("Invitation", "Jemputan");
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  return (
    <Experience
      mode={mode()}
      locale={p.lang === "ms" ? "ms" : "en"}
      initialTheme={p.theme === "dark" ? "dark" : "light"}
      screen="invite"
    />
  );
}
