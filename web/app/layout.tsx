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
import { rootMetadata } from "@/lib/root-meta";
import { PRE_PAINT_SCRIPT } from "@/lib/theme-script";
// Only the hosted jomcall.com site may be indexed (see rootMetadata).
export const metadata: Metadata = rootMetadata();
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The pre-paint script sets the theme, and `lang="ms"` on /ms pages, on
    // <html> before React hydrates; suppressHydrationWarning accepts that.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
