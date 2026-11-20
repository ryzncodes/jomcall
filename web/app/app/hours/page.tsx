import { redirect } from "next/navigation";
import { mode } from "@/lib/server/config";
import { Experience } from "@/components/experience";
export const metadata = { title: "Opening hours" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const m = mode();
  // The local and hosted apps keep opening hours on the agent page. Only
  // lang and theme are carried over, as fixed values, to a fixed path.
  if (m !== "mock") {
    const q = new URLSearchParams();
    if (p.lang === "ms") q.set("lang", "ms");
    if (p.theme === "dark") q.set("theme", "dark");
    const query = q.toString();
    redirect("/app/agent" + (query ? "?" + query : "") + "#hours");
  }
  return (
    <Experience
      mode={m}
      locale={p.lang === "ms" ? "ms" : "en"}
      initialTheme={p.theme === "dark" ? "dark" : "light"}
      screen="hours"
    />
  );
}
