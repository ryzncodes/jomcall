import type { Metadata } from "./next-metadata";
import { isHostedSite, isIndexable } from "./site.ts";

// The root layout's metadata, read at call time so a test can set the mode.
// Robots follow `isIndexable()`: only the hosted jomcall.com site is open to
// search engines. Every other page, including the app routes and the 404
// page, inherits noindex from here on staging, mock and local.
export function rootMetadata(): Metadata {
  return {
    title: { default: "JomCall — Every hello. Handled.", template: "%s · JomCall" },
    description: isHostedSite()
      ? "An AI receptionist for Malaysian businesses. It answers your phone calls in Bahasa Melayu, English and Mandarin, takes bookings and passes callers to your staff during opening hours."
      : "An AI front desk for Malaysian businesses. Frontend preview with fictional calls.",
    robots: isIndexable() ? { index: true, follow: true } : { index: false, follow: false },
  };
}
