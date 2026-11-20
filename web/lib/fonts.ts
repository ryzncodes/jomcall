import localFont from "next/font/local";

// The public pages' three faces, served from this site (all OFL; licences
// beside the files in public/fonts). Only the public shell imports this
// module and sets the variables (on its root), so the app screens keep their
// own fonts and never preload these. The display face (the heading most
// likely to be the largest paint) is preloaded; the other two are found
// through public.css and swap in over a size-adjusted fallback.

export const displayFont = localFont({
  src: "../public/fonts/FamiljenGrotesk.ttf",
  weight: "400 700",
  variable: "--kaunter-font-display",
  display: "swap",
  adjustFontFallback: "Arial",
  preload: true,
});

export const textFont = localFont({
  src: "../public/fonts/PublicSans-Variable.ttf",
  weight: "100 900",
  variable: "--kaunter-font-text",
  display: "swap",
  adjustFontFallback: "Arial",
  preload: false,
});

export const monoFont = localFont({
  src: "../public/fonts/IBMPlexMono-Medium.ttf",
  weight: "500",
  variable: "--kaunter-font-mono",
  display: "swap",
  adjustFontFallback: "Arial",
  preload: false,
});

export const fontVariables = `${displayFont.variable} ${textFont.variable} ${monoFont.variable}`;
