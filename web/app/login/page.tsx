import { mode, turnstileSiteKey } from "@/lib/server/config";
import { Experience } from "@/components/experience";
export const metadata = { title: "Sign in" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  return (
    <Experience
      mode={mode()}
      turnstileSiteKey={turnstileSiteKey()}
      locale={p.lang === "ms" ? "ms" : "en"}
      initialTheme={p.theme === "dark" ? "dark" : "light"}
      screen="login"
    />
  );
}
