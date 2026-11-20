import { mode } from "@/lib/server/config";
import { Experience } from "@/components/experience";
import { pageTitle } from "@/lib/page-title";
// Where a confirmation or recovery email link lands. Loading this page uses
// nothing; the button on it does.
export const generateMetadata = pageTitle("Open link", "Buka pautan", { referrer: "no-referrer" });
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
      screen="link"
    />
  );
}
