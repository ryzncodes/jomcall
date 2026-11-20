// Shapes shared by every public content module. Each module exports values
// typed `Bilingual<...>` so a missing Bahasa Melayu string is a type error.
export type Bilingual<T> = { en: T; ms: T };
export type FaqItem = { q: string; a: string };
export type Section = { heading: string; body: string[] };
export type SampleLine = { who: "caller" | "agent"; text: string };
export type PageCopy = {
  title: string;
  description: string;
  h1: string;
  lead: string;
};
