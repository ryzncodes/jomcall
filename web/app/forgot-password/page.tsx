import { mode } from "@/lib/server/config";
import { Experience } from "@/components/experience";
export const metadata = { title: "Reset password" };
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
      screen="forgot"
    />
  );
}
