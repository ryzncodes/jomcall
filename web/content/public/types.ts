// Shapes shared by every public content module. Each module exports values
// typed `Bilingual<...>` so a missing Bahasa Melayu string is a type error.
export type Bilingual<T> = { en: T; ms: T };
export type FaqItem = { q: string; a: string };
export type Section = { heading: string; body: string[] };
// One line of a made-up sample call. An "event" line is what JomCall did
// (checked bookings, saved a message), shown between the spoken turns. `lang`
// marks a line in another language than the page (Mandarin in a BM page).
export type SampleLine = { who: "caller" | "agent" | "event"; text: string; lang?: "ms" | "en" | "zh" };
export type PageCopy = {
  title: string;
  description: string;
  h1: string;
  lead: string;
};
