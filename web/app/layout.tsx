import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import "./crm.css";
import "./operations.css";
import "./services.css";
import "./admin.css";
import "./remaining.css";
import "./navigation.css";
import "./core.css";
import "./public.css";
import { HOSTED } from "@/lib/hosted";
import { fontVariables } from "@/lib/fonts";
import { PRE_PAINT_SCRIPT } from "@/lib/theme-script";
// The hosted site is the real product and may be indexed; the mock preview
// shows fictional calls and stays out of search results.
export const metadata: Metadata = {
  title: { default: "JomCall — Every hello. Handled.", template: "%s · JomCall" },
  description: HOSTED
    ? "An AI receptionist for Malaysian businesses. It answers your phone calls in Bahasa Melayu, English and Mandarin, takes bookings and passes callers to your team."
    : "An AI front desk for Malaysian businesses. Frontend preview with fictional calls.",
  robots: HOSTED ? { index: true, follow: true } : { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The pre-paint script sets the theme, and `lang="ms"` on /ms pages, on
    // <html> before React hydrates; suppressHydrationWarning accepts that.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
