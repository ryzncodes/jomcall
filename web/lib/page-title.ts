import type { Metadata } from "next";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A page's browser tab title in the page's language, chosen the same way
// the page chooses it: ?lang=ms is Bahasa Melayu, anything else English.
// The layout adds " · JomCall".
export function pageTitle(en: string, ms: string, extra: Metadata = {}) {
  return async ({ searchParams }: Props): Promise<Metadata> => ({
    ...extra,
    title: (await searchParams).lang === "ms" ? ms : en,
  });
}
