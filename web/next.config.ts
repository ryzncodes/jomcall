import type { NextConfig } from "next";
if (
  process.env.JOMCALL_MODE &&
  !["mock", "local", "hosted"].includes(process.env.JOMCALL_MODE)
)
  throw new Error("INVALID_MODE");
const nextConfig: NextConfig = {
  // Vercel expects the default ".next"; locally, keep mock and local builds apart.
  distDir: process.env.VERCEL
    ? ".next"
    : process.env.JOMCALL_MODE === "local"
      ? ".next-local"
      : process.env.JOMCALL_MODE === "hosted"
        ? ".next-hosted"
        : ".next-mock",
  logging: {
    incomingRequests: {
      ignore: [/^\/api\/auth\/(confirm|recovery)/, /^\/invite/],
    },
  },
  // Build-time mode switch: lets the mock build drop local-only code
  // (voice testing, livekit-client) instead of shipping it unused. Each
  // environment sets JOMCALL_MODE itself; an unset mode builds mock, and a
  // hosted build never falls back to it.
  env: { NEXT_PUBLIC_JOMCALL_MODE: process.env.JOMCALL_MODE ?? "mock" },
  devIndicators: false,
  images: { qualities: [75, 85] },
};
export default nextConfig;
