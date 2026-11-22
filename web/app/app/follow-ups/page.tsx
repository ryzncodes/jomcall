import { notFound } from "next/navigation";
import { mode } from "@/lib/server/config";
import { Experience } from "@/components/experience";
import { pageTitle } from "@/lib/page-title";
export const generateMetadata = pageTitle("To follow up", "Untuk disusuli");
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  // The follow-up queue holds real calls and chats: the sample preview has none.
  if (mode() === "mock") notFound();
  return (
    <Experience
      mode={mode()}
      locale={p.lang === "ms" ? "ms" : "en"}
      initialTheme={p.theme === "dark" ? "dark" : "light"}
      screen="follow-ups"
    />
  );
}
