import type { Metadata } from "./next-metadata";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A page's browser tab title in the page's language, chosen the same way
// the page chooses it: ?lang=ms is Bahasa Melayu, anything else English.
// The layout adds " · JomCall".
// { absolute: true } skips the " · JomCall" suffix, for titles that already
// name the brand.
export function pageTitle(
  en: string,
  ms: string,
  extra: Metadata = {},
  options: { absolute?: boolean } = {},
) {
  return async ({ searchParams }: Props): Promise<Metadata> => {
    const t = (await searchParams).lang === "ms" ? ms : en;
    return { ...extra, title: options.absolute ? { absolute: t } : t };
  };
}
