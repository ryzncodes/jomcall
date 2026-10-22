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
export const metadata: Metadata = {
  title: "JomCall — Every hello. Handled.",
  description:
    "An AI front desk for Malaysian businesses. Frontend preview with fictional calls.",
  robots: { index: false, follow: false },
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
