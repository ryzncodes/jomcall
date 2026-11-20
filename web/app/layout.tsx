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
import { HOSTED } from "@/lib/hosted";
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
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
